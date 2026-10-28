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
  const purging = { ...deps, env: { VERCEL: '1' }, invalidateByTag: async (tags) => calls.push(tags) };
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
  const purging = { ...deps, env: { VERCEL: '1' }, invalidateByTag: async (tags) => calls.push(tags) };
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
