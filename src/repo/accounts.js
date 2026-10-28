// @ts-check
/**
 * accounts: one row per account on a platform, keyed by `(platform,
 * external_id)` once known, or by `(platform, lower(handle))` while it's
 * only a handle (docs/decisions/0006-data-model-conventions.md, rule 7:
 * restore/adopt instead of duplicating).
 */
import { camelRow } from './rows.js';

/** @typedef {{ query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> }} Tx */
/**
 * @typedef {{ id: number, platform: string, externalId: string|null, handle: string,
 *   displayName: string|null, personId: number|null, isIdentity: boolean }} Account
 */

const COLUMNS = 'id, platform, external_id, handle, display_name, person_id, is_identity';

/**
 * Appends the row's old handle (lower-cased) to `meta.previousHandles`
 * when an update changes it other than by case, so a page asked for an
 * old handle can redirect to the current one (`findAccountForView`).
 * SQL for the `set` list of an `update accounts`, where `handle` is still
 * the old value and `$3` is the new one.
 */
const REMEMBER_OLD_HANDLE = `meta = case when lower(handle) = lower($3) or meta->'previousHandles' ? lower(handle) then meta
  else jsonb_set(meta, '{previousHandles}', coalesce(meta->'previousHandles', '[]'::jsonb) || to_jsonb(lower(handle))) end`;

/**
 * Updates by `(platform, external_id)`. If no row has it, adopts a
 * handle-only row with the same `(platform, lower(handle))` by setting
 * its external id. Otherwise inserts.
 * @param {Tx} tx
 * @param {{ platform: string, externalId: string, handle: string, displayName?: string }} input
 * @returns {Promise<number>}
 */
async function upsertByExternalId(tx, { platform, externalId, handle, displayName }) {
  const byExternal = await tx.query(
    `update accounts set handle = $3, display_name = coalesce($4, display_name), ${REMEMBER_OLD_HANDLE}
     where platform = $1 and external_id = $2 returning id`,
    [platform, externalId, handle, displayName ?? null],
  );
  if (byExternal.rows[0]) return byExternal.rows[0].id;

  const adopted = await tx.query(
    `update accounts set external_id = $2, display_name = coalesce($4, display_name)
     where platform = $1 and lower(handle) = lower($3) and external_id is null and deleted_at is null
     returning id`,
    [platform, externalId, handle, displayName ?? null],
  );
  if (adopted.rows[0]) return adopted.rows[0].id;

  // A concurrent first sighting of the same account may insert in between: the conflict clause waits
  // for it and updates that row instead of failing on accounts_external.
  const inserted = await tx.query(
    `insert into accounts (platform, external_id, handle, display_name) values ($1, $2, $3, $4)
     on conflict (platform, external_id) where external_id is not null
     do update set handle = excluded.handle, display_name = coalesce(excluded.display_name, accounts.display_name)
     returning id`,
    [platform, externalId, handle, displayName ?? null],
  );
  return inserted.rows[0].id;
}

/**
 * Matches an existing handle-only row, or inserts one.
 * @param {Tx} tx
 * @param {{ platform: string, handle: string, displayName?: string }} input
 * @returns {Promise<number>}
 */
async function upsertHandleOnly(tx, { platform, handle, displayName }) {
  const found = await tx.query(
    `update accounts set display_name = coalesce($3, display_name)
     where platform = $1 and lower(handle) = lower($2) and external_id is null and deleted_at is null
     returning id`,
    [platform, handle, displayName ?? null],
  );
  if (found.rows[0]) return found.rows[0].id;

  const inserted = await tx.query(
    `insert into accounts (platform, handle, display_name) values ($1, $2, $3)
     on conflict (platform, lower(handle)) where external_id is null and deleted_at is null
     do update set display_name = coalesce(excluded.display_name, accounts.display_name)
     returning id`,
    [platform, handle, displayName ?? null],
  );
  return inserted.rows[0].id;
}

/**
 * @param {Tx} tx
 * @param {{ platform: string, externalId?: string, handle: string, displayName?: string }} input
 * @returns {Promise<number>}
 */
export async function upsertAccount(tx, { platform, externalId, handle, displayName }) {
  if (externalId) return upsertByExternalId(tx, { platform, externalId, handle, displayName });
  return upsertHandleOnly(tx, { platform, handle, displayName });
}

/**
 * Links the X account whose `external_id` is `externalId` to the user
 * `userId` (sets `accounts.user_id`). Used at sign-in so a translator is
 * recognised by the numeric X id they signed in with. No-op when there is
 * no such account row yet (it is linked when intake first credits it).
 * @param {Tx} tx
 * @param {{ externalId: string, userId: string }} input
 * @returns {Promise<void>}
 */
export async function linkXAccountToUser(tx, { externalId, userId }) {
  await tx.query(
    "update accounts set user_id = $2 where platform = 'x' and external_id = $1 and deleted_at is null",
    [externalId, userId],
  );
}

/**
 * The `accounts.id`s of the user's X accounts: the translator identifier
 * used by recognition and edit permission checks.
 * @param {Tx} db
 * @param {string} userId
 * @returns {Promise<number[]>}
 */
export async function xAccountIdsOfUser(db, userId) {
  const { rows } = await db.query(
    "select id from accounts where platform = 'x' and user_id = $1 and deleted_at is null order by id",
    [userId],
  );
  return rows.map((r) => r.id);
}

/**
 * @param {Tx} db
 * @param {number} id
 * @returns {Promise<Account|null>}
 */
export async function getAccount(db, id) {
  const { rows } = await db.query(`select ${COLUMNS} from accounts where id = $1`, [id]);
  return rows[0] ? /** @type {Account} */ (camelRow(rows[0])) : null;
}

/**
 * Prefers an external-id row over a handle-only one, then the most
 * recently updated.
 * @param {Tx} db
 * @param {string} platform
 * @param {string} handle
 * @returns {Promise<Account|null>}
 */
export async function getAccountByHandle(db, platform, handle) {
  const { rows } = await db.query(
    `select ${COLUMNS} from accounts where platform = $1 and lower(handle) = lower($2) and deleted_at is null
     order by (external_id is null) asc, updated_at desc limit 1`,
    [platform, handle],
  );
  return rows[0] ? /** @type {Account} */ (camelRow(rows[0])) : null;
}


/**
 * What intake needs to know about an account before writing anything:
 * whether it opted out, and which user (if any) it belongs to. Looks up by
 * `(platform, external_id)` when given, else by handle. With an external
 * id, the handle fallback only finds a handle-only row -- the row
 * `upsertAccount` would adopt -- never another account's old handle.
 * @param {Tx} db
 * @param {{ platform: string, externalId?: string|null, handle?: string|null }} ref
 * @returns {Promise<{ id: number, optedOut: boolean, userId: string|null }|null>}
 */
export async function accountState(db, { platform, externalId, handle }) {
  const byExternal = externalId
    ? await db.query('select id, opted_out_at, user_id from accounts where platform = $1 and external_id = $2', [platform, externalId])
    : { rows: [] };
  const found = byExternal.rows[0] ?? (handle ? await findByHandleRow(db, { platform, handle, handleOnly: Boolean(externalId) }) : null);
  return found ? { id: found.id, optedOut: found.opted_out_at !== null, userId: found.user_id } : null;
}

/** @param {Tx} db @param {{ platform: string, handle: string, handleOnly: boolean }} ref */
async function findByHandleRow(db, { platform, handle, handleOnly }) {
  const { rows } = await db.query(
    `select id, opted_out_at, user_id from accounts where platform = $1 and lower(handle) = lower($2) and deleted_at is null
       and (not $3 or external_id is null)
     order by (external_id is null) asc, updated_at desc limit 1`,
    [platform, handle, handleOnly],
  );
  return rows[0] ?? null;
}

/**
 * The account a public page for `handle` shows: the one currently holding
 * it (an external-id row first), else the one that held it before a handle
 * change (`current: false`; the page redirects to `handle`, the current one).
 * @param {Tx} db
 * @param {string} platform
 * @param {string} handle
 * @returns {Promise<{ id: number, handle: string, displayName: string|null, personId: number|null,
 *   optedOut: boolean, current: boolean }|null>}
 */
export async function findAccountForView(db, platform, handle) {
  const { rows } = await db.query(
    `select id, handle, display_name, person_id, opted_out_at is not null as opted_out, lower(handle) = lower($2) as current
     from accounts
     where platform = $1 and deleted_at is null and (lower(handle) = lower($2) or meta->'previousHandles' ? lower($2))
     order by (lower(handle) = lower($2)) desc, (external_id is null) asc, updated_at desc
     limit 1`,
    [platform, handle],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id, handle: row.handle, displayName: row.display_name, personId: row.person_id,
    optedOut: row.opted_out, current: row.current,
  };
}
