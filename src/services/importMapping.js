// @ts-check
/**
 * Bulk speaker mapping for an import job (Plan 3): batch mode fills only
 * unmapped markers; a per-entry list overrides those items; remembering
 * merges one marker into the translator's memory. Each entry changes
 * through its kind's `remapSpeakers`, so its people move with its
 * speakers, under the owner's actor. "Not a speaker" turns a marker's
 * lines plain instead, through the kind's `setLineFixes`.
 */
import { partLines } from '../domain/lineFixes.js';
import { findMarkers } from '../domain/lines.js';
import { BadRequest } from '../domain/errors.js';
import { recall, remember } from '../repo/speakerMemory.js';
import { kindNamed } from './cards.js';
import { loadContext } from './ingestContext.js';
import { detailsOf, recomputeRow } from './importJob.js';
import { write } from './write.js';

/** @typedef {import('./cards.js').ViewDeps} ViewDeps */
/** @typedef {import('../domain/speakers.js').Speaker} Speaker */
/** @typedef {{ id: number, kind: string, attached: boolean }} Candidate */

/**
 * The translator's entries held in the job, one per item; `attached` when
 * a row attached a part to it (its entry is already public). A null
 * `accountId` is the "translator unknown" card: entries credited to no one.
 * @param {ViewDeps} deps @param {number} jobId @param {number|null} accountId
 * @returns {Promise<Candidate[]>}
 */
async function heldEntries(deps, jobId, accountId) {
  const { rows } = await deps.db.query(
    `select i.id, i.kind, bool_or(r.state = 'attached') as attached
     from items i join import_rows r on r.item_id = i.id
     where r.job_id = $1 and r.state = any($2::text[]) and i.credited_account_id is not distinct from $3
     group by i.id, i.kind order by i.id`,
    [jobId, ['fetched', 'needs_speakers', 'check', 'attached'], accountId],
  );
  return rows.map((row) => ({ id: Number(row.id), kind: row.kind, attached: row.attached === true }));
}

/**
 * The entries whose text uses `marker` (only those in `only`, when given),
 * and of them the ones to change: batch mode leaves an entry that already
 * answers the marker alone.
 * @param {ViewDeps} deps @param {Candidate[]} candidates @param {string} marker @param {Set<number>|null} only
 */
async function entriesUsing(deps, candidates, marker, only) {
  const details = await detailsOf(deps, candidates);
  const using = candidates.filter((item) => {
    const detail = details.get(item.id);
    if (!detail || (only && !only.has(item.id))) return false;
    return findMarkers(partLines(detail.parts, detail.fixes ?? [])).some((found) => found.marker === marker);
  });
  const targets = only ? using : using.filter((item) => !Object.hasOwn(details.get(item.id).speakers ?? {}, marker));
  return { using, targets };
}

/**
 * Applies one marker answer to a translator's held entries in a job.
 * Batch mode fills only unmapped markers; an `entries` list re-points
 * those items (the per-entry override). Remembering merges into the
 * translator's memory, never replacing its other markers.
 * @param {ViewDeps} deps
 * @param {{ jobId: number, accountId: number|null, marker: string, speaker: Speaker,
 *   remember?: boolean, entries?: number[], actor: string }} input
 * @returns {Promise<{ updated: number }>} how many entries changed
 */
export async function applyMapping(deps, { jobId, accountId, marker, speaker, remember: rememberIt = false, entries, actor }) {
  const only = Array.isArray(entries) && entries.length > 0 ? new Set(entries) : null;
  const { using, targets } = await entriesUsing(deps, await heldEntries(deps, jobId, accountId), marker, only);
  if (using.length === 0) return { updated: 0 };
  const ctx = await loadContext(deps, {});
  await write(deps, actor, async (w) => {
    for (const item of targets) {
      const remap = kindNamed(w, item.kind)?.remapSpeakers;
      if (typeof remap !== 'function') throw new BadRequest(`kind ${item.kind} has no speakers to remap`);
      await remap(w.tx, { itemId: item.id, map: { [marker]: speaker }, ctx });
      if (item.attached) w.purge.item(item.id);
    }
    // Memory is per translator: an entry credited to no one has nobody to remember for.
    if (rememberIt && accountId !== null) {
      const memory = await recall(w.tx, accountId);
      memory[marker] = speaker;
      await remember(w.tx, accountId, memory);
    }
  });
  for (const item of targets) await recomputeRowForItem(deps, jobId, item.id);
  return { updated: targets.length };
}

/**
 * Plain-text fixes for every line in `detail` that uses `marker`, added
 * to the fixes it already has.
 * @param {any} detail @param {string} marker
 * @returns {import('../domain/lineFixes.js').LineFix[]}
 */
function withPlainFixes(detail, marker) {
  const fixes = detail.fixes ?? [];
  const added = partLines(detail.parts, fixes)
    .filter((line) => line.kind === 'speech' && !line.fixed && line.markers.includes(marker))
    .map((line) => ({ part: line.part, line: line.line, as: /** @type {const} */ ('plain') }));
  return [...fixes, ...added];
}

/**
 * "Not a speaker" (owner feedback, 2026-11-02): the marker's lines on a
 * translator's held entries in this job read as plain text, through line
 * fixes, so the marker leaves the table. For this import only: speaker
 * memory is never touched. Batch mode and `entries` work as in
 * `applyMapping`.
 * @param {ViewDeps} deps
 * @param {{ jobId: number, accountId: number|null, marker: string, entries?: number[], actor: string }} input
 * @returns {Promise<{ updated: number }>}
 */
export async function applyNotSpeaker(deps, { jobId, accountId, marker, entries, actor }) {
  const only = Array.isArray(entries) && entries.length > 0 ? new Set(entries) : null;
  const { using, targets } = await entriesUsing(deps, await heldEntries(deps, jobId, accountId), marker, only);
  if (using.length === 0) return { updated: 0 };
  const details = await detailsOf(deps, targets);
  await write(deps, actor, async (w) => {
    for (const item of targets) {
      const setLineFixes = kindNamed(w, item.kind)?.setLineFixes;
      if (typeof setLineFixes !== 'function') throw new BadRequest(`kind ${item.kind} has no lines to fix`);
      await setLineFixes(w.tx, { itemId: item.id, fixes: withPlainFixes(details.get(item.id), marker) });
      if (item.attached) w.purge.item(item.id);
    }
  });
  for (const item of targets) await recomputeRowForItem(deps, jobId, item.id);
  return { updated: targets.length };
}

/**
 * Recomputes the job row that holds one item.
 * @param {ViewDeps} deps @param {number} jobId @param {number} itemId
 */
async function recomputeRowForItem(deps, jobId, itemId) {
  const { rows } = await deps.db.query(
    "select id from import_rows where job_id = $1 and item_id = $2 and state = any($3::text[])",
    [jobId, itemId, ['fetched', 'needs_speakers', 'check']],
  );
  for (const row of rows) await recomputeRow(deps, row.id);
}
