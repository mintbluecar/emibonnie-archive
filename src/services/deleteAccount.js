// @ts-check
/**
 * Delete my account (Plan 2a Task 11): the signed-in user removes their
 * sign-in record. Sessions end, the `users` row is soft-deleted (name and
 * meta cleared), and their accounts are unlinked. Items stay, and their
 * "added by" becomes "a fan" (the deleted row has no name).
 */
import { deleteUserSessions } from '../repo/sessions.js';
import { serializeCookie } from '../domain/cookies.js';

const COOKIE_NAME = 'sid';

/**
 * @param {{ db: import('../db/common.js').Db }} deps
 * @param {string} userId
 * @returns {Promise<string>} the cleared session cookie
 */
export async function deleteAccount(deps, userId) {
  await deps.db.transaction(async (tx) => {
    await deleteUserSessions(tx, userId);
    await tx.query(`update users set deleted_at = now(), display_name = null, meta = '{}'::jsonb where id = $1`, [userId]);
    await tx.query('update accounts set user_id = null where user_id = $1', [userId]);
  }, { actor: userId });
  return serializeCookie(COOKIE_NAME, '', { maxAge: 0 });
}
