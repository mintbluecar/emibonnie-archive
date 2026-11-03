// @ts-check
/**
 * events: dated groupings a post attaches to. `createEvent` takes a
 * session-level advisory lock keyed by the slug's hash (the same pattern
 * `src/db/migrate.js` uses), then returns the existing event if another
 * transaction already created this slug -- the race between two ingests
 * proposing the same new event.
 */
import { camelRow } from './rows.js';
import { ensureTags } from './tags.js';
import { visibleEvent } from './visibility.js';

/** @typedef {import('../db/common.js').Queryable} Tx */
/** @typedef {import('../domain/events.js').Event} Event */
/** @typedef {import('../domain/events.js').EventProposal} EventProposal */

/**
 * Every event with its tags and live people, with `extraColumns` (each
 * led by a comma) added to the select list; no `where`, so a caller can
 * join more and filter. The admin queries (`eventAdminList.js`) build on
 * it too, deleted events included.
 * @param {string} [extraColumns] @returns {string}
 */
export function eventSelect(extraColumns = '') {
  return `
  select e.id, e.slug, e.name, e.occurred_on, e.category_id, e.client_id, e.live_platform${extraColumns},
    coalesce(k.list, '{}') as keywords, coalesce(h.list, '{}') as hashtags, coalesce(lp.list, '{}') as live_people_ids
  from events e
  left join lateral (
    select array_agg(t.display order by t.id) as list from event_tags et join tags t on t.id = et.tag_id
    where et.event_id = e.id and t.kind = 'keyword'
  ) k on true
  left join lateral (
    select array_agg(t.display order by t.id) as list from event_tags et join tags t on t.id = et.tag_id
    where et.event_id = e.id and t.kind = 'hashtag'
  ) h on true
  left join lateral (
    select array_agg(ep.person_id) as list from event_people ep where ep.event_id = e.id and ep.role = 'live'
  ) lp on true`;
}

const SELECT = `${eventSelect()} where e.deleted_at is null`;

/** @param {any} row @returns {Event} */
export function toEvent(row) {
  const { livePlatform, ...rest } = /** @type {any} */ (camelRow(row));
  return { ...rest, livePlatformCode: livePlatform };
}

/** @param {Tx} db @returns {Promise<Event[]>} */
export async function listEvents(db) {
  const { rows } = await db.query(`${SELECT} order by e.occurred_on desc, e.id desc`);
  return rows.map(toEvent);
}

/**
 * Whether `id` names an event a caller may attach an item to (not
 * soft-deleted). Used to turn a stale or forged edit form's event id into
 * a 400 instead of a foreign-key error.
 * @param {Tx} db @param {number} id @returns {Promise<boolean>}
 */
export async function eventExists(db, id) {
  const { rows } = await db.query('select 1 from events where id = $1 and deleted_at is null', [id]);
  return rows.length > 0;
}

/** @param {Tx} db @param {string} slug @returns {Promise<Event|null>} */
export async function getEventBySlug(db, slug) {
  const { rows } = await db.query(`${SELECT} and e.slug = $1`, [slug]);
  return rows[0] ? toEvent(rows[0]) : null;
}

/** How many `merged_into` hops `followMerged` follows before giving up (a cycle, or a runaway chain). */
const MERGED_HOPS = 20;

/**
 * The event `eventId` now lives on: follows `merged_into` (at most
 * `MERGED_HOPS` hops) to the end of the chain, and answers that event's
 * id if it isn't deleted -- `eventId` itself when it was never merged.
 * `null` for an unknown id, a chain ending at a deleted, unmerged event,
 * or one longer than the bound. The one place a merged chain is followed.
 * @param {Tx} db @param {number} eventId @returns {Promise<number|null>}
 */
export async function followMerged(db, eventId) {
  const { rows } = await db.query(
    `with recursive chain (id, merged_into, deleted_at, hops) as (
       select id, merged_into, deleted_at, 0 from events where id = $1
       union all
       select e.id, e.merged_into, e.deleted_at, c.hops + 1
       from chain c join events e on e.id = c.merged_into
       where c.hops < $2
     )
     select id from chain where merged_into is null and deleted_at is null`,
    [eventId, MERGED_HOPS],
  );
  return rows[0] ? rows[0].id : null;
}

/**
 * Where a merged-away event's address now points: the slug of the event
 * it was merged into (through any chain, `followMerged`), or `null` when
 * `slug` isn't a deleted, merged event or its chain leads nowhere live.
 * @param {Tx} db @param {string} slug @returns {Promise<string|null>}
 */
export async function resolveMergedSlug(db, slug) {
  const { rows } = await db.query('select id from events where slug = $1 and deleted_at is not null and merged_into is not null', [slug]);
  if (!rows[0]) return null;
  const keptId = await followMerged(db, rows[0].id);
  if (keptId === null) return null;
  const kept = await db.query('select slug from events where id = $1', [keptId]);
  return kept.rows[0].slug;
}

/**
 * Visible events only (`visibility.js`: not deleted, with a visible item),
 * newest first, at most `limit` when given.
 * @param {Tx} db
 * @param {{ limit?: number }} [options]
 * @returns {Promise<Event[]>}
 */
export async function listVisibleEvents(db, { limit } = {}) {
  const { rows } = await db.query(
    `${SELECT} and ${visibleEvent('e')} order by e.occurred_on desc, e.id desc ${limit === undefined ? '' : 'limit $1'}`,
    limit === undefined ? [] : [limit],
  );
  return rows.map(toEvent);
}

/** @param {Tx} db @param {string} slug @returns {Promise<Event|null>} null unless visible */
export async function getVisibleEventBySlug(db, slug) {
  const { rows } = await db.query(`${SELECT} and e.slug = $1 and ${visibleEvent('e')}`, [slug]);
  return rows[0] ? toEvent(rows[0]) : null;
}

/** Adds `live` rows for the people (one each, whatever is already there). @param {Tx} tx @param {number} eventId @param {number[]} livePeopleIds */
export async function linkLivePeople(tx, eventId, livePeopleIds) {
  for (const personId of livePeopleIds) {
    await tx.query(
      "insert into event_people (event_id, person_id, role) values ($1, $2, 'live') on conflict do nothing",
      [eventId, personId],
    );
  }
}

/** Ensures and links the tags (one link per tag, whatever is already there). @param {Tx} tx @param {number} eventId @param {string[]} keywords @param {string[]} hashtags */
export async function linkTags(tx, eventId, keywords, hashtags) {
  const items = [
    ...keywords.map((display) => ({ kind: /** @type {const} */ ('keyword'), display })),
    ...hashtags.map((display) => ({ kind: /** @type {const} */ ('hashtag'), display })),
  ];
  const tagIds = await ensureTags(tx, items);
  for (const tagId of tagIds) {
    await tx.query('insert into event_tags (event_id, tag_id) values ($1, $2) on conflict do nothing', [eventId, tagId]);
  }
}

/**
 * Writes the event, its tags and `event_people` (`live`) -- unless the
 * slug is taken already: by a live event (returned as is) or by a
 * merged-away one (the event its chain ends at is returned, so an import
 * re-proposing a merged event lands in the kept one). The caller
 * resolves an undated proposal's `slug` (`eventIdOf`,
 * `src/services/ingestWrite.js`) before it reaches here.
 * @param {Tx} tx
 * @param {EventProposal & {slug: string}} proposal
 * @returns {Promise<Event>}
 */
export async function createEvent(tx, proposal) {
  const { slug, name, occurredOn, keywords = [], hashtags = [], livePeopleIds = [], livePlatformCode = null } = proposal;
  await tx.query('select pg_advisory_xact_lock(hashtext($1))', [slug]);

  const existing = await getEventBySlug(tx, slug);
  if (existing) return existing;
  const keptSlug = await resolveMergedSlug(tx, slug);
  if (keptSlug !== null) return /** @type {Event} */ (await getEventBySlug(tx, keptSlug));

  const { rows } = await tx.query(
    'insert into events (slug, name, occurred_on, live_platform) values ($1, $2, $3, $4) returning id',
    [slug, name, occurredOn, livePlatformCode],
  );
  const eventId = rows[0].id;
  await linkLivePeople(tx, eventId, livePeopleIds);
  await linkTags(tx, eventId, keywords, hashtags);
  return /** @type {Event} */ (await getEventBySlug(tx, slug));
}

/**
 * Hides an event **without moving its items**: every public query already
 * requires the event not to be deleted (`EVENT_NOT_DELETED`), so the items
 * disappear with it and come back exactly where they were when the event is
 * restored. Used by the owner's report hide (Plan 2b).
 * @param {Tx} tx
 * @param {number} id
 * @returns {Promise<boolean>}
 */
export async function hideEvent(tx, id) {
  const { rowCount } = await tx.query(
    "update events set deleted_at = now(), deleted_by = current_setting('app.actor', true) where id = $1 and deleted_at is null",
    [id],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Soft-deletes the event and moves its items to `unsorted` in the same
 * transaction.
 * @param {Tx} tx
 * @param {number} id
 * @returns {Promise<void>}
 */
export async function softDeleteEvent(tx, id) {
  await tx.query(
    "update events set deleted_at = now(), deleted_by = current_setting('app.actor', true) where id = $1 and deleted_at is null",
    [id],
  );
  await tx.query("update items set placement = 'unsorted', event_id = null where event_id = $1 and deleted_at is null", [id]);
}
