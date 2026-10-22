// @ts-check
/**
 * Guard against carried item B's race (task-7-brief.md) coming back:
 * `src/kinds/_registry.js` and `public/js/kinds/_registry.js` are
 * generated exactly once, by `npm test`'s `pretest` step
 * (`scripts/genRegistries.js`, which calls `scripts/buildOutputs.js`'s
 * `writeKindsRegistries`). No test file may `writeFileSync` either path
 * itself -- that's what raced across `node --test`'s parallel worker
 * processes before. A test building and writing into a *temporary*
 * directory (e.g. test/site/build.test.js's `runBuild()` cases) is fine;
 * only a literal `_registry.js` write target is flagged.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TEST_DIR = fileURLToPath(new URL('.', import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const WRITE_PATTERN = /writeFileSync\s*\([^)]*_registry\.js/;

/** @param {string} dir @returns {string[]} */
function jsFilesUnder(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return jsFilesUnder(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

test('no test file writes the generated kinds registries itself', () => {
  const offenders = jsFilesUnder(TEST_DIR)
    .filter((file) => path.resolve(file) !== path.resolve(SELF))
    .filter((file) => WRITE_PATTERN.test(readFileSync(file, 'utf8')))
    .map((file) => path.relative(TEST_DIR, file));
  assert.deepEqual(offenders, []);
});
