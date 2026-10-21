// @ts-check
/**
 * One-shot setup for a fresh database: migrate, seed from `site/`, check
 * the kinds registry against `item_kinds`, and (optionally) grant the
 * app role. Safe to run again -- `migrate` and `seedFromSite` are both
 * idempotent.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb, dbOptionsFromEnv } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { loadSite } from '../src/site/loadSite.js';
import { seedFromSite } from '../src/services/seedFromSite.js';
import { listItemKindCodes } from '../src/repo/kinds.js';
import { grantAppRole } from '../src/repo/roles.js';
import { kindsRegistry } from '../src/kinds/_registry.js';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
export const ENGINE_MIGRATIONS = path.join(REPO_ROOT, 'src/db/migrations');

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
        'add an insert into item_kinds for it in a migration (src/kinds/<kind>/migrations/), then re-run setup',
    );
  }
}

/**
 * @param {import('../src/db/common.js').Db} db
 * @param {(line: string) => void} log
 * @returns {Promise<void>}
 */
async function grantAppRoleIfConfigured(db, log) {
  const role = process.env.APP_DB_ROLE;
  if (!role) {
    log('hint: set APP_DB_ROLE=<role> to grant it write access on this schema after migrating');
    return;
  }
  await db.transaction((tx) => grantAppRole(tx, role), { actor: 'system' });
  log(`granted the app role to ${role}`);
}

/**
 * @param {{ siteDir?: string, db?: import('../src/db/common.js').Db, site?: import('../src/site/schema.js').Site,
 *   registryCodes?: string[], log?: (line: string) => void }} [options]
 * @returns {Promise<void>}
 */
export async function runSetup(options = {}) {
  const siteDir = options.siteDir ?? process.env.SITE_DIR ?? 'site';
  const site = options.site ?? loadSite(siteDir);
  const log = options.log ?? console.log;
  const ownDb = !options.db;
  const db = options.db ?? createDb(dbOptionsFromEnv(process.env));

  try {
    const applied = await migrate(db, {
      dirs: [
        { namespace: 'engine', dir: ENGINE_MIGRATIONS },
        { namespace: 'site', dir: path.join(siteDir, 'migrations') },
      ],
    });
    for (const label of applied) log(`migrated ${label}`);

    const seeded = await seedFromSite({ db, site });
    log(`seeded ${seeded.people} people, ${seeded.hashtags} ignored hashtags, ${seeded.categories} categories`);

    await assertKindsMatchDb(db, options.registryCodes ?? Object.keys(kindsRegistry));
    await grantAppRoleIfConfigured(db, log);
  } finally {
    if (ownDb) await db.end();
  }
}

async function main() {
  try {
    await runSetup();
  } catch (/** @type {any} */ err) {
    console.error(err.message ?? String(err));
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
