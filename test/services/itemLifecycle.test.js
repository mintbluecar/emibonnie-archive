// @ts-check
/**
 * Review fixes Task 5: the one way owner review and import change an
 * item's state -- publish (whole item or one held part), reject, remove.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { freshDb } from '../helpers/db.js';
import { insertItem, insertSource } from '../helpers/seed.js';
import { write } from '../../src/services/write.js';
import { publish, reject, remove } from '../../src/services/itemLifecycle.js';

/** @type {Awaited<ReturnType<typeof freshDb>>} */
let db;
const deps = () => ({ db });

before(async () => { db = await freshDb(); });
after(async () => { await db.end(); });

/**
 * A translation item in `reviewState` with one held part per external id.
 * @param {string} reviewState @param {string[]} parts
 * @returns {Promise<number>}
 */
async function itemWithHeldParts(reviewState, parts) {
  return db.transaction(async (tx) => {
    const id = await insertItem(tx, { reviewState });
    await tx.query('insert into translations (item_id) values ($1)', [id]);
    for (const [position, externalId] of parts.entries()) {
      const sourceId = await insertSource(tx, { itemId: id, externalId, role: position === 0 ? 'primary' : 'follow_up' });
      await tx.query(
        'insert into translation_parts (item_id, position, source_id, body, pending) values ($1, $2, $3, $4, true)',
        [id, position, sourceId, `part ${externalId}`],
      );
    }
    return id;
  }, { actor: 'system' });
}

/** @param {number} itemId */
async function stateOf(itemId) {
  const { rows: item } = await db.query('select review_state, deleted_reason from items where id = $1', [itemId]);
  const { rows: parts } = await db.query('select pending, rejected from translation_parts where item_id = $1 order by position', [itemId]);
  return { reviewState: item[0].review_state, deletedReason: item[0].deleted_reason, parts };
}

test('publish approves the item and its held parts in one transaction', async () => {
  const rolledBack = await itemWithHeldParts('pending', ['880001', '880002']);
  await assert.rejects(write(deps(), 'system', async (w) => {
    await publish(w, { itemId: rolledBack, kindName: 'translation' });
    throw new Error('after publish');
  }), /after publish/);
  const untouched = await stateOf(rolledBack);
  assert.equal(untouched.reviewState, 'pending');
  assert.ok(untouched.parts.every((part) => part.pending === true), 'no part was approved on its own');

  const itemId = await itemWithHeldParts('pending', ['880003', '880004']);
  await write(deps(), 'system', (w) => publish(w, { itemId, kindName: 'translation' }));
  const published = await stateOf(itemId);
  assert.equal(published.reviewState, 'published');
  assert.ok(published.parts.every((part) => part.pending === false), JSON.stringify(published.parts));
});

test('publish with a part changes only that part', async () => {
  const itemId = await itemWithHeldParts('published', ['880011', '880012', '880013']);
  await write(deps(), 'system', (w) => publish(w, { itemId, kindName: 'translation', part: '880012' }));
  const { reviewState, parts } = await stateOf(itemId);
  assert.equal(parts[1].pending, false, 'its own part is approved');
  assert.equal(parts[2].pending, true, 'the sibling is unchanged');
  assert.equal(parts[0].pending, true, "the item's own part is unchanged");
  assert.equal(reviewState, 'published', "the item's own state is unchanged");

  const held = await itemWithHeldParts('pending', ['880014', '880015']);
  await write(deps(), 'system', (w) => publish(w, { itemId: held, kindName: 'translation', part: '880015' }));
  const after = await stateOf(held);
  assert.equal(after.reviewState, 'pending', 'a held item stays held when only a part is published');
  assert.deepEqual(after.parts.map((part) => part.pending), [true, false]);
});

test('publish with keepHeld approves the item and every held part but those', async () => {
  const itemId = await itemWithHeldParts('pending', ['880016', '880017', '880018']);
  await write(deps(), 'system', (w) => publish(w, { itemId, kindName: 'translation', keepHeld: ['880018'] }));
  const { reviewState, parts } = await stateOf(itemId);
  assert.equal(reviewState, 'published');
  assert.deepEqual(parts.map((part) => part.pending), [false, false, true]);
});

test('reject rejects the item and its held parts; remove soft-deletes with the reason', async () => {
  const rejected = await itemWithHeldParts('pending', ['880021', '880022']);
  await write(deps(), 'system', (w) => reject(w, { itemId: rejected, kindName: 'translation' }));
  const after = await stateOf(rejected);
  assert.equal(after.reviewState, 'rejected');
  assert.ok(after.parts.every((part) => part.rejected === true));

  const removed = await itemWithHeldParts('published', ['880031']);
  assert.equal(await write(deps(), 'system', (w) => remove(w, { itemId: removed, reason: 'hidden_by_owner' })), true);
  assert.equal((await stateOf(removed)).deletedReason, 'hidden_by_owner');
  assert.equal(await write(deps(), 'system', (w) => remove(w, { itemId: removed, reason: 'hidden_by_owner' })), false, 'already removed');
});
