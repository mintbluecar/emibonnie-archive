// @ts-check
/**
 * Delete my account (Plan 2a Task 11): the signed-in user removes their
 * sign-in record. Sessions end, the `users` row is soft-deleted (name and
 * meta cleared), and their accounts are unlinked. Items stay, and their
 * "added by" becomes "a fan" (the deleted row has no name).
 */
import { deleteUserSessions } from '../repo/sessions.js';
import { serializeCookie } from '../domain/cookies.js';
import { write } from './write.js';

const COOKIE_NAME = 'sid';

/**
 * @param {{ db: import('../db/common.js').Db, env?: Record<string, string|undefined>,
 *   invalidateByTag?: (tags: string[]) => Promise<void>,
 *   defer?: (task: () => Promise<unknown>) => void, log?: (line: string) => void }} deps
 * @param {string} userId
 * @returns {Promise<string>} the cleared session cookie
 */
export async function deleteAccount(deps, userId) {
  await write(deps, userId, async (w) => {
    await deleteUserSessions(w.tx, userId);
    await w.tx.query(`update users set deleted_at = now(), display_name = null, meta = '{}'::jsonb where id = $1`, [userId]);
    await w.tx.query('update accounts set user_id = null where user_id = $1', [userId]);
    // Their items stay, but "added by" now reads "a fan": purge each page.
    const { rows } = await w.tx.query(
      `select id from items where created_by = $1 and (deleted_reason is null or deleted_reason <> 'erased') order by id`,
      [userId],
    );
    for (const row of rows) w.purge.item(row.id);
  });
  return serializeCookie(COOKIE_NAME, '', { maxAge: 0 });
}
