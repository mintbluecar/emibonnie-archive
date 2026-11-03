// @ts-check
/**
 * item_edits: an entry's edit history, one row per change with the
 * changed fields' `before` and `after` values. Written by the entry edit
 * (`src/services/editItem.js`) and by event moves and merges
 * (`src/services/eventMoves.js`), so both record the same shape.
 */

/** @typedef {import('../db/common.js').Queryable} Tx */

/**
 * @param {Tx} tx
 * @param {{ itemId: number, before: Record<string, unknown>, after: Record<string, unknown>, reverts: number|null, createdBy: string }} edit
 * @returns {Promise<number>} the new row's id
 */
export async function insertItemEdit(tx, { itemId, before, after, reverts, createdBy }) {
  const { rows } = await tx.query(
    'insert into item_edits (item_id, before, after, reverts, created_by) values ($1, $2, $3, $4, $5) returning id',
    [itemId, JSON.stringify(before), JSON.stringify(after), reverts, createdBy],
  );
  return rows[0].id;
}
