// @ts-check
/**
 * speakerMemory: a per-account cache of marker -> speaker choices, used
 * to suggest the same mapping next time that account submits
 * (`speaker_memory` is NOT audited, docs/decisions/0006-data-model-
 * conventions.md rule 3: cache churn would flood the audit log).
 * `remember` rewrites the whole map on every submit, matching the
 * schema comment on `speaker_memory`.
 */

/** @typedef {{ query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> }} Tx */
/** @typedef {import('../domain/speakers.js').SpeakerMap} SpeakerMap */

/**
 * @param {Tx} db
 * @param {number} accountId
 * @returns {Promise<SpeakerMap>}
 */
export async function recall(db, accountId) {
  const { rows } = await db.query('select marker, person_id, role from speaker_memory where account_id = $1', [accountId]);
  /** @type {SpeakerMap} */
  const map = {};
  for (const row of rows) {
    map[row.marker] = row.person_id !== null ? { person: row.person_id } : { role: row.role };
  }
  return map;
}

/**
 * @param {Tx} tx
 * @param {number} accountId
 * @param {SpeakerMap} map
 * @returns {Promise<void>}
 */
export async function remember(tx, accountId, map) {
  await tx.query('delete from speaker_memory where account_id = $1', [accountId]);
  for (const [marker, speaker] of Object.entries(map)) {
    const personId = 'person' in speaker ? speaker.person : null;
    const role = 'role' in speaker ? speaker.role : null;
    // another submit for the same account may be writing concurrently: the later one wins, without failing
    await tx.query(
      `insert into speaker_memory (account_id, marker, person_id, role) values ($1, $2, $3, $4)
       on conflict (account_id, marker) do update set person_id = excluded.person_id, role = excluded.role, updated_at = now()`,
      [accountId, marker, personId, role],
    );
  }
}
