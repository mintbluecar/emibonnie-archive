// @ts-check
/**
 * sourceEdits: the edit-window bookkeeping on `item_sources`
 * (`editable_until`, `edit_finalized_at`, `last_refreshed_at`) and the
 * `source_aliases` that make every version id of an edited post resolve
 * to the one source that archives it.
 */

/** @typedef {{ query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> }} Tx */

/** Refreshes of one item closer together than this are refused by `touchRefresh`. */
const REFRESH_GAP_SECONDS = 60;

/**
 * Maps each id to `sourceId`. An id that already maps somewhere is left
 * alone (`source_aliases` is unaudited and keyed by `(platform, external_id)`).
 * @param {Tx} tx
 * @param {{ sourceId: number, platform: string, ids: string[] }} input
 * @returns {Promise<void>}
 */
export async function addAliases(tx, { sourceId, platform, ids }) {
  for (const externalId of new Set(ids)) {
    await tx.query(
      `insert into source_aliases (platform, external_id, source_id) values ($1, $2, $3)
       on conflict (platform, external_id) do nothing`,
      [platform, externalId, sourceId],
    );
  }
}

/**
 * Updates a source's edit window and, when given, stamps it finalized.
 * Writes nothing when neither value changes (so no audit row).
 * @param {Tx} tx
 * @param {{ sourceId: number, editableUntil: string|null, finalizedAt: Date|null }} input
 * @returns {Promise<void>}
 */
export async function updateEditState(tx, { sourceId, editableUntil, finalizedAt }) {
  await tx.query(
    `update item_sources set editable_until = coalesce($2::timestamptz, editable_until),
       edit_finalized_at = coalesce(edit_finalized_at, $3::timestamptz)
     where id = $1
       and (editable_until is distinct from coalesce($2::timestamptz, editable_until)
         or (edit_finalized_at is null and $3::timestamptz is not null))`,
    [sourceId, editableUntil, finalizedAt],
  );
}

/**
 * The item's primary/follow-up posts whose edit window isn't finalized yet.
 * @param {Tx} db
 * @param {number} itemId
 * @returns {Promise<{ id: number, platform: string, externalId: string, role: string, editableUntil: Date|null }[]>}
 */
export async function unfinalizedSources(db, itemId) {
  const { rows } = await db.query(
    `select id, platform, external_id, role, editable_until from item_sources
     where item_id = $1 and role in ('primary', 'follow_up') and external_id is not null and edit_finalized_at is null
     order by position, id`,
    [itemId],
  );
  return rows.map((r) => ({ id: r.id, platform: r.platform, externalId: r.external_id, role: r.role, editableUntil: r.editable_until }));
}

/**
 * The refresh button's server-side guard. Locks the item's primary and
 * follow-up sources; if none was refreshed in the last 60 seconds (as of
 * `now`), stamps them all `last_refreshed_at = now` and returns true.
 * Otherwise writes nothing and returns false (also for an item with no
 * such sources).
 * @param {Tx} tx
 * @param {number} itemId
 * @param {Date} now
 * @returns {Promise<boolean>}
 */
export async function touchRefresh(tx, itemId, now) {
  const locked = await tx.query(
    "select id from item_sources where item_id = $1 and role in ('primary', 'follow_up') order by id for update",
    [itemId],
  );
  if (locked.rows.length === 0) return false;
  const { rows } = await tx.query(
    `select bool_or(last_refreshed_at > $2::timestamptz - make_interval(secs => $3)) as recent
     from item_sources where item_id = $1 and role in ('primary', 'follow_up')`,
    [itemId, now.toISOString(), REFRESH_GAP_SECONDS],
  );
  if (rows[0].recent) return false;
  await tx.query(
    "update item_sources set last_refreshed_at = $2 where item_id = $1 and role in ('primary', 'follow_up')",
    [itemId, now.toISOString()],
  );
  return true;
}
