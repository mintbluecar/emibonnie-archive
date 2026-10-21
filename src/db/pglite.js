// @ts-check
/**
 * The PGlite side of `createDb` (local dev and tests). PGlite is a dev
 * dependency, so it is imported only when a PGlite `Db` is first used.
 */
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
 * @param {string | undefined} dir
 * @param {string | undefined} searchPath
 * @returns {Db}
 */
export function createPgliteDb(dir, searchPath) {
  /** @type {Promise<PGlite> | undefined} */
  let opening;
  const open = () => (opening ??= openPglite(dir));

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
    end: async () => {
      if (opening) await (await opening).close();
    },
  };
}
