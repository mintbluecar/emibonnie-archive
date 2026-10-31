// @ts-check
/**
 * One-shot setup for a fresh database: migrate (and, optionally, grant
 * the app role -- `npm run migrate`'s `runMigrate`), seed from `site/`,
 * and check the kinds registry against `item_kinds`. Safe to run again
 * -- `migrate` and `seedFromSite` are both idempotent.
 */
import { fileURLToPath } from 'node:url';
import { createDb } from '../src/db/client.js';
import { loadSite } from '../src/site/loadSite.js';
import { seedFromSite } from '../src/services/seedFromSite.js';
import { listItemKindCodes } from '../src/repo/kinds.js';
import { kindsRegistry } from '../src/kinds/_registry.js';
import { runMigrate } from './migrate.js';
import { dbTargetOf, runCli, siteDirOf } from './cli.js';

/**
 * The registry codes that have no matching `item_kinds` row.
 * @param {string[]} registryCodes
 * @param {string[]} dbCodes
 * @returns {string[]}
 */
export function missingKinds(registryCodes, dbCodes) {
  const known = new Set(dbCodes);
  return registryCodes.filter((code) => !known.has(code));
}

/**
 * @param {import('../src/db/common.js').Db} db
 * @param {string[]} registryCodes
 * @returns {Promise<void>}
 */
async function assertKindsMatchDb(db, registryCodes) {
  const dbCodes = await listItemKindCodes(db);
  const missing = missingKinds(registryCodes, dbCodes);
  if (missing.length > 0) {
    throw new Error(
      `item_kinds is missing a row for: ${missing.join(', ')} -- ` +
        "add `insert into item_kinds values ('<kind>')` to the kind's migration in src/db/migrations/ " +
        '(npm run new kind <name> scaffolds one), then re-run setup',
    );
  }
}

/**
 * @param {{ siteDir?: string, db?: import('../src/db/common.js').Db, site?: import('../src/site/schema.js').Site,
 *   registryCodes?: string[], log?: (line: string) => void }} [options]
 * @returns {Promise<void>}
 */
export async function runSetup(options = {}) {
  const siteDir = options.siteDir ?? siteDirOf(process.env);
  const site = options.site ?? loadSite(siteDir);
  const log = options.log ?? console.log;
  const ownDb = !options.db;
  // Like `npm run migrate`: no DATABASE_URL and no PGLITE_DIR is refused, never a throwaway in-memory database.
  const db = options.db ?? createDb(dbTargetOf(process.env));

  try {
    await runMigrate({ db, siteDir, log });

    const seeded = await seedFromSite({ db, site });
    log(`seeded ${seeded.people} people, ${seeded.hashtags} ignored hashtags, ${seeded.categories} categories`);

    await assertKindsMatchDb(db, options.registryCodes ?? Object.keys(kindsRegistry));
  } finally {
    if (ownDb) await db.end();
  }
}

function main() {
  return runCli(({ db, siteDir, log }) => runSetup({ db, siteDir, log }), { db: 'required' });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
