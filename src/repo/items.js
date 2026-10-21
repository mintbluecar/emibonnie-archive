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
 * post (a Twitter edit, say) counts as the same source.
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
     where s.platform = $2
       and (s.external_id = $3 or s.id in (select source_id from source_aliases where platform = $2 and external_id = $3))
     limit 1`,
    [kind, platform, externalId],
  );
  const row = rows[0];
  if (!row) return 'none';
  if (row.visible) return 'visible';
  if (row.deleted_at === null && row.review_state === 'pending') return 'pending';
  return 'removed';
}

/**
 * `sort_key` defaults to the post's epoch seconds when it isn't given.
 * @param {Tx} tx
 * @param {ItemRow} row
 * @returns {Promise<number>}
 */
export async function insertItem(tx, row) {
  const {
    kind, placement, eventId = null, categoryId = null, clientId = null, creditedAccountId = null,
    occurredOn, postedAt = null, addedVia, reviewState = 'published', sortKey = null, deletedReason = null,
  } = row;
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
 * @param {Tx} db
 * @param {number} itemId
 * @returns {Promise<{ prev: number|null, next: number|null }>}
 */
export async function neighbours(db, itemId) {
  const { rows } = await db.query('select event_id, sort_key, occurred_on, posted_at from items where id = $1', [itemId]);
  const item = rows[0];
  if (!item || item.event_id === null) return { prev: null, next: null };

  // All four tuple columns are non-null (posted_at coalesced to a sentinel), so a plain row
  // comparison orders strictly on (sort_key, occurred_on, posted_at, id) with id as the final
  // tiebreaker -- the stability two items sharing a sort_key need.
  const tuple = [item.event_id, item.sort_key, item.occurred_on, item.posted_at, itemId];
  const other = async (/** @type {'<'|'>'} */ op, /** @type {'desc'|'asc'} */ dir) => {
    const { rows: found } = await db.query(
      `select i.id from items i where i.event_id = $1 and ${visibleItem('i')}
         and (i.sort_key, i.occurred_on, coalesce(i.posted_at, '-infinity'::timestamptz), i.id)
           ${op} ($2, $3, coalesce($4::timestamptz, '-infinity'::timestamptz), $5)
       order by i.sort_key ${dir}, i.occurred_on ${dir}, coalesce(i.posted_at, '-infinity'::timestamptz) ${dir}, i.id ${dir}
       limit 1`,
      tuple,
    );
    return found[0] ? found[0].id : null;
  };
  return { prev: await other('<', 'desc'), next: await other('>', 'asc') };
}

/**
 * @param {Tx} db
 * @param {{ eventId?: number, personId?: number, accountId?: number, kind?: string,
 *   placement?: string, limit?: number, offset?: number }} [filters]
 * @returns {Promise<{ kind: string, id: number }[]>}
 */
export async function listVisibleItemIds(db, filters = {}) {
  const { eventId, personId, accountId, kind, placement, limit = 50, offset = 0 } = filters;
  const conditions = [visibleItem('i')];
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
  params.push(limit, offset);
  const { rows } = await db.query(
    `select i.id, i.kind from items i where ${conditions.join(' and ')} ${personClause}
     order by i.sort_key desc, i.id desc limit $${params.length - 1} offset $${params.length}`,
    params,
  );
  return rows.map((r) => ({ id: r.id, kind: r.kind }));
}

/** @param {Tx} db @returns {Promise<{ eventId: number, count: number }[]>} */
export async function countsByEvent(db) {
  const { rows } = await db.query(
    `select i.event_id as event_id, count(*)::int as n from items i
     where i.event_id is not null and ${visibleItem('i')} group by i.event_id`,
  );
  return rows.map((r) => ({ eventId: r.event_id, count: r.n }));
}

/** @param {Tx} db @param {number} personId @returns {Promise<number>} */
export async function countsForPerson(db, personId) {
  const { rows } = await db.query(
    `select count(*)::int as n from items i
     join item_people ip on ip.item_id = i.id and ip.person_id = $1
     where ${visibleItem('i')}`,
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

/** @param {Tx} db @param {number} itemId @returns {Promise<Record<string, unknown>|null>} */
export async function getItem(db, itemId) {
  const { rows } = await db.query('select * from items where id = $1', [itemId]);
  return rows[0] ? camelRow(rows[0]) : null;
}
