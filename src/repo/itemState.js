// @ts-check
/**
 * itemState: the item write and listing helpers Plan 2b adds -- soft
 * delete with a reason, restore only that reason, review state, the
 * lookups a hidden item still needs, and the translator/owner listings.
 * Split from `items.js` to keep both modules under the lint line limit;
 * the visibility and event-deletion rules are the same.
 */
import { visibleItem } from './visibility.js';
import { EVENT_NOT_DELETED } from './items.js';

/** @typedef {{ query(sql: string, params?: unknown[]): Promise<{ rows: any[], rowCount?: number }> }} Tx */
/** @typedef {import('../domain/constants.js').ReviewState} ReviewState */

/**
 * Soft-deletes one item with a reason and the acting user, only if it is
 * still live. Every removal path in 2b (a translator's remove, the
 * owner's hide, a block, a rejection) writes through here so the reason
 * always says who may undo it.
 * @param {Tx} tx
 * @param {{ itemId: number, reason: string, actor: string }} input
 * @returns {Promise<boolean>} whether a live row changed
 */
export async function softDeleteItem(tx, { itemId, reason, actor }) {
  const { rowCount } = await tx.query(
    'update items set deleted_at = now(), deleted_reason = $2, deleted_by = $3 where id = $1 and deleted_at is null',
    [itemId, reason, actor],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Undoes one kind of removal and no other: the row must still carry
 * `reason`. A translator restoring their own removal can never bring back
 * the owner's hide, and vice versa.
 * @param {Tx} tx
 * @param {{ itemId: number, reason: string }} input
 * @returns {Promise<boolean>} whether a row changed
 */
export async function restoreItem(tx, { itemId, reason }) {
  const { rowCount } = await tx.query(
    'update items set deleted_at = null, deleted_reason = null, deleted_by = null where id = $1 and deleted_reason = $2',
    [itemId, reason],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Sets an item's review state, writing only a real change (so the audit
 * log records one row per decision, not one per click).
 * @param {Tx} tx
 * @param {{ itemId: number, state: import('../domain/constants.js').ReviewState }} input
 * @returns {Promise<boolean>}
 */
export async function setReviewState(tx, { itemId, state }) {
  const { rowCount } = await tx.query(
    'update items set review_state = $2 where id = $1 and review_state <> $2',
    [itemId, state],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * The item a kind and source id address, **without** any visibility
 * filter: the owner and a translator act on entries the public can't see.
 * Resolves `source_aliases` too, like `findVisibleItemId`.
 * @param {Tx} db
 * @param {{ kind: string, platform: string, externalId: string }} ref
 * @returns {Promise<number|null>}
 */
export async function findItemIdBySource(db, { kind, platform, externalId }) {
  const { rows } = await db.query(
    `select i.id from items i join item_sources s on s.item_id = i.id and s.role = 'primary'
     where i.kind = $1 and s.platform = $2
       and (s.external_id = $3 or s.id in (select source_id from source_aliases where platform = $2 and external_id = $3))
     order by i.id limit 1`,
    [kind, platform, externalId],
  );
  return rows[0]?.id ?? null;
}

/**
 * The ids of every item credited to one of `accountIds`, in any review
 * state and any deletion except `erased` -- the translator's "my
 * translations" list, which keeps removed entries listed so they can be
 * restored. Newest first; `limit + 1` is read for `hasMore`.
 * @param {Tx} db
 * @param {number[]} accountIds
 * @param {{ limit: number, offset: number }} page
 * @returns {Promise<{ ids: number[], hasMore: boolean }>}
 */
export async function translatorItemIds(db, accountIds, { limit, offset }) {
  if (accountIds.length === 0) return { ids: [], hasMore: false };
  const { rows } = await db.query(
    `select i.id from items i
     where i.credited_account_id = any($1::bigint[])
       and (i.deleted_reason is null or i.deleted_reason <> 'erased')
     order by i.id desc limit $2 offset $3`,
    [accountIds, limit + 1, offset],
  );
  const ids = rows.map((row) => row.id);
  return { ids: ids.slice(0, limit), hasMore: ids.length > limit };
}

/**
 * The deletion reason and review state of the given items, so a listing
 * can mark a row "removed by you" (restorable) or "hidden" (not).
 * @param {Tx} db
 * @param {number[]} itemIds
 * @returns {Promise<Map<number, { reason: string|null, reviewState: import('../domain/constants.js').ReviewState }>>}
 */
export async function translatorStates(db, itemIds) {
  if (itemIds.length === 0) return new Map();
  const { rows } = await db.query(
    'select id, deleted_reason, review_state from items where id = any($1::bigint[])',
    [itemIds],
  );
  return new Map(rows.map((row) => [row.id, { reason: row.deleted_reason, reviewState: row.review_state }]));
}

/**
 * A translator's totals for the welcome screen: their visible entries
 * (published, not deleted, not in a deleted event, and not hidden by an
 * opted-out account or a blocked submitter -- the same rule the public
 * pages use), how many distinct events they cover, and how many are
 * shared stories.
 * @param {Tx} db
 * @param {number[]} accountIds
 * @returns {Promise<{ translations: number, events: number, sharedStories: number }>}
 */
export async function translatorTotals(db, accountIds) {
  if (accountIds.length === 0) return { translations: 0, events: 0, sharedStories: 0 };
  const { rows } = await db.query(
    `select count(*)::int as translations,
       count(distinct i.event_id)::int as events,
       count(*) filter (where i.placement = 'shared_story')::int as shared_stories
     from items i
     where i.credited_account_id = any($1::bigint[]) and ${visibleItem('i')} and ${EVENT_NOT_DELETED}`,
    [accountIds],
  );
  const row = rows[0];
  return { translations: row.translations, events: row.events, sharedStories: row.shared_stories };
}

/**
 * The owner's waiting list: every item held for approval, oldest first
 * (first in, first reviewed). Deleted events are left out, as everywhere.
 * @param {Tx} db
 * @param {{ limit: number }} page
 * @returns {Promise<number[]>}
 */
export async function pendingItemIds(db, { limit }) {
  const { rows } = await db.query(
    `select i.id from items i
     where i.review_state = 'pending' and i.deleted_at is null and ${EVENT_NOT_DELETED}
     order by i.id asc limit $1`,
    [limit],
  );
  return rows.map((row) => row.id);
}
