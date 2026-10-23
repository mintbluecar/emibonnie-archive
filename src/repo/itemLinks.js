// @ts-check
/**
 * itemLinks: directed relations between items (e.g. a shared-story part
 * that `follows_on` from another). `link` is idempotent: linking the
 * same pair under the same relation twice writes one row.
 */

/** @typedef {{ query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> }} Tx */

/**
 * @param {Tx} tx
 * @param {number} from
 * @param {number} to
 * @param {string} relation
 * @returns {Promise<void>}
 */
export async function link(tx, from, to, relation) {
  await tx.query(
    `insert into item_links (from_item_id, to_item_id, relation) values ($1, $2, $3)
     on conflict (from_item_id, to_item_id, relation) do nothing`,
    [from, to, relation],
  );
}

/**
 * @param {Tx} db
 * @param {number} itemId
 * @returns {Promise<{ toItemId: number, relation: string }[]>}
 */
export async function linksFrom(db, itemId) {
  const { rows } = await db.query('select to_item_id, relation from item_links where from_item_id = $1 order by to_item_id', [itemId]);
  return rows.map((r) => ({ toItemId: r.to_item_id, relation: r.relation }));
}
