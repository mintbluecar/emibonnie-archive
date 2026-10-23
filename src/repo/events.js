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

/** @typedef {{ query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> }} Tx */
/** @typedef {import('../domain/events.js').Event} Event */
/** @typedef {import('../domain/events.js').EventProposal} EventProposal */

const SELECT = `
  select e.id, e.slug, e.name, e.occurred_on, e.category_id, e.client_id, e.live_platform,
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
  ) lp on true
  where e.deleted_at is null`;

/** @param {any} row @returns {Event} */
function toEvent(row) {
  const { livePlatform, ...rest } = /** @type {any} */ (camelRow(row));
  return { ...rest, livePlatformCode: livePlatform };
}

/** @param {Tx} db @returns {Promise<Event[]>} */
export async function listEvents(db) {
  const { rows } = await db.query(`${SELECT} order by e.occurred_on desc, e.id desc`);
  return rows.map(toEvent);
}

/** @param {Tx} db @param {string} slug @returns {Promise<Event|null>} */
export async function getEventBySlug(db, slug) {
  const { rows } = await db.query(`${SELECT} and e.slug = $1`, [slug]);
  return rows[0] ? toEvent(rows[0]) : null;
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

/** @param {Tx} tx @param {number} eventId @param {number[]} livePeopleIds */
async function linkLivePeople(tx, eventId, livePeopleIds) {
  for (const personId of livePeopleIds) {
    await tx.query("insert into event_people (event_id, person_id, role) values ($1, $2, 'live')", [eventId, personId]);
  }
}

/** @param {Tx} tx @param {number} eventId @param {string[]} keywords @param {string[]} hashtags */
async function linkTags(tx, eventId, keywords, hashtags) {
  const items = [
    ...keywords.map((display) => ({ kind: /** @type {const} */ ('keyword'), display })),
    ...hashtags.map((display) => ({ kind: /** @type {const} */ ('hashtag'), display })),
  ];
  const tagIds = await ensureTags(tx, items);
  for (const tagId of tagIds) {
    await tx.query('insert into event_tags (event_id, tag_id) values ($1, $2)', [eventId, tagId]);
  }
}

/**
 * Writes the event, its tags and `event_people` (`live`).
 * @param {Tx} tx
 * @param {EventProposal} proposal
 * @returns {Promise<Event>}
 */
export async function createEvent(tx, proposal) {
  const { slug, name, occurredOn, keywords = [], hashtags = [], livePeopleIds = [], livePlatformCode = null } = proposal;
  await tx.query('select pg_advisory_xact_lock(hashtext($1))', [slug]);

  const existing = await getEventBySlug(tx, slug);
  if (existing) return existing;

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
