// @ts-check
/**
 * `npm run e2e:site [-- <playwright args>]` (Task 9a item 1): the browser
 * checks on this repo's own site (`playwright.site.config.js`,
 * `e2e/site.spec.js`). In the engine repo, with no `site/` (or
 * `SITE_DIR`), it skips with a message and succeeds; a site without a
 * seed fails, since there'd be no events, items or people to check.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Why the site checks can't run, or null when they can.
 * @param {string} siteDir
 * @returns {{ skip: boolean, message: string } | null}
 */
export function siteE2eBlocker(siteDir) {
  if (!existsSync(path.join(siteDir, 'site.json'))) {
    return { skip: true, message: `e2e:site skipped: no ${siteDir}/site.json here (run npm run init-site, or set SITE_DIR). The engine's own checks are npm run e2e.` };
  }
  if (!existsSync(path.join(siteDir, 'seed', 'maps.json'))) {
    return { skip: false, message: `e2e:site needs ${siteDir}/seed/maps.json: the checks visit the seeded events, items and people (docs/site-settings.md, site/seed/).` };
  }
  return null;
}

function main() {
  const siteDir = process.env.SITE_DIR ?? 'site';
  const blocker = siteE2eBlocker(siteDir);
  if (blocker) {
    (blocker.skip ? console.log : console.error)(blocker.message);
    process.exitCode = blocker.skip ? 0 : 1;
    return;
  }
  const args = ['playwright', 'test', '--config', 'playwright.site.config.js', ...process.argv.slice(2)];
  const result = spawnSync('npx', args, { stdio: 'inherit', env: { ...process.env, SITE_DIR: siteDir } });
  process.exitCode = result.status ?? 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
