// @ts-check
/**
 * What both drivers share: the `Db`/`Tx` shapes, the type parsers that make
 * their results identical, and argument checks.
 */

/** @typedef {{ rows: any[], rowCount: number }} QueryResult */
/**
 * Anything a repo function can run a read or write query against: `Db`
 * outside a transaction, or `Tx` inside one. Most repo functions take
 * this, not `Tx` specifically, because the same query often runs either
 * way (a read on `deps.db`, a write on the transaction's `tx`).
 * @typedef {object} Queryable
 * @property {(sql: string, params?: unknown[]) => Promise<QueryResult>} query
 */
/**
 * A transaction, with the one extra capability `Queryable` doesn't carry:
 * multi-statement SQL with no params. Only the migration runner and the
 * driver's own transaction setup need it.
 * @typedef {Queryable & { exec: (sql: string) => Promise<void> }} Tx
 */
/**
 * @typedef {object} Db
 * @property {(sql: string, params?: unknown[]) => Promise<QueryResult>} query Reads outside a transaction.
 * @property {<T>(fn: (tx: Tx) => Promise<T>, options: { actor: string }) => Promise<T>} transaction
 * @property {() => Promise<void>} end
 */
export const OID = { INT8: 20, DATE: 1082, TEXT_ARRAY: 1009, INT8_ARRAY: 1016, DATE_ARRAY: 1182 };

/**
 * `int8` → number when exact, else the original string (never a rounded number).
 * @param {string} value
 */
export function parseInt8(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : value;
}

/** @param {string} value */
export const parseDate = (value) => value;

/** Element parsers PGlite applies to arrays itself (it reuses them for `int8[]`/`date[]`). */
export const PGLITE_PARSERS = { [OID.INT8]: parseInt8, [OID.DATE]: parseDate };

/** @param {unknown} actor */
export function assertActor(actor) {
  if (typeof actor !== 'string' || actor === '') throw new TypeError('transaction() needs a non-empty { actor }');
}

/** @param {string | undefined} schema */
export function searchPathFor(schema) {
  if (schema === undefined) return undefined;
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new TypeError(`invalid schema name: ${schema}`);
  return `"${schema}", public`;
}
