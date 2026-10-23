// @ts-check
/**
 * Shared between `scripts/genRegistries.js` (`pretest`) and
 * `scripts/checkTreeHash.js` (`posttest`): every source tree `npm test`
 * must leave exactly as it found it. That's the engine's own trees
 * (`src/` now holds the page templates, `src/html/`, too), the front end
 * and the build output under `public/` (no test may build into this
 * checkout), the tests and fixtures themselves, the docs, the example,
 * and -- in a site repo -- the site's own tracked `site/`, plus the root
 * `vercel.json` (build output in the engine, tracked by a Git-integration
 * site: no test may build into this checkout). A path that doesn't exist
 * is skipped.
 */
export const TREE_HASH_PATHS = ['src', 'public', 'api', 'scripts', 'test', 'e2e', 'examples', 'docs', 'site', 'vercel.json'];
export const TREE_HASH_PATH = '.tree-hash';
