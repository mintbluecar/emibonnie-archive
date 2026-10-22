// @ts-check
/**
 * `npm test`'s `posttest` step (review round 2, M2): re-hashes every
 * source tree (`treeHashConfig.js`) and compares against the hash `pretest`
 * (`scripts/genRegistries.js`) recorded right before the test run
 * started, failing loudly if anything differs -- proof that no test
 * wrote under any of them, not just a grep for the one historical
 * cause (`test/noGeneratedRegistryWrites.test.js`).
 */
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashTree } from './hashTree.js';
import { TREE_HASH_PATH, TREE_HASH_PATHS } from './treeHashConfig.js';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

function main() {
  const hashPath = path.join(REPO_ROOT, TREE_HASH_PATH);
  if (!existsSync(hashPath)) {
    console.error(`checkTreeHash: ${TREE_HASH_PATH} is missing -- pretest (scripts/genRegistries.js) didn't run before this`);
    process.exitCode = 1;
    return;
  }
  const before = readFileSync(hashPath, 'utf8');
  const after = hashTree(TREE_HASH_PATHS.map((d) => path.join(REPO_ROOT, d)));
  rmSync(hashPath);
  if (before !== after) {
    console.error(`checkTreeHash: a source tree (${TREE_HASH_PATHS.join(', ')}) changed during the test run -- a test wrote where it shouldn't have`);
    process.exitCode = 1;
  }
}

main();
