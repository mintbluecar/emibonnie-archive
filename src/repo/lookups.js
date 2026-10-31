// @ts-check
/**
 * lookups: owner-managed `categories` and `clients`. Both match
 * case-insensitively and restore a soft-deleted row before inserting a
 * new one (docs/decisions/0006-data-model-conventions.md, rule 7).
 */

/** @typedef {import('../db/common.js').Queryable} Tx */

/** The only table names ever interpolated into this file's SQL. */
const LOOKUP_TABLES = new Set(['categories', 'clients']);

/**
 * @param {Tx} tx
 * @param {'categories'|'clients'} table
 * @param {string} name
 * @returns {Promise<number>}
 */
export async function ensureLookup(tx, table, name) {
  if (!LOOKUP_TABLES.has(table)) throw new Error(`ensureLookup: unknown table '${table}'`);
  const { rows } = await tx.query(
    `select id, deleted_at from ${table} where lower(name) = lower($1) order by (deleted_at is null) desc, id desc limit 1`,
    [name],
  );
  if (rows[0]) {
    if (rows[0].deleted_at) await tx.query(`update ${table} set deleted_at = null where id = $1`, [rows[0].id]);
    return rows[0].id;
  }
  const inserted = await tx.query(`insert into ${table} (name) values ($1) returning id`, [name]);
  return inserted.rows[0].id;
}

/** @param {Tx} tx @param {string} name @returns {Promise<number>} */
export function ensureCategory(tx, name) {
  return ensureLookup(tx, 'categories', name);
}

/** @param {Tx} tx @param {string} name @returns {Promise<number>} */
export function ensureClient(tx, name) {
  return ensureLookup(tx, 'clients', name);
}

/**
 * The id of an existing, live lookup row, or null when the name isn't in
 * the list (the web add flow's `lookups:'existing'` refuses it).
 * @param {Tx} tx
 * @param {'categories'|'clients'} table
 * @param {string} name
 * @returns {Promise<number|null>}
 */
export async function findLookup(tx, table, name) {
  if (!LOOKUP_TABLES.has(table)) throw new Error(`findLookup: unknown table '${table}'`);
  const { rows } = await tx.query(`select id from ${table} where lower(name) = lower($1) and deleted_at is null order by id limit 1`, [name]);
  return rows[0]?.id ?? null;
}

/** @param {Tx} db @returns {Promise<{ id: number, name: string }[]>} */
export async function listCategories(db) {
  const { rows } = await db.query('select id, name from categories where deleted_at is null order by id');
  return rows.map((row) => ({ id: row.id, name: row.name }));
}

/** @param {Tx} db @returns {Promise<{ id: number, name: string }[]>} */
export async function listClients(db) {
  const { rows } = await db.query('select id, name from clients where deleted_at is null order by id');
  return rows.map((row) => ({ id: row.id, name: row.name }));
}
