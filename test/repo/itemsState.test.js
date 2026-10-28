// @ts-check
/**
 * Plan 2b Task 1: the item state helpers every later task writes through --
 * soft delete with a reason, restore only that reason, review state, the
 * lookups a hidden item still needs, and the translator/owner listings.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { freshDb } from '../helpers/db.js';
import { insertAccount, insertEvent, insertItem, insertSource } from '../helpers/seed.js';
import {
  findItemIdBySource, pendingItemIds, restoreItem, setReviewState, softDeleteItem,
  translatorItemIds, translatorStates, translatorTotals,
} from '../../src/repo/itemState.js';
import { findVisibleItemId } from '../../src/repo/cards.js';
import { previewsFor, previewsForAny, presenterContext } from '../../src/services/cards.js';
import { itemIdOf, seededDeps } from '../helpers/ingest.js';

/** @type {Awaited<ReturnType<typeof freshDb>>} */
let db;
before(async () => { db = await freshDb(); });
after(async () => { await db.end(); });

const system = { actor: 'system' };

/** @param {number} itemId */
async function deletedState(itemId) {
  const { rows } = await db.query('select deleted_at, deleted_reason, deleted_by, review_state from items where id = $1', [itemId]);
  return rows[0];
}

/** @param {number} itemId */
async function audits(itemId) {
  const { rows } = await db.query("select count(*)::int as n from audit_log where table_name = 'items' and row_key = $1", [String(itemId)]);
  return rows[0].n;
}

/** @param {number} itemId */
async function markDeleted(itemId, reason) {
  await db.transaction((tx) => tx.query('update items set deleted_at = now(), deleted_reason = $2, deleted_by = $3 where id = $1', [itemId, reason, 'system']), system);
}

test('softDeleteItem sets the reason and actor once; restoreItem clears only that reason', async () => {
  const id = await db.transaction((tx) => insertItem(tx), system);

  assert.equal(await db.transaction((tx) => softDeleteItem(tx, { itemId: id, reason: 'removed_by_account', actor: 'system' }), system), true);
  let row = await deletedState(id);
  assert.equal(row.deleted_reason, 'removed_by_account');
  assert.equal(row.deleted_by, 'system');
  assert.ok(row.deleted_at);

  assert.equal(await db.transaction((tx) => softDeleteItem(tx, { itemId: id, reason: 'hidden_by_owner', actor: 'system' }), system), false);
  assert.equal((await deletedState(id)).deleted_reason, 'removed_by_account');

  assert.equal(await db.transaction((tx) => restoreItem(tx, { itemId: id, reason: 'hidden_by_owner' }), system), false);
  assert.ok((await deletedState(id)).deleted_at);

  assert.equal(await db.transaction((tx) => restoreItem(tx, { itemId: id, reason: 'removed_by_account' }), system), true);
  row = await deletedState(id);
  assert.equal(row.deleted_at, null);
  assert.equal(row.deleted_reason, null);
  assert.equal(row.deleted_by, null);
});

test('setReviewState writes only on a real change and audits it', async () => {
  const id = await db.transaction((tx) => insertItem(tx, { reviewState: 'pending' }), system);
  assert.equal(await db.transaction((tx) => setReviewState(tx, { itemId: id, state: 'published' }), system), true);
  assert.equal(await db.transaction((tx) => setReviewState(tx, { itemId: id, state: 'published' }), system), false);
  assert.equal((await deletedState(id)).review_state, 'published');
  // insert + the one real change -> two audit rows; the no-op wrote none.
  assert.equal(await audits(id), 2);
});

test('findItemIdBySource sees hidden items and older source ids', async () => {
  const { id, sourceId } = await db.transaction(async (tx) => {
    const itemId = await insertItem(tx);
    const sid = await insertSource(tx, { itemId, externalId: '9101' });
    return { id: itemId, sourceId: sid };
  }, system);
  assert.equal(await findItemIdBySource(db, { kind: 'translation', platform: 'x', externalId: '9101' }), id);
  await markDeleted(id, 'hidden_by_owner');
  assert.equal(await findVisibleItemId(db, { kind: 'translation', platform: 'x', externalId: '9101' }), null);
  assert.equal(await findItemIdBySource(db, { kind: 'translation', platform: 'x', externalId: '9101' }), id);

  await db.transaction((tx) => tx.query('insert into source_aliases (platform, external_id, source_id) values ($1, $2, $3)', ['x', '9101-v2', sourceId]), system);
  assert.equal(await findItemIdBySource(db, { kind: 'translation', platform: 'x', externalId: '9101-v2' }), id);

  assert.equal(await findItemIdBySource(db, { kind: 'translation', platform: 'x', externalId: '999999' }), null);
});

test('translatorItemIds lists every state of the credited account but never erased, newest first', async () => {
  const accountId = await db.transaction((tx) => insertAccount(tx, { handle: 'listing_tl' }), system);
  const other = await db.transaction((tx) => insertAccount(tx, { handle: 'other_tl' }), system);
  const ids = await db.transaction(async (tx) => [
    await insertItem(tx, { creditedAccountId: accountId }), // published
    await insertItem(tx, { creditedAccountId: accountId, reviewState: 'pending' }),
    await insertItem(tx, { creditedAccountId: accountId }),
    await insertItem(tx, { creditedAccountId: accountId }),
    await insertItem(tx, { creditedAccountId: other }),
  ], system);
  await markDeleted(ids[2], 'removed_by_account');
  await markDeleted(ids[3], 'erased');

  const first = await translatorItemIds(db, [accountId], { limit: 2, offset: 0 });
  assert.deepEqual(first.ids, [ids[2], ids[1]]);
  assert.equal(first.hasMore, true);
  const second = await translatorItemIds(db, [accountId], { limit: 2, offset: 2 });
  assert.deepEqual(second.ids, [ids[0]]);
  assert.equal(second.hasMore, false);

  const states = await translatorStates(db, first.ids);
  assert.deepEqual(states.get(ids[2]), { reason: 'removed_by_account', reviewState: 'published' });
  assert.deepEqual(states.get(ids[1]), { reason: null, reviewState: 'pending' });
});

test('translatorTotals counts visible credited items, their events and shared stories', async () => {
  const accountId = await db.transaction((tx) => insertAccount(tx, { handle: 'totals_tl' }), system);
  const eventId = await db.transaction((tx) => insertEvent(tx, { slug: 'totals-event' }), system);
  const ids = await db.transaction(async (tx) => [
    await insertItem(tx, { creditedAccountId: accountId, placement: 'event', eventId }),
    await insertItem(tx, { creditedAccountId: accountId, placement: 'shared_story' }),
    await insertItem(tx, { creditedAccountId: accountId, placement: 'event', eventId }),
    await insertItem(tx, { creditedAccountId: accountId, reviewState: 'pending' }),
  ], system);
  await markDeleted(ids[2], 'removed_by_account');

  assert.deepEqual(await translatorTotals(db, [accountId]), { translations: 2, events: 1, sharedStories: 1 });
  assert.deepEqual(await translatorTotals(db, []), { translations: 0, events: 0, sharedStories: 0 });

  // An opted-out account's items count for nothing.
  await db.transaction((tx) => tx.query('update accounts set opted_out_at = now() where id = $1', [accountId]), system);
  assert.deepEqual(await translatorTotals(db, [accountId]), { translations: 0, events: 0, sharedStories: 0 });
});

test('pendingItemIds lists held items only, oldest first', async () => {
  const before = await pendingItemIds(db, { limit: 10 });
  const [a, b] = await db.transaction(async (tx) => [
    await insertItem(tx, { reviewState: 'pending' }),
    await insertItem(tx, { reviewState: 'pending' }),
  ], system);
  await db.transaction((tx) => insertItem(tx, { reviewState: 'published' }), system);

  const ids = await pendingItemIds(db, { limit: 10 });
  assert.deepEqual(ids, [...before, a, b]);
  assert.deepEqual(await pendingItemIds(db, { limit: 1 }), ids.slice(0, 1));
});

test('previewsForAny presents a removed item; previewsFor leaves it out', async () => {
  const deps = await seededDeps();
  try {
    const itemId = await itemIdOf(deps.db, '1900000000000000001');
    const ctx = await presenterContext(deps);
    assert.equal((await previewsForAny(deps, [itemId], ctx)).length, 1);

    await deps.db.transaction((tx) => softDeleteItem(tx, { itemId, reason: 'removed_by_account', actor: 'system' }), system);

    const any = await previewsForAny(deps, [itemId], ctx);
    assert.equal(any.length, 1);
    assert.equal(any[0].card.id, itemId);
    assert.equal(any[0].card.reviewState, 'published');
    assert.ok(any[0].preview.url);
    assert.deepEqual(await previewsFor(deps, [itemId], ctx), []);
  } finally {
    await deps.db.end();
  }
});
