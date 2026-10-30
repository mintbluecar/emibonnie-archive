// @ts-check
/**
 * What the owner does with a job's rows (Plan 3): publish what is ready or
 * everything, skip a row (removing its item or rejecting its held part),
 * archive a "check" row, and retry the unfinished ones in bounded batches.
 */
import { Conflict, NotFound } from '../domain/errors.js';
import { setReviewState, softDeleteItem } from '../repo/itemState.js';
import { getRow, rowsForRun, updateRow } from '../repo/imports.js';
import { kindNamed } from './cards.js';
import { purgeItem } from './cache.js';
import { runRow } from './importJob.js';

/** @typedef {import('./cards.js').ViewDeps} ViewDeps */
/** @typedef {import('./session.js').SessionUser} SessionUser */

/** How many failed rows one retry request processes. */
export const RETRY_BATCH = 10;

/** @param {any} db @param {number} itemId @returns {Promise<any|null>} */
async function kindOfItem(db, itemId) {
  const { rows } = await db.query('select kind from items where id = $1', [itemId]);
  return rows[0] ? kindNamed({}, rows[0].kind) : null;
}

/**
 * Publishes the job's held rows: ready only, or every held row.
 * @param {ViewDeps & { env?: Record<string, string|undefined> }} deps
 * @param {{ jobId: number, scope: 'ready'|'all', actor: SessionUser }} input
 * @returns {Promise<{ published: number }>}
 */
export async function publishRows(deps, { jobId, scope, actor }) {
  const states = scope === 'ready' ? ['fetched'] : ['fetched', 'needs_speakers', 'check', 'attached'];
  const { rows } = await deps.db.query(
    'select id, state, item_id, external_id from import_rows where job_id = $1 and state = any($2::text[]) order by id',
    [jobId, states],
  );
  let published = 0;
  for (const row of rows) {
    if (row.item_id === null) continue;
    const kind = await kindOfItem(deps.db, row.item_id);
    if (row.state === 'attached') {
      if (kind && typeof kind.reviewHeld === 'function') {
        await deps.db.transaction((tx) => kind.reviewHeld(tx, { itemId: row.item_id, approve: true, sourceId: row.external_id }), { actor: actor.id });
      }
    } else {
      await deps.db.transaction((tx) => setReviewState(tx, { itemId: row.item_id, state: 'published' }), { actor: actor.id });
    }
    await purgeItem(deps, row.item_id);
    await deps.db.transaction((tx) => updateRow(tx, row.id, { state: 'published' }), { actor: actor.id });
    published += 1;
  }
  return { published };
}

/**
 * Skips a row: an item is soft-deleted with `import_skipped`, a held part
 * is rejected, a failed row is just closed. Public rows are refused.
 * @param {ViewDeps & { env?: Record<string, string|undefined> }} deps
 * @param {{ jobId: number, rowId: number, actor: SessionUser }} input
 * @returns {Promise<{ skipped: true }>}
 */
export async function skipRow(deps, { jobId, rowId, actor }) {
  const row = await getRow(deps.db, rowId);
  if (!row || row.jobId !== jobId) throw new NotFound();
  if (row.state === 'published') throw new Conflict('already published');
  const itemId = row.itemId;
  if (itemId !== null) {
    if (row.state === 'attached') {
      const kind = await kindOfItem(deps.db, itemId);
      if (kind && typeof kind.reviewHeld === 'function') {
        await deps.db.transaction((tx) => kind.reviewHeld(tx, { itemId, approve: false, sourceId: row.externalId }), { actor: actor.id });
      }
    } else {
      await deps.db.transaction(
        (tx) => softDeleteItem(tx, { itemId, reason: 'import_skipped', actor: actor.id }),
        { actor: actor.id },
      );
      await purgeItem(deps, itemId, { hard: true });
    }
  }
  await deps.db.transaction((tx) => updateRow(tx, row.id, { state: 'skipped', error: 'skipped by owner' }), { actor: actor.id });
  return { skipped: true };
}

/**
 * Publishes a "check" row the owner decided to keep.
 * @param {ViewDeps & { env?: Record<string, string|undefined> }} deps
 * @param {{ jobId: number, rowId: number, actor: SessionUser }} input
 * @returns {Promise<{ published: true }>}
 */
export async function archiveRow(deps, { jobId, rowId, actor }) {
  const row = await getRow(deps.db, rowId);
  if (!row || row.jobId !== jobId) throw new NotFound();
  const itemId = row.itemId;
  if (row.state !== 'check' || itemId === null) throw new Conflict('not a check row');
  await deps.db.transaction((tx) => setReviewState(tx, { itemId, state: 'published' }), { actor: actor.id });
  await purgeItem(deps, itemId);
  await deps.db.transaction((tx) => updateRow(tx, row.id, { state: 'published' }), { actor: actor.id });
  return { published: true };
}

/**
 * Retries up to `RETRY_BATCH` unfinished rows of a job.
 * @param {ViewDeps & { fetchImpl: typeof fetch }} deps
 * @param {{ jobId: number, actor: SessionUser }} input
 * @returns {Promise<{ processed: number, remaining: number }>}
 */
export async function retryRows(deps, { jobId, actor }) {
  const pending = await rowsForRun(deps.db, jobId);
  const batch = pending.slice(0, RETRY_BATCH);
  for (const row of batch) {
    try {
      await runRow(deps, { row, kind: 'translation', actor: actor.id, source: 'notion' });
    } catch (/** @type {any} */ err) {
      await deps.db.transaction((tx) => updateRow(tx, row.id, { state: 'failed', error: String(err?.message ?? err).slice(0, 500) }), { actor: actor.id });
    }
  }
  return { processed: batch.length, remaining: pending.length - batch.length };
}
