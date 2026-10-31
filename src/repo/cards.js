// @ts-check
/**
 * cards: the shared fields every kind's presenter starts from, for
 * visible items only (`visibility.js`, plus "its event isn't deleted").
 * A hidden id asked for is simply missing from the result, and a
 * follows-on target that is hidden reads as none.
 */
import { visibleItem } from './visibility.js';
import { EVENT_NOT_DELETED } from './items.js';

/** @typedef {import('../db/common.js').Queryable} Tx */
/**
 * @typedef {{
 *   id: number, kind: string, placement: import('../domain/constants.js').Placement, sourceId: string,
 *   occurredOn: string, postedAt: string|null,
 *   reviewState: import('../domain/constants.js').ReviewState,
 *   account: { handle: string, displayName: string|null }|null,
 *   event: { id: number, slug: string, name: string, occurredOn: string }|null,
 *   people: { personId: number, role: string }[],
 *   followsOn: { kind: string, sourceId: string }|null,
 * }} Card
 *   `sourceId`: the primary source's external id (the item's public id).
 *   `reviewState`: always read, so the signed-in owner's own list can
 *   label a held or rejected entry (Task 12); public lists ignore it.
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
    occurredOn: row.occurred_on, postedAt: isoOrNull(row.posted_at), reviewState: row.review_state,
    account: row.account_handle === null ? null : { handle: row.account_handle, displayName: row.account_name },
    event: row.event_id === null ? null : { id: row.event_id, slug: row.event_slug, name: row.event_name, occurredOn: row.event_on },
    people: row.people ?? [],
    followsOn: row.follows_on ?? null,
  };
}

const CARDS_SELECT = `
  select i.id, i.kind, i.placement, i.occurred_on, i.posted_at, i.review_state, ps.external_id as source_id,
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
  where i.id = any($1::bigint[])`;

/**
 * @param {Tx} db
 * @param {number[]} itemIds
 * @returns {Promise<Map<number, Card>>} only the visible ones
 */
export async function loadCards(db, itemIds) {
  if (itemIds.length === 0) return new Map();
  const { rows } = await db.query(`${CARDS_SELECT} and ${visibleItem('i')} and ${EVENT_NOT_DELETED}`, [itemIds]);
  return new Map(rows.map((row) => [row.id, toCard(row)]));
}

/**
 * The signed-in submitter's own items, in any review state (Task 12's
 * "added by me"). Same card shape, but the visibility rule's published/
 * opted-out/blocked clauses are deliberately absent: the caller owns
 * these items and sees their pending or rejected text. A soft-deleted
 * item, or one in a deleted event, still has no page to link to, so it
 * stays out.
 * @param {Tx} db
 * @param {number[]} itemIds
 * @returns {Promise<Map<number, Card>>}
 */
export async function loadOwnCards(db, itemIds) {
  if (itemIds.length === 0) return new Map();
  const { rows } = await db.query(`${CARDS_SELECT} and i.deleted_at is null and ${EVENT_NOT_DELETED}`, [itemIds]);
  return new Map(rows.map((row) => [row.id, toCard(row)]));
}

/**
 * Cards for the caller's own listings, **including soft-deleted items**
 * (Plan 2b): a translator's "my translations" keeps a removed entry
 * listed, faded, with a restore control, so it still needs its preview.
 * The event must still exist; an `erased` item is filtered out by the
 * listing that asks for ids, not here.
 * @param {Tx} db
 * @param {number[]} itemIds
 * @returns {Promise<Map<number, Card>>}
 */
export async function loadCardsAny(db, itemIds) {
  if (itemIds.length === 0) return new Map();
  const { rows } = await db.query(`${CARDS_SELECT} and ${EVENT_NOT_DELETED}`, [itemIds]);
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

/**
 * @typedef {{
 *   keyword: string|null, hashtags: string[], category: string|null,
 *   submitter: { role: string, deleted: boolean, name: string|null, onX: boolean, xHandle: string|null }|null,
 * }} ItemExtras
 *   An item page's own fields: its tags as first written (`tags.display`;
 *   ignored hashtags left out), its category's name, and who submitted it.
 *   `submitter.xHandle` is null when their X account opted out.
 */

const EXTRAS_SQL = `
  select
    (select t.display from item_tags it join tags t on t.id = it.tag_id
       where it.item_id = i.id and t.kind = 'keyword' order by t.id limit 1) as keyword,
    coalesce((select array_agg(t.display order by t.id) from item_tags it join tags t on t.id = it.tag_id
       where it.item_id = i.id and t.kind = 'hashtag' and not t.ignored), '{}') as hashtags,
    (select c.name from categories c where c.id = i.category_id and c.deleted_at is null) as category,
    u.id is not null as has_user, u.role as user_role, u.deleted_at is not null as user_deleted, u.display_name as user_name,
    exists (select 1 from accounts ux where ux.user_id = u.id and ux.platform = 'x' and ux.deleted_at is null) as on_x,
    (select ux.handle from accounts ux where ux.user_id = u.id and ux.platform = 'x' and ux.deleted_at is null
       and ux.opted_out_at is null order by ux.id limit 1) as x_handle
  from items i left join users u on u.id = i.created_by
  where i.id = $1`;

/**
 * @param {Tx} db
 * @param {number} itemId an id already resolved through the visibility rule
 * @returns {Promise<ItemExtras|null>}
 */
export async function loadItemExtras(db, itemId) {
  const { rows } = await db.query(EXTRAS_SQL, [itemId]);
  const row = rows[0];
  if (!row) return null;
  const submitter = row.has_user
    ? { role: row.user_role, deleted: row.user_deleted, name: row.user_name, onX: row.on_x, xHandle: row.x_handle }
    : null;
  return { keyword: row.keyword, hashtags: row.hashtags, category: row.category, submitter };
}
