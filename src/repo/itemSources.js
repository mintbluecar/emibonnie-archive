// @ts-check
/**
 * itemSources: the posts archived for an item. `setStatus` and
 * `touchCheck` are deliberately split: `item_sources.status` is
 * audited, so `setStatus` only writes when the status actually
 * changes; `source_checks` is a health-check cache (not audited,
 * docs/decisions/0006-data-model-conventions.md rule 3), so
 * `touchCheck` writes it on every call without touching `item_sources`.
 */
import { camelRow, camelRows } from './rows.js';
import { visibleItem } from './visibility.js';

/** @typedef {{ query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> }} Tx */
/**
 * @typedef {object} SourceInput
 * @property {string} platform
 * @property {string} [externalId]
 * @property {string} url
 * @property {string} [role]
 * @property {number} [position]
 * @property {number} [accountId]
 * @property {number} [startSeconds]
 * @property {unknown} [media]
 * @property {string|null} [editableUntil] the platform's edit window (ISO), for posts that can be edited
 */

/**
 * @param {Tx} tx
 * @param {number} itemId
 * @param {string} kind
 * @param {SourceInput[]} sources
 * @returns {Promise<number[]>}
 */
export async function addSources(tx, itemId, kind, sources) {
  /** @type {number[]} */
  const ids = [];
  for (const source of sources) {
    const {
      platform, externalId = null, url, role = 'primary', position = 0,
      accountId = null, startSeconds = null, media = null, editableUntil = null,
    } = source;
    const { rows } = await tx.query(
      `insert into item_sources (item_id, kind, platform, external_id, url, role, position, account_id, start_seconds, media,
         editable_until)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11) returning id`,
      [itemId, kind, platform, externalId, url, role, position, accountId, startSeconds,
        media === null ? null : JSON.stringify(media), editableUntil],
    );
    ids.push(rows[0].id);
  }
  return ids;
}

/** @param {Tx} db @param {number} itemId @returns {Promise<Record<string, unknown>|null>} */
export async function primarySource(db, itemId) {
  const { rows } = await db.query(
    `select id, item_id, kind, platform, external_id, url, role, position, account_id, start_seconds, media,
       editable_until, edit_finalized_at, last_refreshed_at, status
     from item_sources where item_id = $1 and role = 'primary' limit 1`,
    [itemId],
  );
  return rows[0] ? camelRow(rows[0]) : null;
}

/** @param {Tx} db @param {number} itemId @returns {Promise<Record<string, unknown>[]>} */
export async function listSources(db, itemId) {
  return (await listSourcesFor(db, [itemId])).get(itemId) ?? [];
}

/**
 * Every source of each item, grouped by item id, in `(position, id)` order,
 * each with its account's current handle (`accountHandle`; null when there's
 * no account or it has opted out) and `accountOptedOut`. Public output must
 * drop a source whose account opted out (the translation kind does so in
 * `publicSources`, src/kinds/translation/media.js).
 * @param {Tx} db
 * @param {number[]} itemIds
 * @returns {Promise<Map<number, Record<string, unknown>[]>>}
 */
export async function listSourcesFor(db, itemIds) {
  const { rows } = await db.query(
    `select s.id, s.item_id, s.kind, s.platform, s.external_id, s.url, s.role, s.position, s.account_id, s.start_seconds, s.media,
       s.editable_until, s.edit_finalized_at, s.last_refreshed_at, s.status,
       case when a.opted_out_at is null then a.handle end as account_handle,
       coalesce(a.opted_out_at is not null, false) as account_opted_out
     from item_sources s left join accounts a on a.id = s.account_id
     where s.item_id = any($1::bigint[]) order by s.item_id, s.position, s.id`,
    [itemIds],
  );
  /** @type {Map<number, Record<string, unknown>[]>} */
  const byItem = new Map();
  for (const row of camelRows(rows)) {
    const list = byItem.get(/** @type {number} */ (row.itemId)) ?? [];
    list.push(row);
    byItem.set(/** @type {number} */ (row.itemId), list);
  }
  return byItem;
}

/**
 * Writes `item_sources.status` only when it actually changes, so a
 * health check that finds nothing new logs no audit row.
 * @param {Tx} tx
 * @param {number} sourceId
 * @param {'live'|'deleted'|'unavailable'} status
 * @returns {Promise<void>}
 */
export async function setStatus(tx, sourceId, status) {
  await tx.query('update item_sources set status = $2 where id = $1 and status is distinct from $2', [sourceId, status]);
}

/**
 * Records a health check against `source_checks` (unaudited): resets
 * `consecutive_failures` to 0 and stamps `checked_at`.
 * @param {Tx} db
 * @param {number} sourceId
 * @returns {Promise<void>}
 */
export async function touchCheck(db, sourceId) {
  await db.query(
    `insert into source_checks (source_id, checked_at, consecutive_failures) values ($1, now(), 0)
     on conflict (source_id) do update set checked_at = now(), consecutive_failures = 0`,
    [sourceId],
  );
}

/**
 * The item that archives `externalId` as its primary or a follow-up
 * source (directly or through `source_aliases`), for one kind, and that
 * item's state as `sourceState` reports it. Media and quoted sources never
 * count: two translators may translate the same original post. Ordered
 * exactly like `sourceState` (a visible owner wins, then the oldest), so
 * the state and the item id always describe the same item.
 * @param {Tx} db
 * @param {{ kind: string, platform: string, externalId: string, roles?: string[] }} ref
 * @returns {Promise<{ itemId: number, sourceId: number, role: string, accountExternalId: string|null,
 *   state: 'visible'|'pending'|'removed' }|null>}
 */
export async function findSourceOwner(db, { kind, platform, externalId, roles = ['primary', 'follow_up'] }) {
  const { rows } = await db.query(
    `select s.item_id, s.id as source_id, s.role, a.external_id as account_external_id,
       (${visibleItem('i')}) as visible, (i.deleted_at is null and i.review_state = 'pending') as pending
     from item_sources s
     join items i on i.id = s.item_id
     left join accounts a on a.id = i.credited_account_id
     where s.kind = $1 and s.platform = $2 and s.role = any($4::text[])
       and (s.external_id = $3 or s.id in (select source_id from source_aliases where platform = $2 and external_id = $3))
     order by (${visibleItem('i')}) desc, i.id
     limit 1`,
    [kind, platform, externalId, roles],
  );
  const row = rows[0];
  if (!row) return null;
  const state = row.visible ? 'visible' : row.pending ? 'pending' : 'removed';
  return { itemId: row.item_id, sourceId: row.source_id, role: row.role, accountExternalId: row.account_external_id, state };
}

/**
 * The next free `position` for a new source of `role` on an item (follow-ups
 * are numbered 1..n after the primary's 0).
 * @param {Tx} db
 * @param {number} itemId
 * @param {string} role
 * @returns {Promise<number>}
 */
export async function nextPosition(db, itemId, role) {
  const { rows } = await db.query(
    'select coalesce(max(position), 0) + 1 as next from item_sources where item_id = $1 and role = $2',
    [itemId, role],
  );
  return rows[0].next;
}
