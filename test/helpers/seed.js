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
 * @param {{ kind?: string, placement?: string, eventId?: number | null, deletedReason?: string | null }} [options]
 */
export async function insertItem(tx, { kind = 'translation', placement = 'unsorted', eventId = null, deletedReason = null } = {}) {
  const { rows } = await tx.query(
    `insert into items (kind, placement, event_id, occurred_on, added_via, sort_key, deleted_reason)
     values ($1, $2, $3, '2026-02-13', 'cli', 1, $4) returning id`,
    [kind, placement, eventId, deletedReason],
  );
  return rows[0].id;
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
