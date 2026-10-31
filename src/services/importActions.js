// @ts-check
/**
 * What the owner does with a job's rows (Plan 3): publish what is ready or
 * everything, skip a row (removing its item or rejecting its held part),
 * archive a "check" row, and retry the unfinished ones in bounded batches.
 */
import { Conflict, NotFound } from '../domain/errors.js';
import { getRow, rowsForRun, updateRow } from '../repo/imports.js';
import { write } from './write.js';
import { publish, reject, remove } from './itemLifecycle.js';
import { runRow } from './importJob.js';

/** @typedef {import('./cards.js').ViewDeps} ViewDeps */
/** @typedef {import('./session.js').SessionUser} SessionUser */
/** @typedef {import('./write.js').Write} Write */

/** How many failed rows one retry request processes. */
export const RETRY_BATCH = 10;

/** @param {Write} w @param {number} itemId @returns {Promise<string>} the item's kind name ('' when it is gone) */
async function kindNameOf(w, itemId) {
  const { rows } = await w.tx.query('select kind from items where id = $1', [itemId]);
  return rows[0]?.kind ?? '';
}

/**
 * The follow-ups of `itemId` that import rows still show as `attached`
 * (held, awaiting their own publish or skip).
 * @param {Write} w @param {number} itemId
 * @returns {Promise<string[]>}
 */
async function attachedParts(w, itemId) {
  const { rows } = await w.tx.query("select external_id from import_rows where item_id = $1 and state = 'attached'", [itemId]);
  return rows.map((/** @type {any} */ row) => row.external_id);
}

/**
 * Publishes one row's item -- or, for an `attached` row, only its own held
 * part -- and marks the row published, in one transaction. A whole item's
 * publish leaves held the parts still `attached` rows (a thread's replies):
 * each is decided by its own row, so the row never reads `attached` while
 * its part is public.
 * @param {Write} w @param {{ id: number, state: string, itemId: number, externalId: string }} row
 * @returns {Promise<void>}
 */
async function publishRow(w, row) {
  const kindName = await kindNameOf(w, row.itemId);
  const scope = row.state === 'attached' ? { part: row.externalId } : { keepHeld: await attachedParts(w, row.itemId) };
  await publish(w, { itemId: row.itemId, kindName, ...scope });
  await updateRow(w.tx, row.id, { state: 'published' });
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
    await write(deps, actor.id, (w) => publishRow(w, { id: row.id, state: row.state, itemId: row.item_id, externalId: row.external_id }));
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
  await write(deps, actor.id, async (w) => {
    if (itemId !== null && row.state === 'attached') {
      await reject(w, { itemId, kindName: await kindNameOf(w, itemId), part: row.externalId });
    } else if (itemId !== null) {
      await remove(w, { itemId, reason: 'import_skipped' });
    }
    await updateRow(w.tx, row.id, { state: 'skipped', error: 'skipped by owner' });
  });
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
  await write(deps, actor.id, (w) => publishRow(w, { id: row.id, state: row.state, itemId, externalId: row.externalId }));
  return { published: true };
}

/**
 * Retries up to `RETRY_BATCH` unfinished rows of a job, starting after
 * `afterId`. A cursor, not a state filter: a row that fails again still
 * has a higher id than `afterId`, so the next call walks past it instead
 * of re-picking it forever.
 * @param {ViewDeps & { fetchImpl: typeof fetch }} deps
 * @param {{ jobId: number, actor: SessionUser, afterId?: number }} input
 * @returns {Promise<{ processed: number, remaining: number, lastId: number }>}
 */
export async function retryRows(deps, { jobId, actor, afterId = 0 }) {
  const pending = await rowsForRun(deps.db, jobId, { afterId });
  const batch = pending.slice(0, RETRY_BATCH);
  for (const row of batch) {
    try {
      await runRow(deps, { row, kind: 'translation', actor: actor.id, source: 'notion' });
    } catch (/** @type {any} */ err) {
      await deps.db.transaction((tx) => updateRow(tx, row.id, { state: 'failed', error: String(err?.message ?? err).slice(0, 500) }), { actor: actor.id });
    }
  }
  const lastId = batch.length > 0 ? batch[batch.length - 1].id : afterId;
  return { processed: batch.length, remaining: pending.length - batch.length, lastId };
}
