// @ts-check
/**
 * One item's page data, its "check for update" refresh, and its stored
 * clip. Each resolves the item through the visibility rule first, so a
 * hidden item behaves exactly like a missing one (null). Never names a kind.
 *
 * Edit windows (owner-decided, no daily sweep): the page shows the
 * update button until `editOpenUntil`; once a window has elapsed without
 * being finalized, viewing the item refreshes it in the background, and
 * `touchRefresh`'s 60 s guard keeps either path from fetching X more often.
 */
import { findVisibleItemId } from '../repo/cards.js';
import { touchRefresh, unfinalizedSources } from '../repo/sourceEdits.js';
import { Conflict } from '../domain/errors.js';
import { kindsOf } from './cards.js';
import { itemView } from './itemView.js';
import { refreshEdits } from './postUpkeep.js';

/** @typedef {import('./cards.js').ViewDeps & { fetchImpl: typeof fetch, now?: () => Date }} ItemDeps */
/** @typedef {import('../http/contracts.js').ItemView} ItemView */
/** @typedef {import('../http/contracts.js').VariantVM} VariantVM */

const ACTOR = { actor: 'system' };

/**
 * The visible item a kind name and source id address, or null.
 * @param {ItemDeps} deps @param {string} kindName @param {string} sourceId
 * @returns {Promise<number|null>}
 */
async function visibleItemId(deps, kindName, sourceId) {
  const kind = Object.hasOwn(kindsOf(deps), kindName) ? kindsOf(deps)[kindName] : undefined;
  return kind ? findVisibleItemId(deps.db, { kind: kind.name, platform: kind.platform, externalId: sourceId }) : null;
}

/** @param {{ editableUntil: Date|string|null }[]} open @returns {string|null} */
function latestUntil(open) {
  const times = open.map((s) => (s.editableUntil === null ? null : new Date(s.editableUntil).getTime())).filter((t) => t !== null);
  return times.length > 0 ? new Date(Math.max(...times)).toISOString() : null;
}

/**
 * Re-fetches the item's open posts unless one was refreshed in the last
 * 60 s; returns null when throttled.
 * @param {ItemDeps} deps @param {number} itemId
 */
async function guardedRefresh(deps, itemId) {
  const now = deps.now?.() ?? new Date();
  const fresh = await deps.db.transaction((tx) => touchRefresh(tx, itemId, now), ACTOR);
  return fresh ? refreshEdits(deps, itemId, ACTOR) : null;
}

/**
 * The item page: `itemView` plus `editOpenUntil` (the latest unfinalized
 * `editable_until`, or null) and, when an unfinalized window has elapsed,
 * a `refresh` for the caller to run in the background. A post with no
 * window is finalized at intake, so it never schedules one.
 * @param {ItemDeps} deps @param {string} kindName @param {string} sourceId
 * @returns {Promise<{ view: ItemView & { editOpenUntil: string|null }, refresh: (() => Promise<unknown>)|null } | null>}
 */
export async function itemPage(deps, kindName, sourceId) {
  const id = await visibleItemId(deps, kindName, sourceId);
  const view = id === null ? null : await itemView(deps, kindName, sourceId);
  if (id === null || !view) return null;
  const open = await unfinalizedSources(deps.db, id);
  const now = (deps.now?.() ?? new Date()).getTime();
  const elapsed = open.some((s) => s.editableUntil !== null && new Date(s.editableUntil).getTime() < now);
  return { view: { ...view, editOpenUntil: latestUntil(open) }, refresh: elapsed ? () => guardedRefresh(deps, id) : null };
}

/**
 * The "check for update" button. Null for a hidden or unknown item;
 * `Conflict('edit_window_closed')` once every post is finalized.
 * @param {ItemDeps} deps @param {string} kindName @param {string} sourceId
 * @returns {Promise<{ updated: number, editOpenUntil: string|null, throttled?: true } | null>}
 */
export async function refreshItem(deps, kindName, sourceId) {
  const id = await visibleItemId(deps, kindName, sourceId);
  if (id === null) return null;
  const open = await unfinalizedSources(deps.db, id);
  if (open.length === 0) throw new Conflict('edit_window_closed');
  const result = await guardedRefresh(deps, id);
  if (!result) return { updated: 0, editOpenUntil: latestUntil(open), throttled: true };
  return { updated: result.updated, editOpenUntil: result.editableUntil };
}

/**
 * The stored variants of a visible item's clip (its own, or the quoted
 * post's), shown only while that source is live; null otherwise.
 * @param {ItemDeps} deps @param {string} kindName @param {string} sourceId
 * @returns {Promise<{ variants: VariantVM[] } | null>}
 */
export async function videoVariants(deps, kindName, sourceId) {
  const media = (await itemView(deps, kindName, sourceId))?.media ?? null;
  const video = media?.type === 'quote' ? media.inner : media;
  return video?.type === 'video' ? { variants: video.variants } : null;
}
