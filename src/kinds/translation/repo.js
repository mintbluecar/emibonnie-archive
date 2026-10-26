// @ts-check
/**
 * The translation kind's own tables: `translations`, `translation_parts`
 * (append-only, except `updatePartBody`, which only the edit refresh
 * calls) and `translation_speakers`.
 */
import { listSourcesFor } from '../../repo/itemSources.js';

/** @typedef {{ query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> }} Tx */
/** @typedef {import('../../domain/speakers.js').SpeakerMap} SpeakerMap */
/**
 * @typedef {{ parts: string[], body: string, speakers: SpeakerMap, sources: Record<string, unknown>[],
 *   textEnteredManually: boolean, fixes: import('../../domain/lineFixes.js').LineFix[], subbed: boolean }} TranslationDetails
 */

/**
 * @param {Tx} tx
 * @param {number} itemId
 * @param {{ textEnteredManually: boolean }} input
 * @returns {Promise<void>}
 */
export async function insertTranslation(tx, itemId, { textEnteredManually }) {
  await tx.query('insert into translations (item_id, text_entered_manually) values ($1, $2)', [itemId, textEnteredManually]);
}

/** @param {Tx} db @param {number} itemId @returns {Promise<boolean>} */
export async function isTextEnteredManually(db, itemId) {
  const { rows } = await db.query('select text_entered_manually from translations where item_id = $1', [itemId]);
  return rows[0]?.text_entered_manually === true;
}

/**
 * Appends parts after the item's current last position. Never rewrites an
 * existing part.
 * @param {Tx} tx
 * @param {number} itemId
 * @param {{ sourceId: number|null, body: string }[]} parts
 * @returns {Promise<number[]>} the new parts' positions
 */
export async function addParts(tx, itemId, parts) {
  const { rows } = await tx.query('select coalesce(max(position), -1) as last from translation_parts where item_id = $1', [itemId]);
  let position = rows[0].last;
  /** @type {number[]} */
  const positions = [];
  for (const { sourceId, body } of parts) {
    position += 1;
    await tx.query('insert into translation_parts (item_id, position, source_id, body) values ($1, $2, $3, $4)', [itemId, position, sourceId, body]);
    positions.push(position);
  }
  return positions;
}

/**
 * Replaces the body of the part archived from `sourceId`, when it differs.
 * Only the edit refresh may call this (the audit log keeps the old body).
 * @param {Tx} tx
 * @param {{ itemId: number, sourceId: number, body: string }} input
 * @returns {Promise<number[]>} the positions whose body changed (empty when none)
 */
export async function updatePartBody(tx, { itemId, sourceId, body }) {
  const { rows } = await tx.query(
    'update translation_parts set body = $3 where item_id = $1 and source_id = $2 and body is distinct from $3 returning position',
    [itemId, sourceId, body],
  );
  return rows.map((r) => r.position);
}

/**
 * @param {Tx} db
 * @param {number[]} itemIds
 * @returns {Promise<Map<number, { position: number, body: string, pending: boolean }[]>>}
 */
export async function partsOf(db, itemIds) {
  const { rows } = await db.query(
    'select item_id, position, body, pending from translation_parts where item_id = any($1::bigint[]) order by item_id, position',
    [itemIds],
  );
  /** @type {Map<number, { position: number, body: string, pending: boolean }[]>} */
  const byItem = new Map(itemIds.map((id) => [id, []]));
  for (const row of rows) byItem.get(row.item_id)?.push({ position: row.position, body: row.body, pending: row.pending });
  return byItem;
}

/** @param {{ person_id: number|null, role: string|null }} row */
function speakerOf(row) {
  return row.person_id !== null ? { person: row.person_id } : { role: /** @type {any} */ (row.role) };
}

/**
 * @param {Tx} db
 * @param {number[]} itemIds
 * @returns {Promise<Map<number, SpeakerMap>>}
 */
export async function speakersOf(db, itemIds) {
  const { rows } = await db.query(
    'select item_id, marker, person_id, role from translation_speakers where item_id = any($1::bigint[]) order by item_id, marker',
    [itemIds],
  );
  /** @type {Map<number, SpeakerMap>} */
  const byItem = new Map(itemIds.map((id) => [id, {}]));
  for (const row of rows) {
    const map = byItem.get(row.item_id);
    if (map) map[row.marker] = speakerOf(row);
  }
  return byItem;
}

/** @param {SpeakerMap[string]} speaker */
function speakerKey(speaker) {
  return 'person' in speaker ? `p:${speaker.person}` : `r:${speaker.role}`;
}

/**
 * Replaces an item's speaker set, writing only the delta (like
 * `setItemPeople`), so the audit log shows exactly what changed.
 * @param {Tx} tx
 * @param {number} itemId
 * @param {SpeakerMap} map
 * @returns {Promise<void>}
 */
export async function setSpeakers(tx, itemId, map) {
  const existing = (await speakersOf(tx, [itemId])).get(itemId) ?? {};
  for (const [marker, speaker] of Object.entries(existing)) {
    if (map[marker] && speakerKey(map[marker]) === speakerKey(speaker)) continue;
    await tx.query('delete from translation_speakers where item_id = $1 and marker = $2', [itemId, marker]);
  }
  for (const [marker, speaker] of Object.entries(map)) {
    if (existing[marker] && speakerKey(existing[marker]) === speakerKey(speaker)) continue;
    const personId = 'person' in speaker ? speaker.person : null;
    const role = 'role' in speaker ? speaker.role : null;
    await tx.query('insert into translation_speakers (item_id, marker, person_id, role) values ($1, $2, $3, $4)', [itemId, marker, personId, role]);
  }
}

/**
 * @param {Tx} db
 * @param {number[]} itemIds
 * @returns {Promise<Map<number, boolean>>}
 */
async function manualFlagsOf(db, itemIds) {
  const { rows } = await db.query('select item_id, text_entered_manually from translations where item_id = any($1::bigint[])', [itemIds]);
  return new Map(rows.map((r) => [r.item_id, r.text_entered_manually]));
}

/** @param {Tx} db @param {number[]} itemIds @returns {Promise<Map<number, boolean>>} */
export async function subbedOf(db, itemIds) {
  const { rows } = await db.query('select item_id, subbed from translations where item_id = any($1::bigint[])', [itemIds]);
  return new Map(rows.map((r) => [r.item_id, r.subbed === true]));
}

/** @param {Tx} db @param {number[]} itemIds @returns {Promise<Map<number, import('../../domain/lineFixes.js').LineFix[]>>} */
export async function fixesOf(db, itemIds) {
  const { rows } = await db.query(
    'select item_id, position, line, as_kind, person_id, role from translation_line_fixes where item_id = any($1::bigint[]) order by item_id, position, line',
    [itemIds],
  );
  /** @type {Map<number, import('../../domain/lineFixes.js').LineFix[]>} */
  const byItem = new Map(itemIds.map((id) => [id, []]));
  for (const row of rows) {
    const list = byItem.get(row.item_id);
    const base = { part: row.position, line: row.line };
    if (row.as_kind === 'plain') list?.push({ ...base, as: 'plain' });
    else list?.push({ ...base, as: 'speech', speaker: row.person_id !== null ? { person: row.person_id } : { role: row.role } });
  }
  return byItem;
}

/**
 * Replaces an item's line fixes, writing only the delta (like
 * `setSpeakers`), so the audit log shows exactly what changed.
 * @param {Tx} tx
 * @param {number} itemId
 * @param {import('../../domain/lineFixes.js').LineFix[]} fixes
 * @returns {Promise<void>}
 */
export async function setLineFixes(tx, itemId, fixes) {
  await tx.query('delete from translation_line_fixes where item_id = $1', [itemId]);
  for (const fix of fixes) {
    const personId = fix.as === 'speech' && 'person' in fix.speaker ? fix.speaker.person : null;
    const role = fix.as === 'speech' && 'role' in fix.speaker ? fix.speaker.role : null;
    await tx.query(
      'insert into translation_line_fixes (item_id, position, line, as_kind, person_id, role) values ($1, $2, $3, $4, $5, $6)',
      [itemId, fix.part, fix.line, fix.as, personId, role],
    );
  }
}

/**
 * Drops the line fixes of one part (the edit-window re-fetch rewrote that
 * part's body, so its positions no longer apply). Caller runs it in the
 * same transaction as the part update.
 * @param {Tx} tx
 * @param {number} itemId
 * @param {number} position
 * @returns {Promise<void>}
 */
export async function dropFixesForPart(tx, itemId, position) {
  await tx.query('delete from translation_line_fixes where item_id = $1 and position = $2', [itemId, position]);
}

/**
 * Everything a presenter needs for each translation item. `body` is the
 * parts joined with a blank line. Items with no `translations` row are
 * left out. A part held for review is left out too, unless the caller
 * asks for it (`includePending`, the owner's edit screen): the public
 * page, previews and search must never show unreviewed text.
 * @param {Tx} db
 * @param {number[]} itemIds
 * @param {{ includePending?: boolean }} [options]
 * @returns {Promise<Map<number, TranslationDetails>>}
 */
export async function loadDetails(db, itemIds, { includePending = false } = {}) {
  const [parts, speakers, sources, manual, fixes, subbed] = await Promise.all([
    partsOf(db, itemIds), speakersOf(db, itemIds), listSourcesFor(db, itemIds), manualFlagsOf(db, itemIds), fixesOf(db, itemIds), subbedOf(db, itemIds),
  ]);
  /** @type {Map<number, TranslationDetails>} */
  const details = new Map();
  for (const id of itemIds) {
    if (!manual.has(id)) continue;
    const texts = (parts.get(id) ?? []).filter((p) => includePending || !p.pending).map((p) => p.body);
    details.set(id, {
      parts: texts, body: texts.join('\n\n'), speakers: speakers.get(id) ?? {},
      sources: sources.get(id) ?? [], textEnteredManually: manual.get(id) === true,
      fixes: fixes.get(id) ?? [], subbed: subbed.get(id) === true,
    });
  }
  return details;
}
