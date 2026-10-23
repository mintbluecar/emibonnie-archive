// @ts-check
/**
 * Minimal rows for schema tests. Every helper takes a transaction (`tx`)
 * and returns the new row's id. Values are invented and fandom-neutral.
 */

/** @typedef {{ query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> }} Tx */

/** @param {Tx} tx */
export async function insertPerson(tx, { name = 'Person A', colour = '#112233' } = {}) {
  const { rows } = await tx.query(
    "insert into people (display_name, emoji, colour) values ($1, '🙂', $2) returning id",
    [name, colour],
  );
  return rows[0].id;
}

/** @param {Tx} tx */
export async function insertEvent(tx, { slug = 'an-event', occurredOn = '2026-02-13' } = {}) {
  const { rows } = await tx.query(
    "insert into events (slug, name, occurred_on) values ($1, 'An event', $2) returning id",
    [slug, occurredOn],
  );
  return rows[0].id;
}

/**
 * @param {Tx} tx
 * @param {{ kind?: string, placement?: string, eventId?: number | null, deletedReason?: string | null,
 *   reviewState?: string, creditedAccountId?: number | null, sortKey?: number, postedAt?: string | null }} [options]
 */
export async function insertItem(
  tx,
  {
    kind = 'translation', placement = 'unsorted', eventId = null, deletedReason = null,
    reviewState = 'published', creditedAccountId = null, sortKey = 1, postedAt = null,
  } = {},
) {
  const { rows } = await tx.query(
    `insert into items (kind, placement, event_id, occurred_on, posted_at, added_via, review_state, sort_key,
       credited_account_id, deleted_reason)
     values ($1, $2, $3, '2026-02-13', $4, 'cli', $5, $6, $7, $8) returning id`,
    [kind, placement, eventId, postedAt, reviewState, sortKey, creditedAccountId, deletedReason],
  );
  return rows[0].id;
}

/**
 * @param {Tx} tx
 * @param {{ id?: string, blockedAt?: boolean }} [options]
 * @returns {Promise<string>} the user id
 */
export async function insertUser(tx, { id = `user-${Date.now()}-${Math.random().toString(36).slice(2)}`, blockedAt = false } = {}) {
  await tx.query('insert into users (id, display_name) values ($1, $1)', [id]);
  if (blockedAt) await tx.query('update users set blocked_at = now() where id = $1', [id]);
  return id;
}

/**
 * @param {Tx} tx
 * @param {{ platform?: string, handle?: string, optedOut?: boolean }} [options]
 * @returns {Promise<number>} the account id
 */
export async function insertAccount(tx, { platform = 'x', handle = `handle_${Date.now()}_${Math.random().toString(36).slice(2)}`, optedOut = false } = {}) {
  const { rows } = await tx.query('insert into accounts (platform, handle) values ($1, $2) returning id', [platform, handle]);
  const id = rows[0].id;
  if (optedOut) await tx.query('update accounts set opted_out_at = now() where id = $1', [id]);
  return id;
}

/**
 * @param {Tx} tx
 * @param {{ itemId: number, kind?: string, externalId: string, role?: string }} source
 */
export async function insertSource(tx, { itemId, kind = 'translation', externalId, role = 'primary' }) {
  const { rows } = await tx.query(
    `insert into item_sources (item_id, kind, platform, external_id, url, role)
     values ($1, $2, 'x', $3, $4, $5) returning id`,
    [itemId, kind, externalId, `https://example.com/status/${externalId}`, role],
  );
  return rows[0].id;
}
