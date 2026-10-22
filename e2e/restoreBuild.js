// @ts-check
/**
 * `npm run e2e`'s `globalTeardown`: the engine smoke built the bundled
 * example into this checkout's build output (`public/`, `vercel.json`,
 * `src/site/generated.js`). In a repo with its own site, rebuild that
 * site, so a later `npm run dev`, deploy or committed `vercel.json` is
 * never the example's by accident. Without a site folder, nothing to do.
 */
import { existsSync } from 'node:fs';
import { runBuild } from '../scripts/build.js';

export default async function restoreBuild() {
  const siteDir = process.env.SITE_DIR ?? 'site';
  if (!existsSync(siteDir) || siteDir === 'examples/solluna') return;
  await runBuild({ siteDir });
  console.log(`e2e: rebuilt ${siteDir}/ after the engine smoke`);
}
