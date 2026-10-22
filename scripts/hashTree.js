// @ts-check
/**
 * A stable content hash of every file under each of `dirs` -- gitignored
 * files included, since this is a runtime integrity check (review round
 * 2, M2), not a git operation. Used by `scripts/genRegistries.js`
 * (`pretest`) and `scripts/checkTreeHash.js` (`posttest`) to prove
 * `npm test` wrote nothing under any source tree (`treeHashConfig.js`): carried item B's
 * guard test only greps test sources for the one pattern that caused the
 * original registry-write race, which would miss any other write by any
 * other cause. A missing directory (e.g. no `site/` yet) is skipped. A
 * few hundred files, a few MB -- well under the ~2s budget the brief
 * allows before falling back to a `git status --porcelain` check.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/** @param {string} dir @returns {string[]} */
function filesUnder(dir) {
  /** @type {string[]} */
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

/**
 * @param {string[]} dirs
 * @returns {string}
 */
export function hashTree(dirs) {
  const hash = createHash('sha256');
  const files = dirs.filter((dir) => existsSync(dir)).flatMap((dir) => filesUnder(dir)).sort();
  for (const file of files) {
    hash.update(file);
    hash.update(readFileSync(file));
  }
  return hash.digest('hex');
}
