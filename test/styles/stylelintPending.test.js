// @ts-check
/**
 * Styling system Task 5 (spec "6. Enforcement"): `scripts/stylelintPending.json`
 * is the one list of component CSS files not yet migrated onto tokens
 * and primitives -- `scripts/lintStyles.js` passes it to stylelint as
 * `ignoreFiles`, and `test/styles/classUsage.test.js` reuses it as the
 * "still pending" exception. Kept honest here: every entry must still
 * exist, so a migrated file falls out as it's removed, not silently
 * left pointing at nothing. Task 15 is expected to flip this to "must be
 * empty".
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PENDING_PATH = path.join(REPO_ROOT, 'scripts/stylelintPending.json');

/** @returns {string[]} */
function pendingList() {
  return JSON.parse(readFileSync(PENDING_PATH, 'utf8'));
}

test('scripts/stylelintPending.json is a JSON array of strings', () => {
  const pending = pendingList();
  assert.ok(Array.isArray(pending), 'must be an array');
  for (const entry of pending) assert.equal(typeof entry, 'string', `${entry} is not a string`);
});

test('every entry names a file that exists, under src/styles/components/', () => {
  const missing = pendingList().filter((rel) => !existsSync(path.join(REPO_ROOT, rel)));
  assert.deepEqual(missing, [], 'remove entries for files that no longer exist -- the list shrinks as components migrate');

  const outside = pendingList().filter((rel) => !rel.startsWith('src/styles/components/'));
  assert.deepEqual(outside, [], 'the pending list only ever names component CSS files');
});

test('no entry is listed twice', () => {
  const pending = pendingList();
  assert.deepEqual(pending, [...new Set(pending)]);
});
