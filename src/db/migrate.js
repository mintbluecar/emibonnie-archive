// @ts-check
/**
 * Checksummed migrations (ADR 0004). Each directory is its own namespace
 * (`engine`, `site`), so `engine/001_…` and `site/001_…` never collide.
 *
 * Every step takes `pg_advisory_xact_lock(hashtext('fan-archive-migrate'))`,
 * so two deploys migrating at once run one after the other.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/** @typedef {import('./common.js').Db} Db */
/** @typedef {import('./common.js').Tx} Tx */
/** @typedef {{ namespace: string, dir: string }} MigrationDir */
/** @typedef {{ namespace: string, name: string, sql: string, sha256: string }} MigrationFile */

const SYSTEM = { actor: 'system' };

const CREATE_TABLE = `create table if not exists schema_migrations (
  namespace text not null,
  name text not null,
  sha256 text not null,
  applied_at timestamptz not null default now(),
  primary key (namespace, name))`;

/** @param {Tx} tx */
const lock = (tx) => tx.query("select pg_advisory_xact_lock(hashtext('fan-archive-migrate'))");

/** @param {MigrationFile} file */
const label = (file) => `${file.namespace}/${file.name}`;

/**
 * The `.sql` files of each directory, in name order. A missing directory
 * (e.g. a site with no migrations of its own yet) contributes nothing.
 * @param {MigrationDir[]} dirs
 * @returns {MigrationFile[]}
 */
export function readMigrationFiles(dirs) {
  return dirs.flatMap(({ namespace, dir }) => {
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((name) => name.endsWith('.sql'))
      .sort()
      .map((name) => {
        const sql = readFileSync(path.join(dir, name), 'utf8');
        return { namespace, name, sql, sha256: createHash('sha256').update(sql).digest('hex') };
      });
  });
}

/**
 * @param {Tx} tx
 * @returns {Promise<Map<string, string>>} `namespace/name` → sha256
 */
async function appliedChecksums(tx) {
  const { rows } = await tx.query('select namespace, name, sha256 from schema_migrations');
  return new Map(rows.map((r) => [`${r.namespace}/${r.name}`, r.sha256]));
}

/**
 * Throws if any applied file's contents changed since it ran.
 * @param {MigrationFile[]} files
 * @param {Map<string, string>} applied
 */
function assertUnchanged(files, applied) {
  for (const file of files) {
    const recorded = applied.get(label(file));
    if (recorded !== undefined && recorded !== file.sha256) {
      throw new Error(`checksum mismatch: ${label(file)} was edited after it was applied`);
    }
  }
}

/**
 * Applies one file in its own transaction, unless a concurrent run already did.
 * @param {Db} db
 * @param {MigrationFile} file
 * @returns {Promise<boolean>} whether this call applied it
 */
async function applyFile(db, file) {
  return db.transaction(async (tx) => {
    await lock(tx);
    const applied = await appliedChecksums(tx);
    assertUnchanged([file], applied);
    if (applied.has(label(file))) return false;
    await tx.exec(file.sql);
    await tx.query('insert into schema_migrations (namespace, name, sha256) values ($1, $2, $3)', [
      file.namespace,
      file.name,
      file.sha256,
    ]);
    return true;
  }, SYSTEM);
}

/**
 * @param {Db} db
 * @param {{ dirs: MigrationDir[] }} options
 * @returns {Promise<string[]>} the files applied by this run, as `namespace/name`
 */
export async function migrate(db, { dirs }) {
  const files = readMigrationFiles(dirs);
  const pending = await db.transaction(async (tx) => {
    await lock(tx);
    await tx.exec(CREATE_TABLE);
    const applied = await appliedChecksums(tx);
    assertUnchanged(files, applied);
    return files.filter((file) => !applied.has(label(file)));
  }, SYSTEM);
  /** @type {string[]} */
  const done = [];
  for (const file of pending) {
    if (await applyFile(db, file)) done.push(label(file));
  }
  return done;
}
