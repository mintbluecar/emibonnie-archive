// @ts-check
/**
 * The item page's per-user half (review Task 13). The public item answer
 * is one CDN-cached view for everyone, so a signed-in caller's own fields
 * (`ItemViewerVM`: their edit and follow-up buttons, a fresh
 * `editOpenUntil`, and the owner's view of a held entry) come from the
 * private `…/viewer`. The page asks only when the readable `signed_in=1`
 * hint cookie is present; the hint grants nothing, and the endpoint
 * still checks the session.
 */
import { getJson, ApiError } from '../core/api.js';

/** @typedef {import('../../../src/http/contracts.js').ItemViewerVM} ItemViewerVM */

const HINT = /(?:^|;\s*)signed_in=1(?:;|$)/;

/** Whether the sign-in hint cookie is present. @returns {boolean} */
function hinted() {
  try {
    return HINT.test(String(document.cookie ?? ''));
  } catch {
    return false;
  }
}

/** Drops a hint whose session has ended, so later pages stop asking. @returns {void} */
function dropHint() {
  try {
    document.cookie = 'signed_in=; Max-Age=0; Secure; SameSite=Lax; Path=/';
  } catch {
    // no cookie access: the next 401 tries again
  }
}

/**
 * The caller's own fields on this item, or null: no hint, a 401 (the
 * session has ended: the visitor is treated as signed out), or any other
 * failure (the reader's page simply has no editor buttons).
 * @param {{ kind: string, sourceId: string }} target
 * @returns {Promise<ItemViewerVM|null>}
 */
export async function fetchViewer(target) {
  if (!hinted()) return null;
  try {
    return await getJson(`/api/item/${encodeURIComponent(target.kind)}/${encodeURIComponent(target.sourceId)}/viewer`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) dropHint();
    return null;
  }
}
