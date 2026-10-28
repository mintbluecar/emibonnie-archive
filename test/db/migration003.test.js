// @ts-check
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { freshDb } from '../helpers/db.js';
import { insertItem } from '../helpers/seed.js';

/** @type {Awaited<ReturnType<typeof freshDb>>} */
let db;
before(async () => { db = await freshDb(); });
after(async () => { await db.end(); });

const system = { actor: 'system' };
const write = (/** @param {(tx: any) => Promise<unknown>} fn */ fn) => db.transaction(fn, system);
const pgError = (/** @type {string} */ code) => (/** @type {any} */ err) => err.code === code;

/** A translation item with a `translations` row, so `item_edits` can point at it. */
async function translationItem(/** @type {any} */ tx) {
  const itemId = await insertItem(tx);
  await tx.query('insert into translations (item_id) values ($1)', [itemId]);
  return itemId;
}

test('003 makes item_edits.reverts unique: one revert per edit, and a concurrent second is a conflict', async () => {
  await assert.rejects(
    write(async (tx) => {
      const itemId = await translationItem(tx);
      const { rows: [edit] } = await tx.query(
        "insert into item_edits (item_id, before, after, created_by) values ($1, '{}', '{}', 'system') returning id",
        [itemId],
      );
      const revert = "insert into item_edits (item_id, before, after, reverts, created_by) values ($1, '{}', '{}', $2, 'system')";
      await tx.query(revert, [itemId, edit.id]);
      // A second revert of the same edit must be refused by the database, not
      // only by the service's (non-atomic) "already reverted" check.
      await tx.query(revert, [itemId, edit.id]);
    }),
    pgError('23505'),
  );
});

test('003 leaves unreverted edits alone: many item_edits rows may have `reverts` null', async () => {
  await write(async (tx) => {
    const itemId = await translationItem(tx);
    const edit = "insert into item_edits (item_id, before, after, created_by) values ($1, '{}', '{}', 'system')";
    await tx.query(edit, [itemId]);
    await tx.query(edit, [itemId]);
  });
  const { rows } = await db.query('select count(*)::int as n from item_edits where reverts is null');
  assert.ok(rows[0].n >= 2);
});
