// @ts-check
/**
 * `npm run seed-dev [-- --site-dir <dir>]`: runs setup, then loads the
 * site's synthetic sample data (`<site>/seed/maps.json`, posts served from
 * `<site>/seed/tweets/` offline) and prints `seeded <n>`. Local development
 * only.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb, dbOptionsFromEnv } from '../src/db/client.js';
import { loadSite } from '../src/site/loadSite.js';
import { offlineFetch } from '../src/sources/offlineFetch.js';
import { seedDev } from '../src/services/seedDev.js';
import { runSetup } from './setup.js';
import { runCli } from './cli.js';

/**
 * @param {{ siteDir: string, db?: import('../src/db/common.js').Db, log?: (line: string) => void }} options
 * @returns {Promise<import('../src/services/ingest.js').IngestResult[]>}
 */
export async function runSeedDev({ siteDir, db: given, log = console.log }) {
  const site = loadSite(siteDir);
  const db = given ?? createDb(dbOptionsFromEnv(process.env));
  try {
    await runSetup({ siteDir, site, db, log });
    const mapsPath = path.join(siteDir, 'seed', 'maps.json');
    if (!existsSync(mapsPath)) {
      log(`seeded 0 (no ${mapsPath})`);
      return [];
    }
    const maps = JSON.parse(readFileSync(mapsPath, 'utf8'));
    const deps = { db, site, fetchImpl: offlineFetch(path.join(siteDir, 'seed', 'tweets')) };
    const results = await seedDev(deps, maps);
    for (const r of results.filter((x) => x.status !== 'added')) log(`${r.sourceId}: ${r.status}`);
    log(`seeded ${results.filter((r) => r.status === 'added').length}`);
    return results;
  } finally {
    if (!given) await db.end();
  }
}

function main() {
  return runCli(({ db, siteDir, values, log }) => {
    const siteDirArg = /** @type {string | undefined} */ (values['site-dir']);
    return runSeedDev({ siteDir: siteDirArg ?? siteDir, db, log });
  }, { db: 'required', args: { 'site-dir': { type: 'string' } } });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
