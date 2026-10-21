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
      accountId = null, startSeconds = null, media = null,
    } = source;
    const { rows } = await tx.query(
      `insert into item_sources (item_id, kind, platform, external_id, url, role, position, account_id, start_seconds, media)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb) returning id`,
      [itemId, kind, platform, externalId, url, role, position, accountId, startSeconds, media === null ? null : JSON.stringify(media)],
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
  const { rows } = await db.query(
    `select id, item_id, kind, platform, external_id, url, role, position, account_id, start_seconds, media,
       editable_until, edit_finalized_at, last_refreshed_at, status
     from item_sources where item_id = $1 order by position, id`,
    [itemId],
  );
  return camelRows(rows);
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
