// @ts-check
/**
 * `DATABASE_URL=<production> npm run pull-prod [-- --dir .devdb]`: replaces
 * a local PGlite database (`PGLITE_DIR`, default `.devdb`) with a copy of
 * the production data, for looking at every screen with real data
 * (`DEV_AS=owner PGLITE_DIR=.devdb npm run dev`). Local development only.
 *
 * Production is only read. The local database is rebuilt from this
 * checkout's migrations, so production must have applied exactly the same
 * ones, else it stops before copying. Every table is copied row for row
 * with triggers off (no audit rows, `updated_at` kept), except login
 * sessions and rate limits, which stay on production; identity counters
 * are then moved past the copied ids.
 *
 * The local database is only replaced once the copy has fully succeeded:
 * production is reached first, the copy is built in a temp folder beside
 * the target, and only then swapped into place, so a bad `DATABASE_URL`
 * or a migration mismatch leaves the old one as it was. The target must
 * be missing, empty, or already a PGlite data folder, and never this
 * checkout or a folder holding it.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createDb } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { migrationDirs } from './migrate.js';

/** Tables left behind: per-browser login state and per-IP counters. `schema_migrations` is the local migrate's own. */
const SKIPPED = new Set(['sessions', 'rate_limits', 'schema_migrations']);

/** Rows per insert. */
const BATCH = 500;

/** @param {string} name */
const ident = (name) => `"${name.replaceAll('"', '""')}"`;

/** @param {import('../src/db/common.js').Db} db */
async function migrationsOf(db) {
  const { rows } = await db.query('select namespace, name, sha256 from schema_migrations order by namespace, name');
  return rows.map((r) => `${r.namespace}/${r.name} ${r.sha256}`);
}

/**
 * Stops unless both databases applied the same migration files, byte for byte.
 * @param {import('../src/db/common.js').Db} source @param {import('../src/db/common.js').Db} target
 */
export async function assertSameMigrations(source, target) {
  const [from, to] = await Promise.all([migrationsOf(source), migrationsOf(target)]);
  const missing = from.filter((m) => !to.includes(m)).map((m) => m.split(' ')[0]);
  const extra = to.filter((m) => !from.includes(m)).map((m) => m.split(' ')[0]);
  if (missing.length === 0 && extra.length === 0) return;
  const lines = [
    ...(missing.length > 0 ? [`production has migrations this checkout does not: ${missing.join(', ')} (pull the latest code)`] : []),
    ...(extra.length > 0 ? [`this checkout has migrations production has not applied: ${extra.join(', ')} (migrate production, or check out its release)`] : []),
  ];
  throw new Error(lines.join('\n'));
}

/** @param {import('../src/db/common.js').Db} db @returns {Promise<string[]>} */
async function tablesOf(db) {
  const { rows } = await db.query(
    `select table_name from information_schema.tables
     where table_schema = current_schema() and table_type = 'BASE TABLE' order by table_name`,
  );
  return rows.map((r) => r.table_name).filter((name) => !SKIPPED.has(name));
}

/**
 * The columns an insert may write, and whether one is `generated always as identity`.
 * @param {any} tx @param {string} table
 */
async function columnsOf(tx, table) {
  const { rows } = await tx.query(
    `select column_name, is_identity, identity_generation, is_generated from information_schema.columns
     where table_schema = current_schema() and table_name = $1 order by ordinal_position`,
    [table],
  );
  /** @type {{ column_name: string, is_identity: string, identity_generation: string|null, is_generated: string }[]} */
  const cols = rows;
  const writable = cols.filter((r) => r.is_generated !== 'ALWAYS');
  return {
    names: writable.map((r) => r.column_name),
    identity: cols.filter((r) => r.is_identity === 'YES').map((r) => r.column_name),
    overriding: cols.some((r) => r.identity_generation === 'ALWAYS'),
  };
}

/**
 * Every row of `table`, each as its JSON text. Text, not parsed: a bigint
 * past 2^53 would lose digits in a JS number.
 * @param {import('../src/db/common.js').Db} source @param {string} table
 * @returns {Promise<string[]>}
 */
async function rowsOf(source, table) {
  const { rows } = await source.query(`select to_jsonb(t)::text as row from ${ident(table)} t`);
  return rows.map((r) => r.row);
}

/**
 * @param {any} tx @param {string} table @param {{ names: string[], overriding: boolean }} columns @param {string[]} rows
 */
async function insertRows(tx, table, columns, rows) {
  const list = columns.names.map(ident).join(', ');
  for (let i = 0; i < rows.length; i += BATCH) {
    await tx.query(
      `insert into ${ident(table)} (${list}) ${columns.overriding ? 'overriding system value' : ''}
       select ${list} from jsonb_populate_recordset(null::${ident(table)}, $1::jsonb)`,
      [`[${rows.slice(i, i + BATCH).join(',')}]`],
    );
  }
}

/** @param {any} tx @param {string} table @param {string[]} identity */
async function bumpIdentities(tx, table, identity) {
  for (const column of identity) {
    await tx.query(
      `select setval(pg_get_serial_sequence($1, $2), coalesce((select max(${ident(column)}) from ${ident(table)}), 0) + 1, false)`,
      [ident(table), column],
    );
  }
}

/**
 * Copies `source` into `target`, which must be freshly migrated with the
 * same migrations. Returns the row count per table.
 * @param {{ source: import('../src/db/common.js').Db, target: import('../src/db/common.js').Db, log?: (line: string) => void }} input
 * @returns {Promise<Record<string, number>>}
 */
export async function copyDatabase({ source, target, log = () => {} }) {
  await assertSameMigrations(source, target);
  const tables = await tablesOf(target);
  /** @type {Record<string, string[]>} */
  const data = {};
  for (const table of tables) data[table] = await rowsOf(source, table);
  await target.transaction(async (tx) => {
    // Replica mode skips triggers and foreign-key checks for this transaction, so rows land
    // exactly as production has them, in any order (PostgreSQL docs: session_replication_role).
    await tx.query('set local session_replication_role = replica');
    // Cascade: the skipped tables (sessions) reference users, and are emptied with it.
    await tx.query(`truncate ${tables.map(ident).join(', ')} cascade`);
    for (const table of tables) {
      const columns = await columnsOf(tx, table);
      await insertRows(tx, table, columns, data[table]);
      await bumpIdentities(tx, table, columns.identity);
      log(`${table}: ${data[table].length}`);
    }
  }, { actor: 'system' });
  return Object.fromEntries(tables.map((t) => [t, data[t].length]));
}

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * Stops unless `dir` is safe to replace wholesale: not `repoRoot` or a
 * folder containing it, and either missing, an empty folder, or a PGlite
 * data folder (it holds `PG_VERSION`, as every Postgres data folder does).
 * @param {string} dir @param {string} repoRoot
 */
export function assertReplaceableTarget(dir, repoRoot) {
  const target = path.resolve(dir);
  const fromTarget = path.relative(target, path.resolve(repoRoot));
  if (fromTarget === '' || (!fromTarget.startsWith('..') && !path.isAbsolute(fromTarget))) {
    throw new Error(`refusing to replace ${target}: it is this checkout or holds it`);
  }
  if (!existsSync(target)) return;
  if (!statSync(target).isDirectory()) throw new Error(`refusing to replace ${target}: it is a file, not a database folder`);
  if (readdirSync(target).length === 0 || existsSync(path.join(target, 'PG_VERSION'))) return;
  throw new Error(`refusing to replace ${target}: it is not empty and not a PGlite data folder`);
}

/**
 * Copies `source` into a fresh PGlite database at `dir`: checks `dir`
 * (`assertReplaceableTarget`), reaches `source` before anything is
 * written, builds and copies into a temp folder beside `dir`, and swaps it
 * into place only once the copy succeeded. Any failure leaves `dir` as it
 * was and removes the temp folder. Returns the row count per table.
 * @param {{ source: import('../src/db/common.js').Db, dir: string, dirs: { namespace: string, dir: string }[], repoRoot?: string, log?: (line: string) => void }} input
 * @returns {Promise<Record<string, number>>}
 */
export async function pullInto({ source, dir, dirs, repoRoot = REPO_ROOT, log = () => {} }) {
  const target = path.resolve(dir);
  assertReplaceableTarget(target, repoRoot);
  await source.query('select 1');
  mkdirSync(path.dirname(target), { recursive: true });
  const building = mkdtempSync(path.join(path.dirname(target), `.${path.basename(target)}.pull-`));
  /** @type {Record<string, number>} */
  let counts;
  try {
    const db = createDb({ dir: building });
    try {
      await migrate(db, { dirs });
      counts = await copyDatabase({ source, target: db, log });
    } finally {
      await db.end();
    }
  } catch (err) {
    rmSync(building, { recursive: true, force: true });
    throw err;
  }
  if (existsSync(target)) {
    const old = `${building}.old`;
    renameSync(target, old);
    renameSync(building, target);
    rmSync(old, { recursive: true, force: true });
  } else {
    renameSync(building, target);
  }
  return counts;
}

async function main() {
  const { values } = parseArgs({ args: process.argv.slice(2), options: { dir: { type: 'string' } } });
  const dir = values.dir ?? process.env.PGLITE_DIR ?? '.devdb';
  const url = process.env.DATABASE_URL;
  if (process.env.VERCEL) throw new Error('pull-prod is for local development only');
  if (!url) throw new Error('set DATABASE_URL to the production connection string (the app role is enough: this only reads)');
  const source = createDb({ url });
  try {
    const counts = await pullInto({ source, dir, dirs: migrationDirs(process.env.SITE_DIR ?? 'site'), log: console.log });
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    console.log(`copied ${total} rows into ${dir}; run: DEV_AS=owner PGLITE_DIR=${dir} npm run dev`);
  } finally {
    await source.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((/** @type {any} */ err) => {
    // The message only: a connection error must not print the connection string.
    console.error(String(err?.message ?? err));
    process.exitCode = 1;
  });
}
