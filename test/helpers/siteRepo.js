// @ts-check
/**
 * What a *site repo* owns, as opposed to the engine. A site repo is this
 * engine plus its tracked `site/` and whatever its owner keeps alongside:
 * site repos keep their own planning docs in `.superpowers/` and
 * `docs/superpowers/`, which name their real people, link real tweets and
 * point at their own checkouts by design. Engine checks that scan or copy
 * "the engine" skip exactly these paths (Task 9a item 1), and nothing else:
 * `test/purity.test.js` (what it scans) and
 * `test/kinds/scaffoldedKind.test.js` (what it copies).
 */
import path from 'node:path';

/** Repo-relative, `/`-separated directories a site repo owns. */
export const SITE_OWNED_DIRS = ['site', '.superpowers', 'docs/superpowers'];

/**
 * Whether a repo-relative path (either separator) is inside a site-owned directory.
 * @param {string} rel
 * @returns {boolean}
 */
export function isSiteOwned(rel) {
  const posix = rel.split(path.sep).join('/');
  return SITE_OWNED_DIRS.some((dir) => posix === dir || posix.startsWith(`${dir}/`));
}
