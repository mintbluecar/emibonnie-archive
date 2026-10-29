// @ts-check
/**
 * The edit page's three writes (Plan 3 adds the second): save the pending
 * changes, save & publish a held entry through the owner's review route,
 * and revert one recorded edit. Each sets the page's busy/notice state,
 * repaints, and reloads after the server accepts it.
 */
import { getJson, postJson, ApiError } from '../core/api.js';
import { t } from '../core/site.js';
import { changesOf } from '../state/addState.js';

/** @typedef {{ api: string, reviewApi: string, data: any, choices: any, chosen: any,
 *   lineFixes: any[], busy: boolean, notice: string|null, saved: boolean, published?: boolean }} EditCtx */
/** @typedef {{ paint: () => void, reload: (opts: { saved: boolean, published?: boolean }) => Promise<void> }} EditUi */

/**
 * Re-fetches the edit screen after a save, revert or publish, so the
 * fields, the lines, the review banner and the history all show the new
 * state without leaving the page.
 * @param {EditCtx} c @param {{ adopt: (data: any, options: any) => void, paint: () => void }} ui
 * @param {{ saved: boolean, published?: boolean }} opts
 * @returns {Promise<void>}
 */
export async function reloadEntry(c, { adopt, paint }, { saved, published = false }) {
  try {
    const [data, options] = await Promise.all([getJson(`${c.api}/edit`), getJson('/api/add/options')]);
    adopt(data, options);
    c.saved = saved;
    c.published = published;
    c.notice = null;
  } catch {
    c.busy = false;
    c.notice = t('edit.failed');
  }
  paint();
}

/** @param {EditCtx} c */
function changesFor(c) {
  return changesOf(c.data.fields, { choices: c.choices, chosen: c.chosen, lineFixes: c.lineFixes });
}

/**
 * @param {EditCtx} c @param {EditUi} ui
 * @returns {Promise<void>}
 */
export async function saveEntry(c, { paint, reload }) {
  const changes = changesFor(c);
  if (Object.keys(changes).length === 0) {
    c.notice = t('edit.nothing');
    c.saved = false;
    paint();
    return;
  }
  c.busy = true;
  c.notice = null;
  c.saved = false;
  paint();
  try {
    await postJson(`${c.api}/edit`, { changes });
    await reload({ saved: true });
  } catch (err) {
    c.busy = false;
    c.notice = err instanceof ApiError && err.status === 403 ? t('edit.forbidden') : t('edit.failed');
    paint();
  }
}

/**
 * "save & publish": saves whatever the page has changed, then publishes
 * the held entry. A failed publish leaves the entry held and says so.
 * @param {EditCtx} c @param {EditUi} ui
 * @returns {Promise<void>}
 */
export async function publishEntry(c, { paint, reload }) {
  const changes = changesFor(c);
  c.busy = true;
  c.notice = null;
  c.saved = false;
  c.published = false;
  paint();
  if (Object.keys(changes).length > 0) {
    try {
      await postJson(`${c.api}/edit`, { changes });
    } catch (err) {
      c.busy = false;
      c.notice = err instanceof ApiError && err.status === 403 ? t('edit.forbidden') : t('edit.failed');
      paint();
      return;
    }
  }
  try {
    await postJson(c.reviewApi, { state: 'published' });
  } catch {
    c.busy = false;
    c.notice = t('edit.publishFailed');
    paint();
    return;
  }
  await reload({ saved: false, published: true });
}

/**
 * @param {EditCtx} c @param {number} editId @param {EditUi} ui
 * @returns {Promise<void>}
 */
export async function revertEntry(c, editId, { paint, reload }) {
  c.busy = true;
  paint();
  try {
    await postJson(`${c.api}/edits/${editId}/revert`);
    await reload({ saved: false });
  } catch {
    c.busy = false;
    c.notice = t('edit.failed');
    paint();
  }
}
