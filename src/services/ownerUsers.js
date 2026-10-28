// @ts-check
/**
 * The owner's user tools (Plan 2b Task 10): search by handle or name,
 * block a submitter (hiding their live submissions) and unblock them,
 * plus clearing the X sign-in failure note. Split from `owner.js` to keep
 * both under the lint line limit.
 */
import { Conflict, NotFound } from '../domain/errors.js';
import { restoreItem, softDeleteItem } from '../repo/itemState.js';
import { set as settingsSet } from '../repo/settings.js';
import { purgeItem } from './cache.js';

/** @typedef {import('./cards.js').ViewDeps} ViewDeps */
/** @typedef {import('./session.js').SessionUser} SessionUser */

/** How many users one search shows. */
export const USER_SEARCH_LIMIT = 20;

/**
 * Finds users by X handle or chosen name, for the owner's block list.
 * Two characters minimum; the `system` row and deleted users never show.
 * @param {ViewDeps} deps
 * @param {unknown} q
 * @returns {Promise<import('../http/contracts.js').OwnerUser[]>}
 */
export async function searchUsers(deps, q) {
  const text = typeof q === 'string' ? q.trim().toLowerCase() : '';
  if (text.length < 2) return [];
  const like = `%${text.replace(/[\\%_]/g, '\\$&')}%`;
  const { rows } = await deps.db.query(
    `select u.id, u.display_name, u.blocked_at is not null as blocked,
       coalesce(u.meta->>'handle', (select a.handle from accounts a where a.user_id = u.id and a.platform = 'x' and a.deleted_at is null
          order by a.id limit 1)) as handle,
       exists(select 1 from accounts a2 where a2.user_id = u.id and a2.platform = 'x' and a2.deleted_at is null) as is_translator,
       (select count(*)::int from items i where i.created_by = u.id
          and (i.deleted_reason is null or i.deleted_reason <> 'erased')) as added_count
     from users u
     where u.role <> 'system' and u.deleted_at is null
       and (lower(coalesce(u.display_name, '')) like $1 escape '\\'
         or lower(coalesce(u.meta->>'handle', '')) like $1 escape '\\'
         or exists(select 1 from accounts a3 where a3.user_id = u.id and lower(a3.handle) like $1 escape '\\'))
     order by u.id limit $2`,
    [like, USER_SEARCH_LIMIT],
  );
  return rows.map((row) => ({
    id: row.id,
    handle: row.handle ?? null,
    displayName: row.display_name ?? null,
    blocked: row.blocked === true,
    isTranslator: row.is_translator === true,
    addedCount: row.added_count,
  }));
}

/**
 * Blocks or unblocks a submitter. Blocking hides every live submission
 * they added (`blocked_submitter`) and their session's writes 403 through
 * `requireUser`; unblocking restores exactly those, never an owner hide.
 * An item merely credited to their X account is untouched (opt-out owns
 * credit).
 * @param {ViewDeps & { env?: Record<string, string|undefined> }} deps
 * @param {{ userId: string, blocked: boolean, actor: SessionUser }} input
 * @returns {Promise<{ hidden: number, restored: number }>}
 */
export async function setBlocked(deps, { userId, blocked, actor }) {
  if (userId === 'system' || userId === actor.id) throw new Conflict('cannot_block');
  const { rows: found } = await deps.db.query('select id from users where id = $1 and deleted_at is null', [userId]);
  if (!found[0]) throw new NotFound();
  const wanting = blocked === true;
  const { rows: owned } = await deps.db.query(
    "select id from items where created_by = $1 and (deleted_reason is null or deleted_reason <> 'erased')",
    [userId],
  );
  const changed = await deps.db.transaction(async (tx) => {
    await tx.query('update users set blocked_at = case when $2 then now() else null end where id = $1', [userId, wanting]);
    /** @type {number[]} */
    const ids = [];
    for (const row of owned) {
      const ok = wanting
        ? await softDeleteItem(tx, { itemId: row.id, reason: 'blocked_submitter', actor: actor.id })
        : await restoreItem(tx, { itemId: row.id, reason: 'blocked_submitter' });
      if (ok) ids.push(row.id);
    }
    return ids;
  }, { actor: actor.id });
  for (const id of changed) await purgeItem(deps, id);
  return wanting ? { hidden: changed.length, restored: 0 } : { hidden: 0, restored: changed.length };
}

/**
 * Clears the owner's "an X sign-in failed" note.
 * @param {{ db: import('../db/common.js').Db }} deps
 * @param {string} actor
 * @returns {Promise<{ ok: true }>}
 */
export async function clearSignInAlert(deps, actor) {
  await deps.db.transaction((tx) => settingsSet(tx, 'xSignInFailedAt', null), { actor });
  return { ok: true };
}
