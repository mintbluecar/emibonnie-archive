// @ts-check
/**
 * The PGlite side of `createDb` (local dev and tests). PGlite is a dev
 * dependency, so it is imported only when a PGlite `Db` is first used.
 *
 * One instance per data directory per process (Task 9a item 3). The dev
 * server makes a `Db` per request, like the deployed function, and a
 * request's deferred work (the item page's edit-window refresh) keeps its
 * `Db` open after the response. When each `Db` opened its own
 * `new PGlite({ dataDir })`, overlapping requests ran several Postgres
 * backends on one data directory -- which Postgres never allows ("One
 * postgres instance always manages the data of exactly one database
 * cluster", postgresql.org/docs/17/app-postgres.html; PGlite runs it in
 * `--single` user mode and "is single user/connection", its README) --
 * and PGlite aborted (`RuntimeError: Aborted()`) with the directory left
 * corrupt. PGlite 0.5.10 already queues queries and transactions *within*
 * an instance (`#queryMutex`/`#transactionMutex`, src/pglite.ts), so
 * sharing the instance is enough. `end()` releases this `Db`'s hold; the
 * last one closes the instance, and a later open waits for that close.
 * In-memory databases (no `dir`) stay one instance per `Db`.
 */
import path from 'node:path';
import { PGLITE_PARSERS, assertActor } from './common.js';

/** @typedef {import('./common.js').Db} Db */
/** @typedef {import('./common.js').Tx} Tx */
/** @typedef {import('@electric-sql/pglite').PGlite} PGlite */
/** @typedef {Pick<import('@electric-sql/pglite').Transaction, 'query' | 'exec'>} PgliteSession */

/**
 * @param {string | undefined} dir
 * @returns {Promise<PGlite>}
 */
async function openPglite(dir) {
  const { PGlite } = await import('@electric-sql/pglite');
  // eslint-import-resolver-node doesn't follow package.json subpath exports
  // (`./contrib/*`); the path is the one PGlite documents for pg_trgm.
  // eslint-disable-next-line import/no-unresolved
  const { pg_trgm } = await import('@electric-sql/pglite/contrib/pg_trgm');
  const pg = new PGlite({ dataDir: dir, extensions: { pg_trgm }, parsers: PGLITE_PARSERS });
  await pg.waitReady;
  return pg;
}

/** @typedef {{ pg: Promise<PGlite>, users: number }} SharedInstance */
/** @type {Map<string, SharedInstance>} open instances, by resolved data directory */
const shared = new Map();
/** @type {Map<string, Promise<void>>} instances still closing, by resolved data directory */
const closing = new Map();

/**
 * This process's instance for `dir`, opened (after any close still in
 * progress there) when it has no other user.
 * @param {string} key the resolved data directory
 * @returns {SharedInstance}
 */
function acquire(key) {
  let entry = shared.get(key);
  if (!entry) {
    const pg = (closing.get(key) ?? Promise.resolve()).then(() => openPglite(key));
    entry = { pg, users: 0 };
    shared.set(key, entry);
  }
  entry.users += 1;
  return entry;
}

/**
 * Drops one hold on `entry`; the last closes it.
 * @param {string} key @param {SharedInstance} entry
 * @returns {Promise<void>}
 */
async function release(key, entry) {
  entry.users -= 1;
  if (entry.users > 0) return;
  shared.delete(key);
  const done = entry.pg.then((pg) => pg.close()).finally(() => {
    if (closing.get(key) === done) closing.delete(key);
  });
  closing.set(key, done);
  await done;
}

/**
 * The lazy open/close pair for one `Db`: shared per directory, private in memory.
 * @param {string | undefined} dir
 * @returns {{ open: () => Promise<PGlite>, close: () => Promise<void> }}
 */
function instanceFor(dir) {
  /** @type {SharedInstance | undefined} */
  let held;
  /** @type {Promise<PGlite> | undefined} */
  let own;
  if (dir === undefined) {
    return {
      open: () => (own ??= openPglite(undefined)),
      close: async () => { if (own) await (await own).close(); },
    };
  }
  const key = path.resolve(dir);
  return {
    open: () => (held ??= acquire(key)).pg,
    close: async () => {
      if (!held) return;
      const entry = held;
      held = undefined;
      await release(key, entry);
    },
  };
}

/**
 * @param {PgliteSession} session
 * @returns {Tx}
 */
function wrapSession(session) {
  return {
    query: async (sql, params) => {
      const result = await session.query(sql, params);
      // PGlite reports affectedRows 0 for a select; node-postgres's rowCount is the row count there.
      return { rows: result.rows, rowCount: result.affectedRows || result.rows.length };
    },
    exec: async (sql) => {
      await session.exec(sql);
    },
  };
}

/**
 * PGlite has one connection: `transaction()` holds it for the whole of `fn`,
 * so `fn` must use its `tx`, never the outer `db` (that would wait forever).
 * Every `Db` on the same `dir` shares that connection, so another request's
 * query waits for the transaction too.
 * @param {string | undefined} dir
 * @param {string | undefined} searchPath
 * @returns {Db}
 */
export function createPgliteDb(dir, searchPath) {
  const { open, close } = instanceFor(dir);

  /**
   * @template T
   * @param {string | undefined} actor
   * @param {(tx: Tx) => Promise<T>} fn
   * @returns {Promise<T>}
   */
  const inTransaction = async (actor, fn) =>
    (await open()).transaction(async (session) => {
      if (searchPath) await session.query("select set_config('search_path', $1, true)", [searchPath]);
      if (actor) await session.query("select set_config('app.actor', $1, true)", [actor]);
      return fn(wrapSession(session));
    });

  return {
    query: async (sql, params) => {
      if (searchPath) return inTransaction(undefined, (tx) => tx.query(sql, params));
      return wrapSession(await open()).query(sql, params);
    },
    transaction: async (fn, options) => {
      assertActor(options?.actor);
      return inTransaction(options.actor, fn);
    },
    end: close,
  };
}
