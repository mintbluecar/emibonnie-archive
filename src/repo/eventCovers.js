// @ts-check
/**
 * The first few visible items of each event, in the event's own order:
 * the candidates for an event card's representative picture (home page,
 * owner 2026-10-23). The caller keeps the first candidate that has a
 * picture, so an event whose opening item is text-only still gets one.
 */
import { visibleItem } from './visibility.js';
import { EVENT_NOT_DELETED } from './items.js';

/** How many items per event are looked at for a picture. */
export const COVER_CANDIDATES = 3;

/** @typedef {import('../db/common.js').Queryable} Tx */

/**
 * @param {Tx} db
 * @param {number[]} eventIds
 * @returns {Promise<Map<number, number[]>>} event id -> item ids, in event order
 */
export async function coverCandidates(db, eventIds) {
  if (eventIds.length === 0) return new Map();
  const { rows } = await db.query(
    `select event_id, id from (
       select i.event_id, i.id, row_number() over (
         partition by i.event_id
         order by i.sort_key, i.occurred_on, coalesce(i.posted_at, '-infinity'::timestamptz), i.id
       ) as n
       from items i
       where i.event_id = any($1::bigint[]) and ${visibleItem('i')} and ${EVENT_NOT_DELETED}
     ) ranked
     where n <= $2
     order by event_id, n`,
    [eventIds, COVER_CANDIDATES],
  );
  /** @type {Map<number, number[]>} */
  const out = new Map();
  for (const r of rows) {
    const key = Number(r.event_id);
    out.set(key, [...(out.get(key) ?? []), Number(r.id)]);
  }
  return out;
}
