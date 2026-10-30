// @ts-check
/**
 * `npm run e2e`'s `globalTeardown`: the engine smoke built the bundled
 * example into this checkout's build output (`public/`, `vercel.json`,
 * `src/site/generated.js`). In a repo with its own site, rebuild that
 * site, so a later `npm run dev`, deploy or committed `vercel.json` is
 * never the example's by accident. Without a site folder, nothing to do.
 * Then releases this run's `.e2e-build.lock` (scripts/e2eLock.js).
 */
import { existsSync } from 'node:fs';
import { runBuild } from '../scripts/build.js';
import { E2E_LOCK_PATH, releaseE2eLock } from '../scripts/e2eLock.js';
import { siteDirOf } from '../scripts/cli.js';

export default async function restoreBuild() {
  try {
    const siteDir = siteDirOf(process.env);
    if (!existsSync(siteDir) || siteDir === 'examples/solluna') return;
    await runBuild({ siteDir }); // still under this run's build lock
    console.log(`e2e: rebuilt ${siteDir}/ after the engine smoke`);
  } finally {
    releaseE2eLock(E2E_LOCK_PATH, process.env.E2E_LOCK_TOKEN);
  }
}
