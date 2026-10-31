// @ts-check
/**
 * Test databases: a fresh, uniquely named schema per `freshDb()` call,
 * migrated there and dropped again by `end()`, so tests never see each
 * other's data. Without `TEST_DATABASE_URL` the schemas live on one
 * in-memory PGlite per test process (starting PGlite is most of a test
 * database's cost); with it, on that Postgres, so runs never collide or
 * leave data behind.
 *
 * The URL is never printed or logged here.
 */
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { neonConfig } from '@neondatabase/serverless';
import { createDb } from '../../src/db/client.js';
import { migrate } from '../../src/db/migrate.js';

/**
 * CI's plain `postgres:17` service speaks no WebSocket, which the Neon
 * driver needs, so CI runs Neon's `wsproxy` next to it and names it in
 * `TEST_WS_PROXY` (`host:port`). The driver then talks plain `ws:` to the
 * proxy, which forwards to Postgres on the private service network
 * (@neondatabase/serverless CONFIG.md: `wsProxy`, `useSecureWebSocket`,
 * `pipelineConnect`, `forceDisablePgSSL`). Unset (a Neon database), the
 * driver's defaults apply.
 */
if (process.env.TEST_WS_PROXY) {
  const proxy = process.env.TEST_WS_PROXY;
  neonConfig.wsProxy = () => `${proxy}/v1`;
  neonConfig.useSecureWebSocket = false;
  neonConfig.pipelineConnect = false;
  neonConfig.pipelineTLS = false;
  neonConfig.forceDisablePgSSL = true;
}

export const ENGINE_MIGRATIONS = fileURLToPath(new URL('../../src/db/migrations/', import.meta.url));

/** True when the suite runs against real Postgres (`TEST_DATABASE_URL`). */
export const usingPostgres = Boolean(process.env.TEST_DATABASE_URL);

/** Leftover test schemas/roles older than this are swept (from crashed runs). */
const STALE_MS = 60 * 60 * 1000;

/** A unique, sortable-by-age name: `<prefix>_<epoch ms>_<random>`. */
export function uniqueName(/** @type {string} */ prefix) {
  return `${prefix}_${Date.now()}_${randomBytes(4).toString('hex')}`;
}

/**
 * Whether `name` is exactly `uniqueName(prefix)`'s format and older than
 * `STALE_MS` at `now`. Anything else (a hand-made `fa_test_2024_backup`)
 * is never selected, so the sweep can't drop it.
 * @param {string} name
 * @param {'fa_test' | 'fa_test_app'} prefix
 * @param {number} now
 */
export function isStaleTestName(name, prefix, now) {
  const match = new RegExp(`^${prefix}_(\\d{13})_[0-9a-f]{8}$`).exec(name);
  return match !== null && Number(match[1]) < now - STALE_MS;
}

/**
 * Drops test schemas and roles left by runs that crashed before `end()`.
 * @param {import('../../src/db/client.js').Db} admin
 */
async function sweepStale(admin) {
  const now = Date.now();
  const schemas = await admin.query("select nspname as n from pg_namespace where nspname like 'fa\\_test\\_%'");
  for (const { n } of schemas.rows.filter((r) => isStaleTestName(r.n, 'fa_test', now))) {
    await admin.query(`drop schema if exists "${n}" cascade`);
  }
  const roles = await admin.query("select rolname as n from pg_roles where rolname like 'fa\\_test\\_app\\_%'");
  for (const { n } of roles.rows.filter((r) => isStaleTestName(r.n, 'fa_test_app', now))) {
    await admin.query(`drop owned by "${n}"`).catch(() => {});
    await admin.query(`drop role if exists "${n}"`).catch(() => {});
  }
}

/**
 * Installs pg_trgm in `public` (not in the first test schema that happens to
 * run 001 on a fresh server, where dropping that schema would take it along).
 * Parallel test files may race on the first install; the loser's duplicate
 * error is harmless once the extension exists.
 * @param {import('../../src/db/client.js').Db} admin
 */
async function ensureTrgmInPublic(admin) {
  try {
    await admin.query('create extension if not exists pg_trgm with schema public');
  } catch (err) {
    const { rows } = await admin.query("select 1 from pg_extension where extname = 'pg_trgm'");
    if (rows.length === 0) throw err;
  }
}

/** PGlite's in-memory prefix with a name, so every `freshDb` in this process shares one instance. */
const PGLITE_SHARED = 'memory://fa_test';

/**
 * How long the shared instance stays open with no `freshDb` using it.
 * Tests in a file run one after another, so the next one's `freshDb`
 * comes well within this and reuses the instance. It must still close at
 * the end: after DDL an open PGlite keeps a ~10 s timer pending (measured;
 * most likely Postgres's idle stats flush), which holds the test process
 * open; `close()` clears it.
 */
const IDLE_CLOSE_MS = 100;

/** @type {{ admin: Promise<import('../../src/db/client.js').Db> | undefined, users: number, idle?: NodeJS.Timeout }} */
const pglite = { admin: undefined, users: 0 };

/** Takes a hold on this process's shared PGlite, opening it (with pg_trgm in `public`) if needed. */
function holdPglite() {
  clearTimeout(pglite.idle);
  pglite.users += 1;
  pglite.admin ??= (async () => {
    const admin = createDb({ dir: PGLITE_SHARED });
    await ensureTrgmInPublic(admin);
    return admin;
  })();
  return pglite.admin;
}

/** Drops a hold; the last one closes the instance after `IDLE_CLOSE_MS` unless a new hold comes first. */
async function releasePglite() {
  pglite.users -= 1;
  if (pglite.users > 0) return;
  const admin = pglite.admin;
  pglite.idle = setTimeout(() => {
    pglite.admin = undefined;
    admin?.then((db) => db.end()).catch(() => {});
  }, IDLE_CLOSE_MS);
}

/**
 * The admin `Db` (no schema) that `freshDb` makes its schema with, the
 * options for the schema's own `Db`, and how to let the admin go again.
 * @param {string | undefined} url
 */
async function testServer(url) {
  if (url) {
    const admin = createDb({ url });
    await sweepStale(admin);
    await ensureTrgmInPublic(admin);
    return { admin, options: { url }, release: () => admin.end() };
  }
  return { admin: await holdPglite(), options: { dir: PGLITE_SHARED }, release: releasePglite };
}

/**
 * @param {{ migrated?: boolean }} [options] `migrated: false` returns an
 *   empty schema (for the migration runner's own tests).
 * @returns {Promise<import('../../src/db/client.js').Db & { schema: string }>}
 */
export async function freshDb({ migrated = true } = {}) {
  const { admin, options, release } = await testServer(process.env.TEST_DATABASE_URL);
  const schema = uniqueName('fa_test');
  await admin.query(`create schema "${schema}"`);
  const db = createDb({ ...options, schema });
  if (migrated) await migrate(db, { dirs: [{ namespace: 'engine', dir: ENGINE_MIGRATIONS }] });
  return {
    ...db,
    schema,
    async end() {
      await db.end();
      await admin.query(`drop schema if exists "${schema}" cascade`);
      await release();
    },
  };
}

/**
 * Creates a throwaway `nologin` role the current user may `set role` to,
 * runs `fn(roleName)`, then drops the role again.
 * @param {import('../../src/db/client.js').Db} db
 * @param {(role: string) => Promise<void>} fn
 */
export async function withTempRole(db, fn) {
  const role = uniqueName('fa_test_app');
  await db.transaction(async (tx) => {
    // PG16+: a CREATEROLE (non-superuser) creator needs SET on the new role to `set role` to it.
    await tx.query("select set_config('createrole_self_grant', 'set, inherit', true)");
    await tx.query(`create role "${role}" nologin`);
  }, { actor: 'system' });
  try {
    await fn(role);
  } finally {
    await db.transaction(async (tx) => {
      await tx.query(`drop owned by "${role}"`);
      await tx.query(`drop role "${role}"`);
    }, { actor: 'system' });
  }
}
