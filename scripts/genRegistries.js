// @ts-check
/**
 * `npm test`'s `pretest` step. Generates `src/kinds/_registry.js` and
 * `public/js/kinds/_registry.js` once, deterministically, before any test
 * file runs -- Plan 1b Task 7 brief, carried item B: several test files
 * used to `writeFileSync` these same two generated files themselves, at
 * module load, which raced across `node --test`'s parallel worker
 * processes (first one in could be reading a half-written file another
 * was mid-overwrite on). Those files now only `import` them.
 *
 * No `site/` dependency (unlike `npm run build`): both registries are
 * built from the kind folders on disk, so this runs standalone.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeKindsRegistries } from './buildOutputs.js';
import { hashTree } from './hashTree.js';
import { TREE_HASH_PATH, TREE_HASH_DIRS } from './treeHashConfig.js';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * Also records a hash of every source tree (`treeHashConfig.js`) as it stands once the
 * registries above are generated -- the state the test run is about to
 * start from -- for `posttest` (`scripts/checkTreeHash.js`) to compare
 * against afterwards (review round 2, M2).
 */
async function main() {
  try {
    await writeKindsRegistries(REPO_ROOT);
    writeFileSync(path.join(REPO_ROOT, TREE_HASH_PATH), hashTree(TREE_HASH_DIRS.map((d) => path.join(REPO_ROOT, d))));
  } catch (/** @type {any} */ err) {
    console.error(err.message ?? String(err));
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
