// @ts-check
/**
 * Bulk speaker mapping for an import job (Plan 3): batch mode fills only
 * unmapped markers; a per-entry list overrides those items; remembering
 * merges one marker into the translator's memory. Each entry changes
 * through its kind's `remapSpeakers`, so its people move with its
 * speakers, under the owner's actor.
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
 * a row attached a part to it (its entry is already public).
 * @param {ViewDeps} deps @param {number} jobId @param {number} accountId
 * @returns {Promise<Candidate[]>}
 */
async function heldEntries(deps, jobId, accountId) {
  const { rows } = await deps.db.query(
    `select i.id, i.kind, bool_or(r.state = 'attached') as attached
     from items i join import_rows r on r.item_id = i.id
     where r.job_id = $1 and r.state = any($2::text[]) and i.credited_account_id = $3
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
 * @param {{ jobId: number, accountId: number, marker: string, speaker: Speaker,
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
    if (rememberIt) {
      const memory = await recall(w.tx, accountId);
      memory[marker] = speaker;
      await remember(w.tx, accountId, memory);
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
