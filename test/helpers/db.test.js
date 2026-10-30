// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { freshDb } from './db.js';
import { get, set } from '../../src/repo/settings.js';

test('two freshDb calls in one process share a PGlite instance but not data', async () => {
  const a = await freshDb();
  const b = await freshDb();
  try {
    // One instance (or server): each sees the other's schema in the catalog.
    assert.ok(a.schema && b.schema && a.schema !== b.schema, 'each call has its own schema');
    const { rows } = await b.query('select 1 from pg_namespace where nspname = $1', [a.schema]);
    assert.equal(rows.length, 1, "b sees a's schema: same instance");
    // Both migrated; a write in one is invisible in the other.
    await a.transaction((tx) => set(tx, 'timezone', 'Asia/Bangkok'), { actor: 'system' });
    assert.equal(await get(a, 'timezone'), 'Asia/Bangkok');
    assert.equal(await get(b, 'timezone'), undefined);
  } finally {
    await a.end();
    await b.end();
  }
});
