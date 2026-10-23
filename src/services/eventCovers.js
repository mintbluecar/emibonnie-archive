// @ts-check
/**
 * One representative picture per event for the home page's event cards
 * (owner, 2026-10-23): the first of an event's opening items that has a
 * picture (a clip's poster or a photo), through the same preview path as
 * every other card, so the kind decides what its picture is.
 */
import { coverCandidates } from '../repo/eventCovers.js';
import { previewsFor, presenterContext } from './cards.js';

/**
 * @param {import('./cards.js').ViewDeps} deps
 * @param {number[]} eventIds
 * @returns {Promise<Map<number, import('../http/contracts.js').ThumbVM>>}
 */
export async function eventCovers(deps, eventIds) {
  const candidates = await coverCandidates(deps.db, eventIds);
  const ids = [...candidates.values()].flat();
  if (ids.length === 0) return new Map();
  const previews = await previewsFor(deps, ids, await presenterContext(deps));
  /** @type {Map<number, import('../http/contracts.js').ThumbVM|null>} */
  const thumbs = new Map(previews.map((p) => [p.card.id, /** @type {any} */ (p.preview).thumb ?? null]));
  /** @type {Map<number, import('../http/contracts.js').ThumbVM>} */
  const out = new Map();
  for (const [eventId, itemIds] of candidates) {
    const cover = itemIds.map((id) => thumbs.get(id)).find(Boolean);
    if (cover) out.set(eventId, cover);
  }
  return out;
}
