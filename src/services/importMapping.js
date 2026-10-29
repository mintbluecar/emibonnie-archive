// @ts-check
/**
 * Bulk speaker mapping for an import job (Plan 3): batch mode fills only
 * unmapped markers; a per-entry list overrides those items; remembering
 * merges one marker into the translator's memory.
 */
import { partLines } from '../domain/lineFixes.js';
import { findMarkers } from '../domain/lines.js';
import { recall, remember } from '../repo/speakerMemory.js';
import { detailsOf, recomputeRow } from './importJob.js';

/** @typedef {import('./cards.js').ViewDeps} ViewDeps */

/**
 * Applies one marker answer to a translator's held entries in a job.
 * Batch mode fills only unmapped markers; an `entries` list upserts those
 * items (the per-entry override). Remembering merges into the translator's
 * memory, never replacing its other markers.
 * @param {ViewDeps} deps
 * @param {{ jobId: number, accountId: number, marker: string,
 *   speaker: { person: number }|{ role: string }, remember?: boolean, entries?: number[] }} input
 * @returns {Promise<{ updated: number }>}
 */
export async function applyMapping(deps, { jobId, accountId, marker, speaker, remember: rememberIt = false, entries }) {
  const only = Array.isArray(entries) && entries.length > 0 ? new Set(entries) : null;
  const { rows: candidates } = await deps.db.query(
    `select i.id, i.kind from items i join import_rows r on r.item_id = i.id
     where r.job_id = $1 and r.state = any($2::text[]) and i.credited_account_id = $3`,
    [jobId, ['fetched', 'needs_speakers', 'check', 'attached'], accountId],
  );
  const details = await detailsOf(deps, candidates);
  const targets = candidates.filter((item) => {
    if (only && !only.has(item.id)) return false;
    const detail = details.get(item.id);
    if (!detail) return false;
    return findMarkers(partLines(detail.parts, detail.fixes ?? [])).some((found) => found.marker === marker);
  });
  if (targets.length === 0) return { updated: 0 };
  const personId = 'person' in speaker ? speaker.person : null;
  const role = 'role' in speaker ? speaker.role : null;
  await deps.db.transaction(async (tx) => {
    for (const item of targets) {
      if (only) {
        await tx.query(
          `insert into translation_speakers (item_id, marker, person_id, role) values ($1, $2, $3, $4)
           on conflict (item_id, marker) do update set person_id = excluded.person_id, role = excluded.role`,
          [item.id, marker, personId, role],
        );
      } else {
        await tx.query(
          `insert into translation_speakers (item_id, marker, person_id, role) values ($1, $2, $3, $4)
           on conflict (item_id, marker) do nothing`,
          [item.id, marker, personId, role],
        );
      }
    }
    if (rememberIt) {
      const memory = await recall(tx, accountId);
      memory[marker] = 'person' in speaker ? { person: speaker.person } : { role: /** @type {any} */ (speaker.role) };
      await remember(tx, accountId, memory);
    }
  }, { actor: 'system' });
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
