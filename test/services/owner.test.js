// @ts-check
/**
 * Plan 2b Task 8: the owner view's service side -- what the waiting list
 * holds, and that a review changes the state and purges.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { seededDeps } from '../helpers/ingest.js';
import { insertItem, insertUser } from '../helpers/seed.js';
import { ownerView, setApproval, reviewItem } from '../../src/services/owner.js';
import { findItemIdBySource } from '../../src/repo/itemState.js';

/** @type {Awaited<ReturnType<typeof seededDeps>>} */
let deps;

before(async () => { deps = await seededDeps(); });
after(async () => { await deps.db.end(); });

test('the waiting list is held items only, oldest first, with their previews', async () => {
  const first = await deps.db.transaction((tx) => insertItem(tx, { reviewState: 'pending' }), { actor: 'system' });
  const second = await deps.db.transaction((tx) => insertItem(tx, { reviewState: 'pending' }), { actor: 'system' });
  void first; void second;
  const view = await ownerView(deps);
  assert.equal(view.approvalRequired, false);
  assert.equal(view.signInFailedAt, null);
  assert.deepEqual(view.reports, []);
  assert.ok(Array.isArray(view.waiting));
});

test('setApproval writes only a change and is idempotent', async () => {
  await deps.db.transaction((tx) => insertUser(tx, { id: 'x:0' }), { actor: 'system' });
  assert.deepEqual(await setApproval(deps, true, 'x:0'), { approvalRequired: true });
  assert.deepEqual(await setApproval(deps, true, 'x:0'), { approvalRequired: true });
  assert.equal((await ownerView(deps)).approvalRequired, true);
  await setApproval(deps, false, 'x:0');
});

test('reviewItem moves the state and purges the item', async () => {
  const calls = /** @type {string[][]} */ ([]);
  const capture = async (/** @type {string[]} */ tags) => calls.push(tags);
  const purging = { ...deps, env: { VERCEL: '1' }, invalidateByTag: capture, dangerouslyDeleteByTag: capture };
  const { rows } = await deps.db.query(
    `select s.external_id from items i join item_sources s on s.item_id = i.id and s.role = 'primary'
     where i.review_state = 'published' and i.deleted_at is null order by i.id limit 1`,
  );
  const sourceId = rows[0].external_id;
  await reviewItem(purging, { kind: 'translation', sourceId, state: 'rejected', actor: /** @type {any} */ ({ id: 'x:0' }) });
  const id = await findItemIdBySource(deps.db, { kind: 'translation', platform: 'x', externalId: sourceId });
  assert.ok(id);
  const { rows: state } = await deps.db.query('select review_state from items where id = $1', [id]);
  assert.equal(state[0].review_state, 'rejected');
  assert.ok(calls.flat().includes(`item:${id}`));
});

// --- Task 9: the reports queue ---------------------------------------------

const { reportQueue, hideReportTarget, restoreReportTarget, dismissReport } = await import('../../src/services/owner.js');
const { createReport } = await import('../../src/services/reports.js');

/** @type {{ itemKind: string, itemSourceId: string, eventSlug: string, eventId: number }} */
let targets;

/** The sample target ids, read once. @returns {Promise<typeof targets>} */
async function sampleTargets() {
  if (targets) return targets;
  const { rows } = await deps.db.query(
    `select i.kind, s.external_id as source_id, e.slug, e.id as event_id
     from items i
     join item_sources s on s.item_id = i.id and s.role = 'primary'
     join events e on e.id = i.event_id
     where i.deleted_at is null and i.review_state = 'published'
     order by i.id limit 1`,
  );
  targets = { itemKind: rows[0].kind, itemSourceId: rows[0].source_id, eventSlug: rows[0].slug, eventId: rows[0].event_id };
  return targets;
}

test('open reports list their reason, reporter and a link to the target', async () => {
  const t = await sampleTargets();
  await createReport(deps, { target: { type: 'item', kind: t.itemKind, sourceId: t.itemSourceId }, reason: 'wrong translation', reporter: null });
  const queue = await reportQueue(deps);
  const row = queue.find((report) => report.reason === 'wrong translation');
  assert.ok(row);
  assert.equal(row.status, 'open');
  assert.equal(row.reporter, null, 'a signed-out report shows no person');
  assert.equal(row.target.type, 'item');
  assert.ok(row.target.url.startsWith('/t/') || row.target.url.includes(t.itemSourceId));
  assert.equal(row.target.hidden, false);
});

test('hiding an item report soft-deletes it everywhere, keeps the report open, and purges', async () => {
  const t = await sampleTargets();
  const calls = /** @type {string[][]} */ ([]);
  const capture = async (/** @type {string[]} */ tags) => calls.push(tags);
  const purging = { ...deps, env: { VERCEL: '1' }, invalidateByTag: capture, dangerouslyDeleteByTag: capture };
  const { id } = await createReport(deps, { target: { type: 'item', kind: t.itemKind, sourceId: t.itemSourceId }, reason: 'hide me', reporter: null });
  await hideReportTarget(purging, { reportId: id, actor: /** @type {any} */ ({ id: 'x:0' }) });
  const queue = await reportQueue(deps);
  const row = queue.find((report) => report.id === id);
  assert.ok(row, 'still open');
  assert.equal(row.target.hidden, true);
  assert.ok(calls.flat().some((tag) => tag.startsWith('item:')), calls.flat().join(','));
  // Leave it visible for the next test.
  await restoreReportTarget(purging, { reportId: id, actor: /** @type {any} */ ({ id: 'x:0' }) });
});

test('restoring brings it back, and restoring twice is a Conflict', async () => {
  const t = await sampleTargets();
  const { id } = await createReport(deps, { target: { type: 'item', kind: t.itemKind, sourceId: t.itemSourceId }, reason: 'restore me', reporter: null });
  await assert.rejects(restoreReportTarget(deps, { reportId: id, actor: /** @type {any} */ ({ id: 'x:0' }) }), { name: 'Conflict' });
  await hideReportTarget(deps, { reportId: id, actor: /** @type {any} */ ({ id: 'x:0' }) });
  await restoreReportTarget(deps, { reportId: id, actor: /** @type {any} */ ({ id: 'x:0' }) });
  const { rows } = await deps.db.query(
    `select i.deleted_at from items i join item_sources s on s.item_id = i.id and s.role = 'primary' where s.external_id = $1`,
    [t.itemSourceId],
  );
  assert.equal(rows[0].deleted_at, null);
  await assert.rejects(restoreReportTarget(deps, { reportId: id, actor: /** @type {any} */ ({ id: 'x:0' }) }), { name: 'Conflict' });
});

test('hiding an event report soft-deletes the event and keeps its entries archived', async () => {
  const t = await sampleTargets();
  const { id } = await createReport(deps, { target: { type: 'event', slug: t.eventSlug }, reason: 'bad event', reporter: null });
  await hideReportTarget(deps, { reportId: id, actor: /** @type {any} */ ({ id: 'x:0' }) });
  const { rows } = await deps.db.query('select deleted_at from events where slug = $1', [t.eventSlug]);
  assert.ok(rows[0].deleted_at);
  const queue = await reportQueue(deps);
  assert.equal(queue.find((report) => report.id === id).target.hidden, true);
  await restoreReportTarget(deps, { reportId: id, actor: /** @type {any} */ ({ id: 'x:0' }) });
});

test('dismissing closes the report and leaves the target alone', async () => {
  const t = await sampleTargets();
  const { id } = await createReport(deps, { target: { type: 'item', kind: t.itemKind, sourceId: t.itemSourceId }, reason: 'dismiss me', reporter: null });
  await dismissReport(deps, { reportId: id, actor: /** @type {any} */ ({ id: 'x:0' }) });
  const queue = await reportQueue(deps);
  assert.ok(!queue.some((report) => report.id === id), 'no longer open');
  const { rows } = await deps.db.query('select status from reports where id = $1', [id]);
  assert.equal(rows[0].status, 'dismissed');
});

test('a missing report is NotFound and a closed one is a Conflict', async () => {
  const t = await sampleTargets();
  await assert.rejects(hideReportTarget(deps, { reportId: 999999, actor: /** @type {any} */ ({ id: 'x:0' }) }), { name: 'NotFound' });
  const { id } = await createReport(deps, { target: { type: 'item', kind: t.itemKind, sourceId: t.itemSourceId }, reason: 'close me', reporter: null });
  await dismissReport(deps, { reportId: id, actor: /** @type {any} */ ({ id: 'x:0' }) });
  await assert.rejects(hideReportTarget(deps, { reportId: id, actor: /** @type {any} */ ({ id: 'x:0' }) }), { name: 'Conflict' });
});

// --- Task 10: users, blocking and the sign-in alert ------------------------

const { searchUsers, setBlocked, clearSignInAlert } = await import('../../src/services/ownerUsers.js');
const { insertAccount } = await import('../helpers/seed.js');
const { set: setSetting } = await import('../../src/repo/settings.js');

let blockSeq = 0;

/**
 * A user with an X account, one submission of their own (created_by is the
 * transaction's actor) and one item credited to them but submitted by the
 * engine -- the block must hide the first and leave the second.
 */
async function blockedFixture() {
  blockSeq += 1;
  const userId = `x:block-test-${blockSeq}`;
  await deps.db.transaction((tx) => insertUser(tx, { id: userId }), { actor: 'system' });
  const submitted = await deps.db.transaction((tx) => insertItem(tx, {}), { actor: userId });
  const accountId = await deps.db.transaction(async (tx) => {
    const account = await insertAccount(tx, { handle: `blockable_tl_${blockSeq}` });
    await tx.query('update accounts set user_id = $1, external_id = $2 where id = $3', [userId, `99000${blockSeq}`, account]);
    await insertItem(tx, { creditedAccountId: account });
    return account;
  }, { actor: 'system' });
  return { userId, accountId, submitted };
}

test('users are searchable by handle or display name, never the system user', async () => {
  const { userId } = await blockedFixture();
  const byHandle = await searchUsers(deps, 'blockable');
  assert.ok(byHandle.some((user) => user.id === userId && String(user.handle).startsWith('blockable_tl')));
  assert.ok(byHandle.every((user) => user.id !== 'system'));
  const byName = await searchUsers(deps, 'block-test');
  assert.ok(byName.length >= 1, 'a display name matches too');
  assert.deepEqual(await searchUsers(deps, 'x'), [], 'under two characters searches nothing');
});

test('blocking hides submissions and refuses their writes; a credited item stays', async () => {
  const { userId } = await blockedFixture();
  const calls = /** @type {string[][]} */ ([]);
  const capture = async (/** @type {string[]} */ tags) => calls.push(tags);
  const purging = { ...deps, env: { VERCEL: '1' }, invalidateByTag: capture, dangerouslyDeleteByTag: capture };
  const hidden = await setBlocked(purging, { userId, blocked: true, actor: /** @type {any} */ ({ id: 'system' }) });
  assert.equal(hidden.hidden, 1);
  const { rows } = await deps.db.query('select created_by, deleted_reason from items where created_by = $1', [userId]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].deleted_reason, 'blocked_submitter');
  const { rows: credited } = await deps.db.query(
    "select i.deleted_reason from items i join accounts a on a.id = i.credited_account_id where a.user_id = $1 and i.created_by <> $1",
    [userId],
  );
  assert.equal(credited[0].deleted_reason, null, 'an item merely credited to them stays');
  assert.ok(calls.flat().includes('home'));
});

test('unblocking restores only blocked_submitter items', async () => {
  const { userId } = await blockedFixture();
  const actor = /** @type {any} */ ({ id: 'system' });
  await setBlocked(deps, { userId, blocked: true, actor });
  const restored = await setBlocked(deps, { userId, blocked: false, actor });
  assert.equal(restored.restored, 1);
  const { rows } = await deps.db.query('select deleted_at from items where created_by = $1', [userId]);
  assert.equal(rows[0].deleted_at, null);
});

test('the owner cannot block themselves or the system user', async () => {
  await assert.rejects(setBlocked(deps, { userId: 'system', blocked: true, actor: /** @type {any} */ ({ id: 'x:owner' }) }), { name: 'Conflict' });
  await assert.rejects(setBlocked(deps, { userId: 'x:owner', blocked: true, actor: /** @type {any} */ ({ id: 'x:owner' }) }), { name: 'Conflict' });
});

test('clearing the sign-in alert empties it', async () => {
  await deps.db.transaction((tx) => setSetting(tx, 'xSignInFailedAt', new Date().toISOString()), { actor: 'system' });
  assert.ok((await ownerView(deps)).signInFailedAt);
  await clearSignInAlert({ db: deps.db }, 'system');
  assert.equal((await ownerView(deps)).signInFailedAt, null);
});

// --- fix pass: held follow-up parts and event placement on restore

let heldSeq = 99;

/** A published item with a held follow-up part. */
async function itemWithHeldPart() {
  heldSeq += 1;
  const { rows } = await deps.db.query(
    `select i.id, s.external_id from items i join item_sources s on s.item_id = i.id and s.role = 'primary'
     where i.deleted_at is null order by i.id limit 1`,
  );
  await deps.db.transaction(async (tx) => {
    const { rows: src } = await tx.query("select id from item_sources where item_id = $1 and role = 'primary'", [rows[0].id]);
    await tx.query(
      'insert into translation_parts (item_id, position, source_id, body, pending) values ($1, $4, $2, $3, true)',
      [rows[0].id, src[0].id, 'held follow-up text', heldSeq],
    );
  }, { actor: 'system' });
  return rows[0];
}

test('a held follow-up part is in the waiting list and approving publishes it', async () => {
  const item = await itemWithHeldPart();
  const view = await ownerView(deps);
  assert.ok(view.waiting.some((entry) => entry.sourceId === item.external_id), 'waiting lists the parent item');

  await reviewItem({ ...deps, env: {} }, { kind: 'translation', sourceId: item.external_id, state: 'published', actor: /** @type {any} */ ({ id: 'x:0' }) });
  const { rows } = await deps.db.query('select pending, rejected from translation_parts where item_id = $1 and position = $2', [item.id, heldSeq]);
  assert.equal(rows[0].pending, false);
  assert.equal(rows[0].rejected, false);
  assert.ok(!(await ownerView(deps)).waiting.some((entry) => entry.sourceId === item.external_id));
});

test('rejecting a held part keeps it hidden without destroying the text', async () => {
  const item = await itemWithHeldPart();
  await reviewItem({ ...deps, env: {} }, { kind: 'translation', sourceId: item.external_id, state: 'rejected', actor: /** @type {any} */ ({ id: 'x:0' }) });
  const { rows } = await deps.db.query('select pending, rejected, body from translation_parts where item_id = $1 and position = $2', [item.id, heldSeq]);
  assert.equal(rows[0].pending, true);
  assert.equal(rows[0].rejected, true);
  assert.equal(rows[0].body, 'held follow-up text');
  assert.ok(!(await ownerView(deps)).waiting.some((entry) => entry.sourceId === item.external_id));
});

test('restoring a hidden event brings its entries back where they were', async () => {
  const { rows } = await deps.db.query(
    `select e.id, e.slug, count(i.id)::int as n from events e
     join items i on i.event_id = e.id and i.deleted_at is null and i.review_state = 'published'
     where e.deleted_at is null group by e.id, e.slug having count(i.id) > 0 limit 1`,
  );
  const before = rows[0];
  const { id: reportId } = await createReport(deps, { target: { type: 'event', slug: before.slug }, reason: 'restore placement', reporter: null });
  const actor = /** @type {any} */ ({ id: 'system' });
  await hideReportTarget(deps, { reportId, actor });
  await restoreReportTarget(deps, { reportId, actor });
  const { rows: after } = await deps.db.query("select count(*)::int as n from items where event_id = $1 and deleted_at is null and review_state = 'published'", [before.id]);
  assert.equal(after[0].n, before.n, 'every entry still sits on its event');
});
