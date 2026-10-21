// @ts-check
/**
 * The database client: one `Db` shape over two drivers.
 *
 * - With `url`: a Neon `Pool` (`@neondatabase/serverless`, node-postgres API).
 * - Without: PGlite (`dir`, or in memory), loaded lazily so production
 *   installs never need it, with `pg_trgm` loaded at construction.
 *
 * Both drivers return `date` as the raw `'YYYY-MM-DD'` string and `int8` as
 * a JS number (an exact string beyond `Number.MAX_SAFE_INTEGER`), because
 * the two drivers' defaults differ (docs/spikes.md, Step 2).
 *
 * Writes must go through `transaction(fn, { actor })`: it sets `app.actor`
 * transaction-locally, and the `set_common` trigger refuses writes without it.
 */
import { Pool, types } from '@neondatabase/serverless';
import { OID, assertActor, parseDate, parseInt8, searchPathFor } from './common.js';
import { createPgliteDb } from './pglite.js';

/** @typedef {import('./common.js').QueryResult} QueryResult */
/** @typedef {import('./common.js').Tx} Tx */
/** @typedef {import('./common.js').Db} Db */
/**
 * @typedef {object} DbOptions
 * @property {string} [url] Postgres connection string (Neon pooled endpoint in production).
 * @property {string} [dir] PGlite data directory; omitted means in memory.
 * @property {string} [schema] Tests only: every statement runs with `search_path = <schema>, public`.
 */

/** node-postgres-style type overrides for the Neon pool (arrays need their own entry). */
function neonTypes() {
  const textArray = types.getTypeParser(OID.TEXT_ARRAY);
  /** @type {Record<number, (value: string) => unknown>} */
  const overrides = {
    [OID.INT8]: parseInt8,
    [OID.DATE]: parseDate,
    [OID.INT8_ARRAY]: (value) => textArray(value).map(parseInt8),
    [OID.DATE_ARRAY]: (value) => textArray(value),
  };
  return {
    /** @param {number} oid @param {any} [format] */
    getTypeParser: (oid, format) => overrides[oid] ?? types.getTypeParser(oid, format),
  };
}

/**
 * @param {import('@neondatabase/serverless').PoolClient} client
 * @returns {Tx}
 */
function wrapClient(client) {
  return {
    query: async (sql, params) => {
      const result = await client.query(sql, params);
      return { rows: result.rows, rowCount: result.rowCount ?? result.rows.length };
    },
    // Without params node-postgres uses the simple query protocol, which accepts several statements.
    exec: async (sql) => {
      await client.query(sql);
    },
  };
}

/**
 * Runs `fn` on one checked-out client inside `begin … commit`. On a pooled
 * endpoint only a transaction is guaranteed one backend, so `search_path`
 * and `app.actor` are both set transaction-locally here.
 * @template T
 * @param {Pool} pool
 * @param {{ searchPath?: string, actor?: string }} settings
 * @param {(tx: Tx) => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function inNeonTransaction(pool, settings, fn) {
  const client = await pool.connect();
  /** @type {Error | undefined} */
  let broken;
  try {
    await client.query('begin');
    if (settings.searchPath) await client.query("select set_config('search_path', $1, true)", [settings.searchPath]);
    if (settings.actor) await client.query("select set_config('app.actor', $1, true)", [settings.actor]);
    const result = await fn(wrapClient(client));
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback').catch((/** @type {Error} */ rollbackErr) => {
      broken = rollbackErr;
    });
    throw err;
  } finally {
    // A client whose rollback failed is in an unknown state: destroy it rather than return it to the pool.
    client.release(broken);
  }
}

/**
 * @param {string} url
 * @param {string | undefined} searchPath
 * @returns {Db}
 */
function createNeonDb(url, searchPath) {
  const pool = new Pool({ connectionString: url, types: neonTypes() });
  return {
    query: async (sql, params) => {
      if (searchPath) return inNeonTransaction(pool, { searchPath }, (tx) => tx.query(sql, params));
      const result = await pool.query(sql, params);
      return { rows: result.rows, rowCount: result.rowCount ?? result.rows.length };
    },
    transaction: async (fn, options) => {
      assertActor(options?.actor);
      return inNeonTransaction(pool, { searchPath, actor: options.actor }, fn);
    },
    end: () => pool.end(),
  };
}

/**
 * @param {DbOptions} [options]
 * @returns {Db}
 */
export function createDb({ url, dir, schema } = {}) {
  const searchPath = searchPathFor(schema);
  return url ? createNeonDb(url, searchPath) : createPgliteDb(dir, searchPath);
}
