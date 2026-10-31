// @ts-check
/**
 * Plan 2b Task 4: a translator's own list (every credited entry, removed
 * ones flagged for restore), their totals for the welcome, and the
 * one-time welcome flag on `GET /api/me`.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { seededDeps } from '../helpers/ingest.js';
import { insertAccount, insertItem, insertUser } from '../helpers/seed.js';
import { translatorList, markWelcomed, TRANSLATOR_PAGE_SIZE } from '../../src/services/translator.js';
import { translatorTotals } from '../../src/repo/itemState.js';
import { accountState, linkXAccountToUser, xAccountIdsOfUser } from '../../src/repo/accounts.js';

/** @type {Awaited<ReturnType<typeof seededDeps>>} */
let deps;
/** @type {number} */
let accountId;
/** @type {string} */
let userId = 'x:3800001';

let sourceSeq = 0;

/**
 * One credited item of the translation kind, with a real text part so the
 * presenter can build its preview.
 * @param {number} credited @param {{ reviewState?: string, deletedReason?: string|null, placement?: string }} [options]
 * @returns {Promise<number>}
 */
async function creditedItem(credited, { reviewState = 'published', deletedReason = null, placement = 'unsorted' } = {}) {
  sourceSeq += 1;
  const externalId = `38000000000000000${String(sourceSeq).padStart(3, '0')}`;
  return deps.db.transaction(async (tx) => {
    const id = await insertItem(tx, { creditedAccountId: credited, reviewState, placement });
    await tx.query('insert into translations (item_id) values ($1)', [id]);
    const { rows } = await tx.query(
      `insert into item_sources (item_id, kind, platform, external_id, url, role)
       values ($1, 'translation', 'x', $2, $3, 'primary') returning id`,
      [id, externalId, `https://x.com/tl/status/${externalId}`],
    );
    await tx.query(
      'insert into translation_parts (item_id, position, source_id, body) values ($1, 0, $2, $3)',
      [id, rows[0].id, `credited item ${sourceSeq}`],
    );
    if (deletedReason) await tx.query('update items set deleted_at = now(), deleted_reason = $2 where id = $1', [id, deletedReason]);
    return id;
  }, { actor: 'system' });
}

before(async () => {
  deps = await seededDeps();
  accountId = await deps.db.transaction((tx) => insertAccount(tx, { handle: 'plan2b_tl' }), { actor: 'system' });
  await deps.db.transaction(async (tx) => {
    await tx.query("insert into users (id, display_name) values ($1, 'plan2b')", [userId]);
    await tx.query('update accounts set user_id = $1 where id = $2', [userId, accountId]);
  }, { actor: 'system' });
});
after(async () => { await deps.db.end(); });

const user = () => /** @type {any} */ ({
  id: userId, via: 'x', xUserId: '3800001', handle: 'plan2b_tl', displayName: null,
  isOwner: false, isBlocked: false, translatorAccountIds: [accountId], welcomedTranslator: false,
});

test('the list holds every credited item, removed ones flagged for restore', async () => {
  await creditedItem(accountId);
  const removed = await creditedItem(accountId, { deletedReason: 'removed_by_account' });
  const hidden = await creditedItem(accountId, { deletedReason: 'hidden_by_owner' });
  await creditedItem(accountId, { reviewState: 'rejected' });
  const otherAccount = await deps.db.transaction((tx) => insertAccount(tx, { handle: 'not_mine' }), { actor: 'system' });
  await creditedItem(otherAccount);

  const page = await translatorList(deps, user(), { offset: 0 });
  assert.equal(page.items.length, 4, 'only the credited account\'s items');
  assert.equal(page.items.filter((item) => item.removedByYou).length, 1);
  assert.equal(page.items.filter((item) => item.hidden).length, 1);
  assert.equal(page.items.filter((item) => item.reviewState === 'rejected').length, 1);
  assert.ok(page.items.every((item) => item.url && item.sourceId));
  void [removed, hidden];
  assert.equal(page.hasMore, false);
  assert.equal(page.totals.translations, 1, 'only the one published, undeleted item');
});

test('a page is capped and says so', async () => {
  while (sourceSeq < TRANSLATOR_PAGE_SIZE + 2) await creditedItem(accountId);
  const page = await translatorList(deps, user(), { offset: 0 });
  assert.equal(page.items.length, TRANSLATOR_PAGE_SIZE);
  assert.equal(page.hasMore, true);
});

test('totals count only visible items and their events', async () => {
  const totals = await translatorTotals(deps.db, [accountId]);
  assert.ok(totals.translations > 0);
  assert.ok(totals.events >= 0);
});

test('markWelcomed is idempotent and flips the session flag', async () => {
  const { rows: before } = await deps.db.query('select meta from users where id = $1', [userId]);
  assert.equal(before[0].meta.translatorWelcomedAt, undefined);
  await markWelcomed(deps, userId);
  await markWelcomed(deps, userId);
  const { rows: after } = await deps.db.query('select meta from users where id = $1', [userId]);
  assert.ok(after[0].meta.translatorWelcomedAt);
  assert.ok(!Number.isNaN(Date.parse(after[0].meta.translatorWelcomedAt)));
});

test('markWelcomed stamps translatorWelcomedAt from deps.now(), not the real clock', async () => {
  const fresh = 'x:welcome-clock-test';
  await deps.db.transaction((tx) => insertUser(tx, { id: fresh }), { actor: 'system' });
  const fixed = new Date('2026-03-03T03:03:03.000Z');
  await markWelcomed({ db: deps.db, now: () => fixed }, fresh);
  const { rows } = await deps.db.query('select meta from users where id = $1', [fresh]);
  assert.equal(rows[0].meta.translatorWelcomedAt, fixed.toISOString());
});

test('linkXAccountToUser is the sign-in path the recognition uses', async () => {
  await deps.db.transaction((tx) => linkXAccountToUser(tx, { externalId: '3800001', userId: 'x:nobody' }), { actor: 'system' });
  const { rows } = await deps.db.query("select id from accounts where platform = 'x' and user_id = 'x:nobody'");
  assert.equal(rows.length, 0, 'no account with that external id exists, so nothing is linked');
});

// --- Task 5: remove and restore -------------------------------------------

const { removeEntries, restoreEntries } = await import('../../src/services/translator.js');

/** @param {Partial<{ env: Record<string, string>, calls: string[][] }>} [options] */
function purgingDeps({ env = { VERCEL: '1' }, calls = [] } = {}) {
  return {
    ...deps, env, defer: undefined,
    invalidateByTag: async (/** @type {string[]} */ tags) => calls.push(tags),
    dangerouslyDeleteByTag: async (/** @type {string[]} */ tags) => calls.push(tags),
  };
}

test('a translator removes and restores their own entry', async () => {
  const itemId = await creditedItem(accountId);
  const { rows } = await deps.db.query("select external_id from item_sources where item_id = $1 and role = 'primary'", [itemId]);
  const calls = /** @type {string[][]} */ ([]);
  const removing = purgingDeps({ calls });

  const removed = await removeEntries(removing, user(), [{ kind: 'translation', sourceId: rows[0].external_id }]);
  assert.deepEqual(removed, { removed: 1 });
  const { rows: after } = await deps.db.query('select deleted_reason from items where id = $1', [itemId]);
  assert.equal(after[0].deleted_reason, 'removed_by_account');
  const purged = calls.flat();
  assert.ok(purged.includes(`item:${itemId}`), purged.join(','));
  assert.ok(purged.includes('home'));

  const restored = await restoreEntries(removing, user(), [{ kind: 'translation', sourceId: rows[0].external_id }]);
  assert.deepEqual(restored, { restored: 1 });
  const { rows: back } = await deps.db.query('select deleted_at from items where id = $1', [itemId]);
  assert.equal(back[0].deleted_at, null);
});

test('a batch with another translator\'s entry changes nothing', async () => {
  const mine = await creditedItem(accountId);
  const theirs = await creditedItem(accountId);
  const { rows } = await deps.db.query(
    `select i.id, s.external_id from items i join item_sources s on s.item_id = i.id and s.role = 'primary'
     where i.id = any($1::bigint[])`, [[mine, theirs]],
  );
  const otherAccount = await deps.db.transaction((tx) => insertAccount(tx, { handle: 'other_owner' }), { actor: 'system' });
  await deps.db.transaction((tx) => tx.query('update items set credited_account_id = $2 where id = $1', [theirs, otherAccount]), { actor: 'system' });

  const attempts = [
    { kind: 'translation', sourceId: rows.find((r) => r.id === mine).external_id },
    { kind: 'translation', sourceId: rows.find((r) => r.id === theirs).external_id },
  ];
  await assert.rejects(removeEntries(purgingDeps(), user(), attempts), { name: 'Forbidden' });
  const { rows: untouched } = await deps.db.query('select count(*)::int as n from items where id = any($1::bigint[]) and deleted_at is null', [[mine, theirs]]);
  assert.equal(untouched[0].n, 2, 'the first entry was not removed either');
});

test('an empty batch or more than 50 entries is a BadRequest', async () => {
  await assert.rejects(removeEntries(purgingDeps(), user(), []), { name: 'BadRequest' });
  const many = Array.from({ length: 51 }, () => ({ kind: 'translation', sourceId: 'x' }));
  await assert.rejects(removeEntries(purgingDeps(), user(), many), { name: 'BadRequest' });
});

test('restoring an entry the owner hid is a Conflict', async () => {
  const hidden = await creditedItem(accountId, { deletedReason: 'hidden_by_owner' });
  const { rows } = await deps.db.query("select external_id from item_sources where item_id = $1 and role = 'primary'", [hidden]);
  await assert.rejects(
    restoreEntries(purgingDeps(), user(), [{ kind: 'translation', sourceId: rows[0].external_id }]),
    { name: 'Conflict' },
  );
});

// --- Task 6: opt out / opt in ---------------------------------------------

const { setOptOut } = await import('../../src/services/translator.js');
const { findVisibleItemId } = await import('../../src/repo/cards.js');

test('opting out hides every credited item; opting back in restores exactly those', async () => {
  const itemId = await creditedItem(accountId);
  const { rows } = await deps.db.query("select external_id from item_sources where item_id = $1 and role = 'primary'", [itemId]);
  const calls = /** @type {string[][]} */ ([]);
  const depsWithPurge = purgingDeps({ calls });

  const out = await setOptOut(depsWithPurge, user(), true);
  assert.equal(out.optedOut, true);
  const { rows: acct } = await deps.db.query('select external_id, handle from accounts where id = $1', [accountId]);
  assert.equal((await accountState(deps.db, { platform: 'x', externalId: acct[0].external_id, handle: acct[0].handle }))?.optedOut, true);
  assert.ok(out.entries >= 1);
  assert.equal(await findVisibleItemId(deps.db, { kind: 'translation', platform: 'x', externalId: rows[0].external_id }), null);
  assert.ok(calls.flat().includes(`account:plan2b_tl`), calls.flat().join(','));

  const back = await setOptOut(depsWithPurge, user(), false);
  assert.equal(back.optedOut, false);
  assert.notEqual(await findVisibleItemId(deps.db, { kind: 'translation', platform: 'x', externalId: rows[0].external_id }), null);
});

test('opting out leaves an owner-hidden entry hidden', async () => {
  const hidden = await creditedItem(accountId, { deletedReason: 'hidden_by_owner' });
  const { rows } = await deps.db.query("select external_id from item_sources where item_id = $1 and role = 'primary'", [hidden]);
  await setOptOut(purgingDeps(), user(), true);
  await setOptOut(purgingDeps(), user(), false);
  assert.equal(await findVisibleItemId(deps.db, { kind: 'translation', platform: 'x', externalId: rows[0].external_id }), null);
});

test('a user with no linked X account cannot opt out', async () => {
  const google = { ...user(), via: 'google', translatorAccountIds: [] };
  await assert.rejects(setOptOut(purgingDeps(), /** @type {any} */ (google), true), { name: 'Forbidden' });
});

// --- fix pass: recognition and the welcome's once-only write

test('only an account credited on an item counts as a translator account', async () => {
  const uncredited = await deps.db.transaction((tx) => insertAccount(tx, { handle: 'uncredited_x' }), { actor: 'system' });
  await deps.db.transaction(
    (tx) => tx.query("update accounts set user_id = 'x:3800001', external_id = '3800001' where id = $1", [uncredited]),
    { actor: 'system' },
  );
  const ids = await xAccountIdsOfUser(deps.db, 'x:3800001');
  assert.ok(ids.includes(accountId), 'the credited account still counts');
  assert.ok(!ids.includes(uncredited), 'an account with no credited item does not');
});

test('markWelcomed never rewrites the first time', async () => {
  await markWelcomed(deps, userId);
  const { rows: first } = await deps.db.query('select meta from users where id = $1', [userId]);
  await new Promise((resolve) => setTimeout(resolve, 5));
  await markWelcomed(deps, userId);
  const { rows: second } = await deps.db.query('select meta from users where id = $1', [userId]);
  assert.equal(second[0].meta.translatorWelcomedAt, first[0].meta.translatorWelcomedAt);
});
