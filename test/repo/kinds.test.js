// @ts-check
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { freshDb } from '../helpers/db.js';
import { listItemKindCodes } from '../../src/repo/kinds.js';

/** @type {Awaited<ReturnType<typeof freshDb>>} */
let db;
before(async () => { db = await freshDb(); });
after(async () => { await db.end(); });

test('listItemKindCodes lists the item_kinds rows the engine migrations insert: one per kind folder', async () => {
  // Generated before any test file runs, by npm test's pretest step (scripts/genRegistries.js).
  const { kindsRegistry } = await import('../../src/kinds/_registry.js');
  const codes = await listItemKindCodes(db);
  assert.ok(codes.includes('translation'));
  assert.deepEqual(codes, Object.keys(kindsRegistry).sort());
});
