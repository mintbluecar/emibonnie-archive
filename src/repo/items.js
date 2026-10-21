// @ts-check
/**
 * items: the shared row every kind sits on top of. Every list/count/
 * neighbour query here is visible-only (`visibility.js`); `sourceState`
 * is the one exception -- it has to see pending and removed items too,
 * so intake can tell a visitor "already archived, awaiting review"
 * instead of silently re-fetching it.
 */
import { camelRow } from './rows.js';
import { visibleItem } from './visibility.js';

/** @typedef {{ query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> }} Tx */
/**
 * @typedef {object} ItemRow
 * @property {string} kind
 * @property {import('../domain/constants.js').Placement} placement
 * @property {number|null} [eventId]
 * @property {number|null} [categoryId]
 * @property {number|null} [clientId]
 * @property {number|null} [creditedAccountId]
 * @property {string} occurredOn
 * @property {string|null} [postedAt]
 * @property {string} addedVia
 * @property {import('../domain/constants.js').ReviewState} [reviewState]
 * @property {number|null} [sortKey]
 * @property {string|null} [deletedReason]
 */

/**
 * Resolves through `source_aliases` too, so any version id of an edited
 * post (a Twitter edit, say) counts as the same source. Only primary and
 * follow-up sources count: a post that is merely an item's media or quoted
 * original (which another translator may translate too) is not archived.
 * @param {Tx} db
 * @param {string} kind
 * @param {string} platform
 * @param {string} externalId
 * @returns {Promise<'none'|'visible'|'removed'|'pending'>}
 */
export async function sourceState(db, kind, platform, externalId) {
  const { rows } = await db.query(
    `select i.deleted_at, i.review_state, (${visibleItem('i')}) as visible
     from items i
     join item_sources s on s.item_id = i.id and s.kind = $1
     where s.platform = $2 and s.role in ('primary', 'follow_up')
       and (s.external_id = $3 or s.id in (select source_id from source_aliases where platform = $2 and external_id = $3))
     order by (${visibleItem('i')}) desc, i.id
     limit 1`,
    [kind, platform, externalId],
  );
  const row = rows[0];
  if (!row) return 'none';
  if (row.visible) return 'visible';
  if (row.deleted_at === null && row.review_state === 'pending') return 'pending';
  return 'removed';
}

/** Defaults for the optional `ItemRow` fields, merged under the caller's own values. */
const ITEM_ROW_DEFAULTS = {
  eventId: null, categoryId: null, clientId: null, creditedAccountId: null,
  postedAt: null, reviewState: 'published', sortKey: null, deletedReason: null,
};

/**
 * `sort_key` defaults to the post's epoch seconds when it isn't given;
 * at least one of the two is required (`sort_key` has no usable
 * database default of its own).
 * @param {Tx} tx
 * @param {ItemRow} row
 * @returns {Promise<number>}
 */
export async function insertItem(tx, row) {
  const merged = /** @type {ItemRow & typeof ITEM_ROW_DEFAULTS} */ ({ ...ITEM_ROW_DEFAULTS, ...row });
  const {
    kind, placement, eventId, categoryId, clientId, creditedAccountId,
    occurredOn, postedAt, addedVia, reviewState, sortKey, deletedReason,
  } = merged;
  if (sortKey === null && postedAt === null) throw new Error('insertItem: sortKey or postedAt required');
  const { rows } = await tx.query(
    `insert into items (kind, placement, event_id, category_id, client_id, credited_account_id,
       occurred_on, posted_at, added_via, review_state, sort_key, deleted_reason)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, coalesce($11, extract(epoch from $8::timestamptz)), $12)
     returning id`,
    [kind, placement, eventId, categoryId, clientId, creditedAccountId, occurredOn, postedAt, addedVia, reviewState, sortKey, deletedReason],
  );
  return rows[0].id;
}

/**
 * The visible items either side of `itemId` in its own event, ordered by
 * `(sort_key, occurred_on, posted_at, id)`. `itemId` need not be visible
 * itself (it still has a position); a hidden item is simply skipped as
 * someone else's neighbour.
 *
 * The pivot (`itemId`'s own tuple) is read via a `with` CTE and compared
 * entirely in SQL: it never round-trips through a JS value, so a
 * `posted_at` with sub-millisecond precision can't be truncated by a JS
 * `Date` (whose resolution is milliseconds) and then compared wrong.
 * @param {Tx} db
 * @param {number} itemId
 * @returns {Promise<{ prev: number|null, next: number|null }>}
 */
export async function neighbours(db, itemId) {
  // All four tuple columns are non-null (posted_at coalesced to a sentinel), so a plain row
  // comparison orders strictly on (sort_key, occurred_on, posted_at, id) with id as the final
  // tiebreaker -- the stability two items sharing a sort_key need. If `itemId` doesn't exist,
  // or has no event, `p` contributes no match and both subqueries come back null.
  const side = (/** @type {'<'|'>'} */ op, /** @type {'desc'|'asc'} */ dir) => `
    (select i.id from items i, p where i.event_id = p.event_id and ${visibleItem('i')}
       and (i.sort_key, i.occurred_on, coalesce(i.posted_at, '-infinity'::timestamptz), i.id)
         ${op} (p.sort_key, p.occurred_on, coalesce(p.posted_at, '-infinity'::timestamptz), $1)
     order by i.sort_key ${dir}, i.occurred_on ${dir}, coalesce(i.posted_at, '-infinity'::timestamptz) ${dir}, i.id ${dir}
     limit 1)`;
  const { rows } = await db.query(
    `with p as (select event_id, sort_key, occurred_on, posted_at from items where id = $1)
     select ${side('<', 'desc')} as prev, ${side('>', 'asc')} as next`,
    [itemId],
  );
  return { prev: rows[0]?.prev ?? null, next: rows[0]?.next ?? null };
}

/** The largest `limit` `listVisibleItemIds` will ever honour, regardless of what's asked for. */
const MAX_LIST_LIMIT = 200;
const DEFAULT_LIST_LIMIT = 50;

/**
 * Items whose event has been soft-deleted are invisible everywhere in
 * this file, including under an explicit `eventId` filter; items with
 * no event (`post`/`unsorted`/`shared_story` placements) are unaffected.
 */
export const EVENT_NOT_DELETED = 'not exists (select 1 from events ev where ev.id = i.event_id and ev.deleted_at is not null)';

/**
 * The equality/exists clauses for `listVisibleItemIds`' optional
 * filters, split out so the caller's own complexity stays low. Every
 * value is bound through a `$n` placeholder; only fixed, code-chosen
 * column names and placeholder indices are ever interpolated.
 * @param {{ eventId?: number, personId?: number, accountId?: number, kind?: string, placement?: string }} filters
 * @returns {{ conditions: string[], personClause: string, params: unknown[] }}
 */
function buildFilterClauses({ eventId, personId, accountId, kind, placement }) {
  const conditions = [visibleItem('i'), EVENT_NOT_DELETED];
  /** @type {unknown[]} */
  const params = [];
  const eq = (/** @type {string} */ column, /** @type {unknown} */ value) => {
    params.push(value);
    conditions.push(`${column} = $${params.length}`);
  };
  if (eventId !== undefined) eq('i.event_id', eventId);
  if (accountId !== undefined) eq('i.credited_account_id', accountId);
  if (kind !== undefined) eq('i.kind', kind);
  if (placement !== undefined) eq('i.placement', placement);
  let personClause = '';
  if (personId !== undefined) {
    params.push(personId);
    personClause = `and exists (select 1 from item_people ip where ip.item_id = i.id and ip.person_id = $${params.length})`;
  }
  return { conditions, personClause, params };
}

/**
 * Defaults to ascending event order -- `(sort_key, occurred_on,
 * posted_at, id)`, the same tuple `neighbours` orders by -- so paging
 * through this list visits items in the order a visitor would step
 * through them with prev/next. `order: 'desc'` reverses it ("newest
 * first"). `limit` is clamped to `MAX_LIST_LIMIT` regardless of what's
 * asked for.
 * @param {Tx} db
 * @param {{ eventId?: number, personId?: number, accountId?: number, kind?: string,
 *   placement?: string, limit?: number, offset?: number, order?: 'asc'|'desc' }} [filters]
 * @returns {Promise<{ kind: string, id: number }[]>}
 */
export async function listVisibleItemIds(db, filters = {}) {
  const { limit = DEFAULT_LIST_LIMIT, offset = 0, order = 'asc' } = filters;
  const dir = order === 'desc' ? 'desc' : 'asc';
  const clampedLimit = Math.min(limit, MAX_LIST_LIMIT);
  const { conditions, personClause, params } = buildFilterClauses(filters);
  params.push(clampedLimit, offset);
  const { rows } = await db.query(
    `select i.id, i.kind from items i where ${conditions.join(' and ')} ${personClause}
     order by i.sort_key ${dir}, i.occurred_on ${dir}, coalesce(i.posted_at, '-infinity'::timestamptz) ${dir}, i.id ${dir}
     limit $${params.length - 1} offset $${params.length}`,
    params,
  );
  return rows.map((r) => ({ id: r.id, kind: r.kind }));
}

/**
 * How many visible items match `filters` (the same ones `listVisibleItemIds`
 * takes), per kind -- the one count every hub page's totals come from.
 * Kinds with none are left out.
 * @param {Tx} db
 * @param {{ eventId?: number, personId?: number, accountId?: number, kind?: string, placement?: string }} [filters]
 * @returns {Promise<Record<string, number>>}
 */
export async function countVisibleItemsByKind(db, filters = {}) {
  const { conditions, personClause, params } = buildFilterClauses(filters);
  const { rows } = await db.query(
    `select i.kind, count(*)::int as n from items i where ${conditions.join(' and ')} ${personClause}
     group by i.kind order by i.kind`,
    params,
  );
  return Object.fromEntries(rows.map((r) => [r.kind, r.n]));
}

/** @param {Tx} db @returns {Promise<{ eventId: number, count: number }[]>} */
export async function countsByEvent(db) {
  const { rows } = await db.query(
    `select i.event_id as event_id, count(*)::int as n from items i
     join events e on e.id = i.event_id
     where e.deleted_at is null and ${visibleItem('i')} group by i.event_id`,
  );
  return rows.map((r) => ({ eventId: r.event_id, count: r.n }));
}

/**
 * Counts each item once even when the person holds more than one role
 * on it (an `exists` check, not a join -- a join would count a row per
 * matching `item_people` role, double-counting that item).
 * @param {Tx} db @param {number} personId @returns {Promise<number>}
 */
export async function countsForPerson(db, personId) {
  const { rows } = await db.query(
    `select count(*)::int as n from items i
     where exists (select 1 from item_people ip where ip.item_id = i.id and ip.person_id = $1) and ${visibleItem('i')}`,
    [personId],
  );
  return rows[0].n;
}

/** @param {Tx} db @param {number} accountId @returns {Promise<number>} */
export async function countsForAccount(db, accountId) {
  const { rows } = await db.query(
    `select count(*)::int as n from items i where i.credited_account_id = $1 and ${visibleItem('i')}`,
    [accountId],
  );
  return rows[0].n;
}

/**
 * A raw `items` row, with no visibility filtering at all -- it returns
 * removed, pending, rejected, opted-out and blocked-submitter rows just
 * as readily as a published one. NOT visibility-safe: never serve this
 * to a visitor; internal/debug use only.
 * @param {Tx} db @param {number} itemId @returns {Promise<Record<string, unknown>|null>}
 */
export async function getItem(db, itemId) {
  const { rows } = await db.query('select * from items where id = $1', [itemId]);
  return rows[0] ? camelRow(rows[0]) : null;
}
