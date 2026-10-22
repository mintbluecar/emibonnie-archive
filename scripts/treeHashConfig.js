// @ts-check
/**
 * Shared between `scripts/genRegistries.js` (`pretest`) and
 * `scripts/checkTreeHash.js` (`posttest`): every source tree `npm test`
 * must leave exactly as it found it. That's the engine's own trees
 * (`src/` now holds the page templates, `src/html/`, too), the front end
 * and the build output under `public/` (no test may build into this
 * checkout), the tests and fixtures themselves, the docs, the example,
 * and -- in a site repo -- the site's own tracked `site/`. A tree that
 * doesn't exist is skipped.
 */
export const TREE_HASH_DIRS = ['src', 'public', 'api', 'scripts', 'test', 'e2e', 'examples', 'docs', 'site'];
export const TREE_HASH_PATH = '.tree-hash';
