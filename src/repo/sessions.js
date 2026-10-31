// @ts-check
/**
 * sessions: the web sign-in cookie's server side. Only the token's SHA-256
 * hash is stored (never the token), so a leaked table exposes no live
 * cookie. NOT audited (churn).
 */
import { createHash } from 'node:crypto';

/** @typedef {import('../db/common.js').Queryable} Tx */

/** @param {string} token */
export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Insert a session for `user` with `expiresAt`, storing the token's hash.
 * @param {Tx} tx
 * @param {{ token: string, userId: string, expiresAt: Date }} input
 * @returns {Promise<void>}
 */
export async function createSession(tx, { token, userId, expiresAt }) {
  await tx.query(
    'insert into sessions (token_hash, user_id, expires_at) values ($1, $2, $3)',
    [hashToken(token), userId, expiresAt],
  );
}

/**
 * The user id a `sid` cookie maps to, if any, and only while unexpired.
 * `now` comes from the caller so a test can pin the clock.
 * @param {Tx} db
 * @param {string} token
 * @param {Date} now
 * @returns {Promise<string|null>}
 */
export async function userIdForToken(db, token, now) {
  const { rows } = await db.query(
    'select user_id from sessions where token_hash = $1 and expires_at > $2',
    [hashToken(token), now],
  );
  return rows[0]?.user_id ?? null;
}

/**
 * Delete one session token (a sign-out), if present.
 * @param {Tx} tx
 * @param {string} token
 * @returns {Promise<void>}
 */
export async function deleteSession(tx, token) {
  await tx.query('delete from sessions where token_hash = $1', [hashToken(token)]);
}

/** @param {Tx} tx @param {string} userId */
export async function deleteUserSessions(tx, userId) {
  await tx.query('delete from sessions where user_id = $1', [userId]);
}
