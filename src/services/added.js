// @ts-check
/**
 * The me page's "added by me" list (Plan 2a Task 12): one page of the
 * signed-in submitter's own items, newest first, in every review state.
 * Public lists only ever show published items; this one is the
 * submitter's own view, so a held or rejected entry is listed and
 * labelled rather than hidden.
 */
import { ownAddedIds } from '../repo/items.js';
import { presenterContext, ownPreviewsFor } from './cards.js';

/** How many own items one page holds. */
export const ADDED_PAGE_SIZE = 20;

/** @typedef {import('./cards.js').ViewDeps} ViewDeps */
/** @typedef {import('../http/contracts.js').AddedPreview} AddedPreview */

/**
 * @param {ViewDeps} deps
 * @param {string} userId
 * @param {{ offset: number }} page
 * @returns {Promise<{ items: AddedPreview[], hasMore: boolean }>}
 */
export async function addedPreviews(deps, userId, { offset }) {
  const { ids, hasMore } = await ownAddedIds(deps.db, userId, { limit: ADDED_PAGE_SIZE, offset });
  const ctx = await presenterContext(deps);
  const entries = await ownPreviewsFor(deps, ids, ctx);
  return {
    items: entries.map(({ card, preview }) => ({ ...preview, reviewState: card.reviewState })),
    hasMore,
  };
}
