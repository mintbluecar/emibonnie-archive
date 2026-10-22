// @ts-check
/**
 * `npm run migrate`: applies pending migrations -- the engine's
 * (`src/db/migrations/`), then the site's own (`<SITE_DIR>/migrations/`),
 * each numbered in its own namespace -- and, when `APP_DB_ROLE` is set,
 * re-grants the app role. What a deploy runs before going live
 * (docs/deploy-workflow.example.yml); it never seeds (`npm run setup`
 * does, and runs this first). Safe to rerun: applied files are skipped,
 * and an applied file that changed fails loudly (ADR 0004).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb, dbOptionsFromEnv } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { grantAppRole } from '../src/repo/roles.js';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
export const ENGINE_MIGRATIONS = path.join(REPO_ROOT, 'src/db/migrations');

/**
 * Where `npm run migrate` writes: the env's `DATABASE_URL` (always, when
 * deployed) or a local PGlite directory (`PGLITE_DIR`). With neither it
 * refuses, rather than migrating a throwaway in-memory database and
 * reporting success.
 * @param {Record<string, string|undefined>} env
 * @returns {{ url?: string, dir?: string }}
 */
export function migrateTargetOf(env) {
  if (!env.DATABASE_URL && !env.PGLITE_DIR) throw new Error('DATABASE_URL is not set (set PGLITE_DIR to migrate a local dev database)');
  return dbOptionsFromEnv(env);
}

/**
 * The one line printed for a failed run: the error's message, else its
 * code, else a generic line. Never the connection string.
 * @param {any} err
 * @returns {string}
 */
export function errorText(err) {
  return err?.message || err?.code || 'database connection failed';
}

/** @param {string} siteDir @returns {import('../src/db/migrate.js').MigrationDir[]} */
export function migrationDirs(siteDir) {
  return [
    { namespace: 'engine', dir: ENGINE_MIGRATIONS },
    { namespace: 'site', dir: path.join(siteDir, 'migrations') },
  ];
}

/**
 * @param {import('../src/db/common.js').Db} db
 * @param {(line: string) => void} log
 * @returns {Promise<void>}
 */
export async function grantAppRoleIfConfigured(db, log) {
  const role = process.env.APP_DB_ROLE;
  if (!role) {
    log('hint: set APP_DB_ROLE=<role> to grant it write access on this schema after migrating');
    return;
  }
  await db.transaction((tx) => grantAppRole(tx, role), { actor: 'system' });
  log(`granted the app role to ${role}`);
}

/**
 * @param {{ siteDir?: string, db?: import('../src/db/common.js').Db, log?: (line: string) => void }} [options]
 * @returns {Promise<string[]>} the files this run applied, as `namespace/name`
 */
export async function runMigrate(options = {}) {
  const siteDir = options.siteDir ?? process.env.SITE_DIR ?? 'site';
  const log = options.log ?? console.log;
  const ownDb = !options.db;
  const db = options.db ?? createDb(migrateTargetOf(process.env));
  try {
    const applied = await migrate(db, { dirs: migrationDirs(siteDir) });
    for (const label of applied) log(`migrated ${label}`);
    if (applied.length === 0) log('migrations: up to date');
    await grantAppRoleIfConfigured(db, log);
    return applied;
  } finally {
    if (ownDb) await db.end();
  }
}

async function main() {
  try {
    await runMigrate();
  } catch (/** @type {any} */ err) {
    console.error(errorText(err));
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
