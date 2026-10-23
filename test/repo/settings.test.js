// @ts-check
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { freshDb } from '../helpers/db.js';
import { get, set } from '../../src/repo/settings.js';

/** @type {Awaited<ReturnType<typeof freshDb>>} */
let db;
before(async () => { db = await freshDb(); });
after(async () => { await db.end(); });

const system = { actor: 'system' };

test('get returns undefined for a key with no row yet', async () => {
  assert.equal(await get(db, 'never-set'), undefined);
});

test('set stores a jsonb value that get reads back', async () => {
  await db.transaction((tx) => set(tx, 'timezone', 'Asia/Bangkok'), system);
  assert.equal(await get(db, 'timezone'), 'Asia/Bangkok');
});

test('set on an existing key overwrites its value', async () => {
  await db.transaction((tx) => set(tx, 'feature-flags', { a: true }), system);
  await db.transaction((tx) => set(tx, 'feature-flags', { a: false, b: true }), system);
  assert.deepEqual(await get(db, 'feature-flags'), { a: false, b: true });
});
