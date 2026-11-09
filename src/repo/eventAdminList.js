// @ts-check
/**
 * The owner's event admin reads (`eventAdmin.js` re-exports them): every
 * event that wasn't merged away, hidden ones included, with what the
 * owner needs to judge it -- how many entries it holds (any review state)
 * and who appears in them -- and one event's entries.
 */
import { eventSelect, toEvent } from './events.js';

/** @typedef {import('../db/common.js').Queryable} Tx */
/**
 * @typedef {{ id: number, slug: string, name: string, occurredOn: string, entryCount: number,
 *   people: string[], hidden: boolean, addressLocked: boolean }} AdminEventRow
 * @typedef {AdminEventRow & { keywords: string[], hashtags: string[], livePeopleIds: number[],
 *   livePlatformCode: string|null, mergedInto: number|null }} AdminEvent
 * @typedef {{ itemId: number, kind: string, sourceId: string|null, sourceUrl: string|null, occurredOn: string,
 *   reviewState: import('../domain/constants.js').ReviewState, people: string[] }} EventEntry
 */

/** The display names of the people in a set of items, once each, alphabetical. @param {string} itemsWhere */
function peopleOf(itemsWhere) {
  return `coalesce((select array_agg(distinct p.display_name order by p.display_name)
    from items pi join item_people ip on ip.item_id = pi.id join people p on p.id = ip.person_id
    where ${itemsWhere}), '{}')`;
}

const ADMIN_SELECT = eventSelect(`,
    e.merged_into, e.deleted_at is not null as hidden, e.address_locked_at is not null as address_locked,
    (select count(*)::int from items i where i.event_id = e.id and i.deleted_at is null) as entry_count,
    ${peopleOf('pi.event_id = e.id and pi.deleted_at is null')} as people`);

/** @param {any} row @returns {AdminEvent} */
function toAdminEvent(row) {
  const { id, slug, name, occurredOn, keywords, hashtags, livePeopleIds, livePlatformCode } = toEvent(row);
  return {
    id, slug, name, occurredOn, entryCount: row.entry_count, people: row.people, hidden: row.hidden,
    addressLocked: row.address_locked, keywords, hashtags, livePeopleIds, livePlatformCode, mergedInto: row.merged_into ?? null,
  };
}

/** @param {AdminEvent} event @returns {AdminEventRow} */
function toRow({ id, slug, name, occurredOn, entryCount, people, hidden, addressLocked }) {
  return { id, slug, name, occurredOn, entryCount, people, hidden, addressLocked };
}

/**
 * The search condition over events `e` for `q` (bound as `$1`, already an
 * `ilike` pattern): its name, or any keyword or hashtag.
 */
const MATCHES_Q = `(e.name ilike $1 or exists (
  select 1 from event_tags et join tags t on t.id = et.tag_id where et.event_id = e.id and t.display ilike $1))`;

/**
 * Every event not merged away (hidden included), newest `occurred_on`
 * first, then id desc; `q` (when not blank) narrows to a name, keyword or
 * hashtag containing it. `total` counts every match, not just this page.
 * @param {Tx} db @param {{ q: string, limit: number, offset: number }} page
 * @returns {Promise<{ events: AdminEventRow[], total: number }>}
 */
export async function listAdminEvents(db, { q, limit, offset }) {
  const term = q.trim();
  const where = `e.merged_into is null${term === '' ? '' : ` and ${MATCHES_Q}`}`;
  /** @type {unknown[]} */
  const params = term === '' ? [] : [`%${term}%`];
  const { rows } = await db.query(
    `${ADMIN_SELECT} where ${where} order by e.occurred_on desc, e.id desc
     limit $${params.length + 1} offset $${params.length + 2}`,
    [...params, limit, offset],
  );
  const count = await db.query(`select count(*)::int as n from events e where ${where}`, params);
  return { events: rows.map((row) => toRow(toAdminEvent(row))), total: count.rows[0].n };
}

/**
 * One event by id, whatever its state (hidden or merged away: `mergedInto`
 * says where it went). `null` for an unknown id.
 * @param {Tx} db @param {number} id @returns {Promise<AdminEvent|null>}
 */
export async function getAdminEvent(db, id) {
  const { rows } = await db.query(`${ADMIN_SELECT} where e.id = $1`, [id]);
  return rows[0] ? toAdminEvent(rows[0]) : null;
}

/**
 * The event's non-deleted entries, any review state, in page order
 * (`occurred_on, sort_key, id`).
 * @param {Tx} db @param {number} eventId @returns {Promise<EventEntry[]>}
 */
export async function listEventEntries(db, eventId) {
  const { rows } = await db.query(
    `select i.id, i.kind, ps.external_id as source_id, ps.url as source_url, i.occurred_on, i.review_state,
       ${peopleOf('pi.id = i.id')} as people
     from items i
     left join item_sources ps on ps.item_id = i.id and ps.role = 'primary'
     where i.event_id = $1 and i.deleted_at is null
     order by i.occurred_on, i.sort_key, i.id`,
    [eventId],
  );
  return rows.map((row) => ({
    itemId: row.id, kind: row.kind, sourceId: row.source_id ?? null, sourceUrl: row.source_url ?? null, occurredOn: row.occurred_on,
    reviewState: row.review_state, people: row.people,
  }));
}
