// @ts-check
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { PLACEMENTS, REVIEW_STATES, ROLES } from '../../src/domain/constants.js';
import { freshDb } from '../helpers/db.js';

/** @type {Awaited<ReturnType<typeof freshDb>>} */
let db;
before(async () => { db = await freshDb(); });
after(async () => { await db.end(); });

/** The quoted literals of a check constraint, e.g. `CHECK (x = ANY (ARRAY['a'::text, 'b'::text]))` → ['a', 'b']. */
function literals(/** @type {string} */ def) {
  return [...def.matchAll(/'([^']*)'::text/g)].map((m) => m[1]);
}

/** @param {string} where @param {unknown[]} params */
async function checkLiterals(where, params) {
  const { rows } = await db.query(`select pg_get_constraintdef(oid) as def from pg_constraint where ${where}`, params);
  assert.equal(rows.length, 1, `exactly one constraint for ${where} ${params}`);
  return literals(rows[0].def);
}

test('items.placement check equals PLACEMENTS', async () => {
  assert.deepEqual(await checkLiterals("conrelid = 'items'::regclass and conname = $1", ['items_placement_check']), PLACEMENTS);
});

test('items.review_state check equals REVIEW_STATES', async () => {
  assert.deepEqual(await checkLiterals("conrelid = 'items'::regclass and conname = $1", ['items_review_state_check']), REVIEW_STATES);
});

test('the speaker_role domain equals ROLES', async () => {
  assert.deepEqual(await checkLiterals("contypid = $1::regtype", ['speaker_role']), ROLES);
});

test("item_kinds rows equal the kinds registry's names", async () => {
  // Generated once, before any test file runs, by npm test's pretest step (scripts/genRegistries.js).
  const { kindsRegistry } = await import('../../src/kinds/_registry.js');
  const names = Object.values(kindsRegistry).map((k) => k.name).sort();
  const { rows } = await db.query('select code from item_kinds order by code');
  assert.deepEqual(rows.map((r) => r.code), names);
});
