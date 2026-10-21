// @ts-check
/**
 * hubQueries: the counts and lists the hub pages (home, event, person,
 * filters) need. Visible items only (`visibility.js`).
 */
import { visibleItem } from './visibility.js';
import { EVENT_NOT_DELETED } from './items.js';

/** @typedef {{ query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> }} Tx */

const VISIBLE = `${visibleItem('i')} and ${EVENT_NOT_DELETED}`;

/**
 * @param {Tx} db
 * @returns {Promise<Map<number, Record<string, number>>>} event id -> kind -> count
 */
export async function countsByEventKind(db) {
  const { rows } = await db.query(
    `select i.event_id, i.kind, count(*)::int as n from items i
     where i.event_id is not null and ${VISIBLE} group by i.event_id, i.kind order by i.event_id, i.kind`,
  );
  /** @type {Map<number, Record<string, number>>} */
  const byEvent = new Map();
  for (const row of rows) byEvent.set(row.event_id, { ...byEvent.get(row.event_id), [row.kind]: row.n });
  return byEvent;
}

/**
 * The distinct credited accounts and people on an event's visible items.
 * @param {Tx} db
 * @param {number} eventId
 * @returns {Promise<{ accountCount: number, personIds: number[] }>}
 */
export async function eventCrowd(db, eventId) {
  const { rows } = await db.query(
    `select (select count(distinct i.credited_account_id)::int from items i where i.event_id = $1 and ${VISIBLE}) as accounts,
       coalesce((select array_agg(distinct ip.person_id order by ip.person_id) from item_people ip
         join items i on i.id = ip.item_id where i.event_id = $1 and ${VISIBLE}), '{}') as people`,
    [eventId],
  );
  return { accountCount: rows[0].accounts, personIds: rows[0].people };
}

/**
 * Counts each item once, whatever roles the person has on it.
 * @param {Tx} db
 * @param {number} personId
 * @returns {Promise<{ items: number, events: number, sharedStories: number }>}
 */
export async function personCounts(db, personId) {
  const { rows } = await db.query(
    `select count(*)::int as items, count(distinct i.event_id)::int as events,
       count(*) filter (where i.placement = 'shared_story')::int as shared
     from items i
     where exists (select 1 from item_people ip where ip.item_id = i.id and ip.person_id = $1) and ${VISIBLE}`,
    [personId],
  );
  return { items: rows[0].items, events: rows[0].events, sharedStories: rows[0].shared };
}

/**
 * The accounts credited with at least one visible item (so never an
 * opted-out one), by handle.
 * @param {Tx} db
 * @returns {Promise<{ handle: string }[]>}
 */
export async function visibleAccountHandles(db) {
  const { rows } = await db.query(
    `select a.handle from accounts a
     where a.deleted_at is null and a.opted_out_at is null
       and exists (select 1 from items i where i.credited_account_id = a.id and ${VISIBLE})
     order by lower(a.handle), a.id`,
  );
  return rows.map((row) => ({ handle: row.handle }));
}
