// @ts-check
/**
 * rate_limits: database-backed counters (Plan 2a Task 3). One row per
 * `(key, window_start)` where `window_start` is the window floored to the
 * window length; `hits` counts requests within it. NOT audited (churn).
 */

/** @typedef {import('../db/common.js').Queryable} Tx */

/**
 * Record one hit in `key`'s current window and return the new count.
 * @param {Tx} tx
 * @param {{ key: string, windowStart: Date }} input
 * @returns {Promise<number>} the hits after this one
 */
export async function recordHit(tx, { key, windowStart }) {
  const { rows } = await tx.query(
    `insert into rate_limits (key, window_start, hits) values ($1, $2, 1)
     on conflict (key, window_start) do update set hits = rate_limits.hits + 1
     returning hits`,
    [key, windowStart],
  );
  return rows[0].hits;
}

/**
 * Opportunistically delete windows older than `before`, when told to
 * (the caller rolls the ~1% dice so tests can pin it).
 * @param {Tx} tx
 * @param {Date} before
 */
export async function pruneBefore(tx, before) {
  await tx.query('delete from rate_limits where window_start < $1', [before]);
}
