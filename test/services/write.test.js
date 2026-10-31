// @ts-check
/**
 * Review fixes Task 5: `write()` runs one transaction under one actor and
 * runs the purges it queued only once that transaction has committed.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { freshDb } from '../helpers/db.js';
import { insertItem } from '../helpers/seed.js';
import { write } from '../../src/services/write.js';

/** @type {Awaited<ReturnType<typeof freshDb>>} */
let db;
/** @type {number} */
let itemId;

before(async () => {
  db = await freshDb();
  itemId = await db.transaction((tx) => insertItem(tx), { actor: 'system' });
});
after(async () => { await db.end(); });

/** @param {{ calls: string[][], deferred: (() => Promise<unknown>)[] }} sinks */
function purgingDeps({ calls, deferred }) {
  const capture = async (/** @type {string[]} */ tags) => { calls.push(tags); };
  return {
    db, env: { VERCEL: '1' }, invalidateByTag: capture, dangerouslyDeleteByTag: capture,
    defer: (/** @type {() => Promise<unknown>} */ task) => { deferred.push(task); },
  };
}

test('a purge queued in a write that rolls back never runs', async () => {
  const calls = /** @type {string[][]} */ ([]);
  const deferred = /** @type {(() => Promise<unknown>)[]} */ ([]);
  await assert.rejects(write(purgingDeps({ calls, deferred }), 'system', async (w) => {
    await w.tx.query("update items set review_state = 'rejected' where id = $1", [itemId]);
    w.purge.item(itemId);
    throw new Error('boom');
  }), /boom/);
  assert.deepEqual(deferred, [], 'nothing was handed to defer');
  assert.deepEqual(calls, []);
  const { rows } = await db.query('select review_state from items where id = $1', [itemId]);
  assert.equal(rows[0].review_state, 'published', 'the write rolled back');
});

test('a purge queued in a committed write runs after commit, under the given actor', async () => {
  const calls = /** @type {string[][]} */ ([]);
  const deferred = /** @type {(() => Promise<unknown>)[]} */ ([]);
  const result = await write(purgingDeps({ calls, deferred }), 'system', async (w) => {
    await w.tx.query('update items set sort_key = 7 where id = $1', [itemId]);
    w.purge.item(itemId);
    const { rows } = await w.tx.query("select current_setting('app.actor', true) as actor");
    return rows[0].actor;
  });
  assert.equal(result, 'system');
  assert.equal(deferred.length, 1);
  for (const task of deferred) await task();
  assert.ok(calls.flat().includes(`item:${itemId}`), calls.flat().join(','));
});
