// @ts-check
/**
 * The owner's event admin: rewriting an event's own fields, merging
 * events into one, and moving entries between events. The reads live in
 * `eventAdminList.js` and are re-exported here, so a caller imports one
 * module. Following a merge chain is `followMerged` (`events.js`), the one
 * place it is done; `resolveEventId` is that same function.
 */
import { linkLivePeople, linkTags } from './events.js';

export { getAdminEvent, listAdminEvents, listEventEntries } from './eventAdminList.js';
export { followMerged as resolveEventId } from './events.js';

/** @typedef {import('../db/common.js').Queryable} Tx */
/** @typedef {import('./eventAdminList.js').AdminEventRow} AdminEventRow */
/** @typedef {import('./eventAdminList.js').AdminEvent} AdminEvent */
/** @typedef {import('./eventAdminList.js').EventEntry} EventEntry */

/**
 * @param {Tx} tx @param {number} id
 * @param {{ name: string, occurredOn: string, slug: string, livePlatformCode: string|null }} fields
 * @returns {Promise<void>}
 */
export async function updateEventFields(tx, id, { name, occurredOn, slug, livePlatformCode }) {
  await tx.query(
    'update events set name = $2, occurred_on = $3, slug = $4, live_platform = $5 where id = $1',
    [id, name, occurredOn, slug, livePlatformCode],
  );
}

/**
 * The event's keywords and hashtags become exactly these (`ensureTags`,
 * through `linkTags`).
 * @param {Tx} tx @param {number} id @param {{ keywords: string[], hashtags: string[] }} tags
 * @returns {Promise<void>}
 */
export async function replaceEventTags(tx, id, { keywords, hashtags }) {
  await tx.query('delete from event_tags where event_id = $1', [id]);
  await linkTags(tx, id, keywords, hashtags);
}

/**
 * The event's `live` people become exactly `personIds`; its performer
 * and guest rows are left alone.
 * @param {Tx} tx @param {number} id @param {number[]} personIds @returns {Promise<void>}
 */
export async function replaceLivePeople(tx, id, personIds) {
  await tx.query("delete from event_people where event_id = $1 and role = 'live'", [id]);
  await linkLivePeople(tx, id, personIds);
}

/**
 * Soft-deletes each of `mergeIds`, pointing it at `keepId` (`merged_into`),
 * and copies every one of their `event_people` rows (every role) onto
 * `keepId`, skipping ones it already has. Moving their entries is the
 * caller's (`moveItemsToEvent`).
 * @param {Tx} tx @param {{ mergeIds: number[], keepId: number }} merge @returns {Promise<void>}
 */
export async function markMerged(tx, { mergeIds, keepId }) {
  await tx.query(
    `insert into event_people (event_id, person_id, role)
     select $2, person_id, role from event_people where event_id = any($1::bigint[])
     on conflict do nothing`,
    [mergeIds, keepId],
  );
  await tx.query(
    `update events set deleted_at = now(), deleted_by = current_setting('app.actor', true), merged_into = $2
     where id = any($1::bigint[])`,
    [mergeIds, keepId],
  );
}

/**
 * Places each item in `toEventId` (`placement = 'event'`, so the check
 * constraint holds) and answers, in `itemIds` order, the event each was
 * in before (`null` for one that wasn't in an event).
 * @param {Tx} tx @param {{ itemIds: number[], toEventId: number }} move
 * @returns {Promise<{ itemId: number, fromEventId: number|null }[]>}
 */
export async function moveItemsToEvent(tx, { itemIds, toEventId }) {
  const { rows } = await tx.query(
    `with before as (select id, event_id from items where id = any($1::bigint[]) for update)
     update items i set placement = 'event', event_id = $2 from before where i.id = before.id
     returning i.id, before.event_id`,
    [itemIds, toEventId],
  );
  const fromById = new Map(rows.map((row) => [row.id, row.event_id ?? null]));
  return itemIds.filter((id) => fromById.has(id)).map((id) => ({ itemId: id, fromEventId: fromById.get(id) ?? null }));
}

/**
 * Every event slug that starts with `prefix` (taken literally, not as a
 * pattern), deleted events included: the slugs `withClashSuffix` must
 * avoid.
 * @param {Tx} db @param {string} prefix @returns {Promise<Set<string>>}
 */
export async function takenSlugs(db, prefix) {
  const { rows } = await db.query('select slug from events where left(slug, length($1)) = $1', [prefix]);
  return new Set(rows.map((row) => row.slug));
}

/**
 * The events `ids` name, row-locked (`for update`, in id order so two
 * transactions lock alike) until the transaction ends: what a write
 * checks before it changes them, so a concurrent merge can't slip in
 * between the check and the write. Unknown ids are absent.
 * @param {Tx} tx @param {number[]} ids
 * @returns {Promise<Map<number, { id: number, slug: string, mergedInto: number|null, addressLocked: boolean }>>}
 */
export async function lockEvents(tx, ids) {
  const { rows } = await tx.query(
    `select id, slug, merged_into, address_locked_at is not null as address_locked
     from events where id = any($1::bigint[]) order by id for update`,
    [ids],
  );
  return new Map(rows.map((row) => [Number(row.id), {
    id: Number(row.id), slug: row.slug, mergedInto: row.merged_into === null ? null : Number(row.merged_into), addressLocked: row.address_locked,
  }]));
}

/**
 * The non-deleted items now in any of `eventIds`, row-locked like
 * `lockEvents`, in id order.
 * @param {Tx} tx @param {number[]} eventIds @returns {Promise<{ id: number, eventId: number }[]>}
 */
export async function lockLiveItemsOf(tx, eventIds) {
  const { rows } = await tx.query(
    'select id, event_id from items where event_id = any($1::bigint[]) and deleted_at is null order by id for update',
    [eventIds],
  );
  return rows.map((row) => ({ id: Number(row.id), eventId: Number(row.event_id) }));
}

/**
 * Rewrites the soft-deleted items of `fromEventIds` into `toEventId`
 * (`placement = 'event'`), so one restored later lands on a live event,
 * not a merged-away one. Non-deleted items move through
 * `moveItemsToEvent`, which the caller records and purges.
 * @param {Tx} tx @param {{ fromEventIds: number[], toEventId: number }} move @returns {Promise<void>}
 */
export async function moveDeletedItems(tx, { fromEventIds, toEventId }) {
  await tx.query(
    "update items set placement = 'event', event_id = $2 where event_id = any($1::bigint[]) and deleted_at is not null",
    [fromEventIds, toEventId],
  );
}

/** Every platform code an event's `live_platform` may name. @param {Tx} db @returns {Promise<string[]>} */
export async function listPlatforms(db) {
  const { rows } = await db.query('select code from platforms order by code');
  return rows.map((row) => row.code);
}
