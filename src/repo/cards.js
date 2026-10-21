// @ts-check
/**
 * cards: the shared fields every kind's presenter starts from, for
 * visible items only (`visibility.js`, plus "its event isn't deleted").
 * A hidden id asked for is simply missing from the result, and a
 * follows-on target that is hidden reads as none.
 */
import { visibleItem } from './visibility.js';
import { EVENT_NOT_DELETED } from './items.js';

/** @typedef {{ query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> }} Tx */
/**
 * @typedef {{
 *   id: number, kind: string, placement: string, sourceId: string,
 *   occurredOn: string, postedAt: string|null,
 *   account: { handle: string, displayName: string|null }|null,
 *   event: { id: number, slug: string, name: string, occurredOn: string }|null,
 *   people: { personId: number, role: string }[],
 *   followsOn: { kind: string, sourceId: string }|null,
 * }} Card
 *   `sourceId`: the primary source's external id (the item's public id).
 */

/** @param {unknown} value */
function isoOrNull(value) {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

/** @param {any} row @returns {Card} */
function toCard(row) {
  return {
    id: row.id, kind: row.kind, placement: row.placement, sourceId: row.source_id,
    occurredOn: row.occurred_on, postedAt: isoOrNull(row.posted_at),
    account: row.account_handle === null ? null : { handle: row.account_handle, displayName: row.account_name },
    event: row.event_id === null ? null : { id: row.event_id, slug: row.event_slug, name: row.event_name, occurredOn: row.event_on },
    people: row.people ?? [],
    followsOn: row.follows_on ?? null,
  };
}

const CARDS_SQL = `
  select i.id, i.kind, i.placement, i.occurred_on, i.posted_at, ps.external_id as source_id,
    a.handle as account_handle, a.display_name as account_name,
    e.id as event_id, e.slug as event_slug, e.name as event_name, e.occurred_on as event_on,
    (select json_agg(json_build_object('personId', ip.person_id, 'role', ip.role) order by ip.person_id, ip.role)
       from item_people ip where ip.item_id = i.id) as people,
    (select json_build_object('kind', t.kind, 'sourceId', ts.external_id)
       from item_links l join items t on t.id = l.to_item_id
       join item_sources ts on ts.item_id = t.id and ts.role = 'primary'
       where l.from_item_id = i.id and l.relation = 'follows_on' and ${visibleItem('t')}
         and not exists (select 1 from events tev where tev.id = t.event_id and tev.deleted_at is not null)
       order by t.id limit 1) as follows_on
  from items i
  join item_sources ps on ps.item_id = i.id and ps.role = 'primary'
  left join accounts a on a.id = i.credited_account_id
  left join events e on e.id = i.event_id
  where i.id = any($1::bigint[]) and ${visibleItem('i')} and ${EVENT_NOT_DELETED}`;

/**
 * @param {Tx} db
 * @param {number[]} itemIds
 * @returns {Promise<Map<number, Card>>} only the visible ones
 */
export async function loadCards(db, itemIds) {
  if (itemIds.length === 0) return new Map();
  const { rows } = await db.query(CARDS_SQL, [itemIds]);
  return new Map(rows.map((row) => [row.id, toCard(row)]));
}

/**
 * The visible item of `kind` whose primary source is `externalId` (or
 * was, before an edit: any version id resolves through `source_aliases`).
 * @param {Tx} db
 * @param {{ kind: string, platform: string, externalId: string }} ref
 * @returns {Promise<number|null>}
 */
export async function findVisibleItemId(db, { kind, platform, externalId }) {
  const { rows } = await db.query(
    `select i.id from items i join item_sources s on s.item_id = i.id and s.role = 'primary'
     where i.kind = $1 and s.platform = $2
       and (s.external_id = $3 or s.id in (select source_id from source_aliases where platform = $2 and external_id = $3))
       and ${visibleItem('i')} and ${EVENT_NOT_DELETED}
     order by i.id limit 1`,
    [kind, platform, externalId],
  );
  return rows[0]?.id ?? null;
}
