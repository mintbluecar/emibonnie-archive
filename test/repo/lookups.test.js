// @ts-check
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { freshDb } from '../helpers/db.js';
import { ensureCategory, ensureClient, listCategories } from '../../src/repo/lookups.js';

/** @type {Awaited<ReturnType<typeof freshDb>>} */
let db;
before(async () => { db = await freshDb(); });
after(async () => { await db.end(); });

const system = { actor: 'system' };

test("ensureCategory('Live') after the soft-deleted 'live' restores it, with the same id", async () => {
  const id = await db.transaction((tx) => ensureCategory(tx, 'live'), system);
  await db.query('update categories set deleted_at = now() where id = $1', [id]);

  const restoredId = await db.transaction((tx) => ensureCategory(tx, 'Live'), system);
  assert.equal(restoredId, id);

  const { rows } = await db.query('select deleted_at from categories where id = $1', [id]);
  assert.equal(rows[0].deleted_at, null);
});

test('ensureCategory matches case-insensitively and inserts only once', async () => {
  const first = await db.transaction((tx) => ensureCategory(tx, 'fan meet'), system);
  const second = await db.transaction((tx) => ensureCategory(tx, 'Fan Meet'), system);
  assert.equal(first, second);
});

test('ensureClient restores a soft-deleted row before inserting a new one', async () => {
  const id = await db.transaction((tx) => ensureClient(tx, 'acme'), system);
  await db.query('update clients set deleted_at = now() where id = $1', [id]);
  const restoredId = await db.transaction((tx) => ensureClient(tx, 'ACME'), system);
  assert.equal(restoredId, id);
});

test('listCategories excludes soft-deleted rows', async () => {
  const keep = await db.transaction((tx) => ensureCategory(tx, 'kept-category'), system);
  const drop = await db.transaction((tx) => ensureCategory(tx, 'dropped-category'), system);
  await db.query('update categories set deleted_at = now() where id = $1', [drop]);

  const names = (await listCategories(db)).map((c) => c.name);
  assert.ok(names.includes('kept-category'));
  assert.ok(!names.includes('dropped-category'));
  assert.ok(keep);
});
