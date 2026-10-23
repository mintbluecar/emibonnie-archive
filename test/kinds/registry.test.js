// @ts-check
/**
 * `src/kinds/_registry.js` is generated once, before any test file runs,
 * by `npm test`'s `pretest` step (`scripts/genRegistries.js`) -- not by
 * this file. See scripts/buildOutputs.js's `writeKindsRegistries` doc
 * comment (Plan 1b Task 7 brief, carried item B) for why.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

test('the generated registry maps each kind folder to its Kind object', async () => {
  const { kindsRegistry } = await import('../../src/kinds/_registry.js');
  assert.ok(Object.keys(kindsRegistry).includes('translation'));
  for (const [folder, kind] of Object.entries(kindsRegistry)) {
    assert.equal(kind.name, folder);
    assert.equal(typeof kind.draft, 'function');
  }
});
