// @ts-check
/**
 * itemPeople: who an item is about/by/present for. `setItemPeople`
 * replaces the whole set for an item, but only writes the delta
 * (deletes rows no longer present, inserts rows that weren't there),
 * so the audit log on `item_people` shows exactly what changed.
 */

/** @typedef {import('../db/common.js').Queryable} Tx */
/** @typedef {{ personId: number, role: string }} ItemPerson */

/** @param {ItemPerson} p */
const key = (p) => `${p.personId}:${p.role}`;

/**
 * @param {Tx} tx
 * @param {number} itemId
 * @param {ItemPerson[]} people
 * @returns {Promise<void>}
 */
export async function setItemPeople(tx, itemId, people) {
  const { rows } = await tx.query('select person_id, role from item_people where item_id = $1', [itemId]);
  const existing = rows.map((r) => ({ personId: r.person_id, role: r.role }));
  const desiredKeys = new Set(people.map(key));
  const existingKeys = new Set(existing.map(key));

  for (const row of existing) {
    if (desiredKeys.has(key(row))) continue;
    await tx.query('delete from item_people where item_id = $1 and person_id = $2 and role = $3', [itemId, row.personId, row.role]);
  }
  for (const row of people) {
    if (existingKeys.has(key(row))) continue;
    await tx.query('insert into item_people (item_id, person_id, role) values ($1, $2, $3)', [itemId, row.personId, row.role]);
  }
}

/**
 * @param {Tx} db
 * @param {number} itemId
 * @returns {Promise<ItemPerson[]>}
 */
export async function listItemPeople(db, itemId) {
  const { rows } = await db.query('select person_id, role from item_people where item_id = $1 order by person_id, role', [itemId]);
  return rows.map((r) => ({ personId: r.person_id, role: r.role }));
}
