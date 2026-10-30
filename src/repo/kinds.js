// @ts-check
/**
 * kinds: the `item_kinds` lookup table (one row per kind folder under
 * `src/kinds/`), compared by `scripts/setup.js` against the kinds
 * registry built at `npm run build` time.
 */

/** @typedef {import('../db/common.js').Queryable} Tx */

/** @param {Tx} db @returns {Promise<string[]>} */
export async function listItemKindCodes(db) {
  const { rows } = await db.query('select code from item_kinds order by code');
  return rows.map((row) => row.code);
}
