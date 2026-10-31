// @ts-check
/**
 * settings: runtime settings the owner can change without a deploy
 * (`settings.key` -> `jsonb` value). Audited, so `set` needs an actor
 * (Rule 1, Task 8 brief).
 */

/** @typedef {import('../db/common.js').Queryable} Tx */

/**
 * @param {Tx} db
 * @param {string} key
 * @returns {Promise<unknown>} `undefined` when the key has no row yet.
 */
export async function get(db, key) {
  const { rows } = await db.query('select value from settings where key = $1', [key]);
  return rows[0] ? rows[0].value : undefined;
}

/**
 * Whether new or appended text waits for the owner's review
 * (`settings.approvalRequired`, off unless the owner turns it on).
 * @param {Tx} db
 * @returns {Promise<boolean>}
 */
export async function approvalRequired(db) {
  return (await get(db, 'approvalRequired')) === true;
}

/**
 * @param {Tx} tx
 * @param {string} key
 * @param {unknown} value
 * @returns {Promise<void>}
 */
export async function set(tx, key, value) {
  await tx.query(
    `insert into settings (key, value) values ($1, $2::jsonb)
     on conflict (key) do update set value = excluded.value`,
    [key, JSON.stringify(value)],
  );
}
