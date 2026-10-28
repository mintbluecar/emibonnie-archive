// @ts-check
/**
 * One item's page data, its "check for update" refresh, and its stored
 * clip. Each resolves the item through the visibility rule first, so a
 * hidden item behaves exactly like a missing one (null). Never names a
 * kind: refreshing is the kind's optional `refresh` method, and a kind
 * without one never schedules a refresh (its refresh route is a 404).
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
import { accountTag, eventTag, itemTag, personTag } from '../domain/cacheTags.js';

/** @typedef {import('./cards.js').ViewDeps & { fetchImpl: typeof fetch, now?: () => Date }} ItemDeps */
/** @typedef {import('../http/contracts.js').ItemView} ItemView */
/** @typedef {import('../http/contracts.js').VariantVM} VariantVM */
/** @typedef {Readonly<import('../kinds/defineKind.js').Kind>} Kind */

const ACTOR = { actor: 'system' };

/**
 * The visible item a kind name and source id address, with its kind; or null.
 * @param {ItemDeps} deps @param {string} kindName @param {string} sourceId
 * @returns {Promise<{ kind: Kind, id: number }|null>}
 */
async function visibleItem(deps, kindName, sourceId) {
  const kind = Object.hasOwn(kindsOf(deps), kindName) ? kindsOf(deps)[kindName] : undefined;
  const id = kind ? await findVisibleItemId(deps.db, { kind: kind.name, platform: kind.platform, externalId: sourceId }) : null;
  return kind && id !== null ? { kind, id } : null;
}

/**
 * The public page's cache tags: the entry, its event, its people and its
 * translator. A signed-in view is private and never tagged.
 * @param {number} id @param {ItemView} view @returns {string[]}
 */
function tagsOfView(id, view) {
  return [
    itemTag(id),
    ...(view.event ? [eventTag(view.event.slug)] : []),
    ...view.people.map((person) => personTag(person.id)),
    ...(view.credits?.account?.handle ? [accountTag(view.credits.account.handle)] : []),
  ];
}

/** @param {{ editableUntil: Date|string|null }[]} open @returns {string|null} */
function latestUntil(open) {
  const times = open.map((s) => (s.editableUntil === null ? null : new Date(s.editableUntil).getTime())).filter((t) => t !== null);
  return times.length > 0 ? new Date(Math.max(...times)).toISOString() : null;
}

/**
 * Runs the kind's `refresh` unless the item was refreshed in the last
 * 60 s; returns null when throttled.
 * @param {ItemDeps} deps @param {{ kind: Kind, id: number }} target
 */
async function guardedRefresh(deps, { kind, id }) {
  const refresh = /** @type {NonNullable<Kind['refresh']>} */ (kind.refresh);
  const now = deps.now?.() ?? new Date();
  const fresh = await deps.db.transaction((tx) => touchRefresh(tx, id, now), ACTOR);
  return fresh ? refresh(deps, id, ACTOR) : null;
}

/**
 * The item page: `itemView` plus `editOpenUntil` (the latest unfinalized
 * `editable_until`, or null) and, when an unfinalized window has elapsed,
 * a `refresh` for the caller to run in the background. A post with no
 * window is finalized at intake, so it never schedules one.
 * @param {ItemDeps} deps @param {string} kindName @param {string} sourceId
 * @param {import('./session.js').SessionUser|null} [viewer]
 * @returns {Promise<{ view: ItemView & { editOpenUntil: string|null, canEdit: boolean, canCheckFollowUps: boolean }, refresh: (() => Promise<unknown>)|null, tags: string[] } | null>}
 */
export async function itemPage(deps, kindName, sourceId, viewer = null) {
  const target = await visibleItem(deps, kindName, sourceId);
  const view = target ? await itemView(deps, kindName, sourceId, viewer) : null;
  if (!target || !view) return null;
  const tags = tagsOfView(target.id, view);
  if (!target.kind.refresh) return { view: { ...view, editOpenUntil: null }, refresh: null, tags };
  const open = await unfinalizedSources(deps.db, target.id);
  const now = (deps.now?.() ?? new Date()).getTime();
  const elapsed = open.some((s) => s.editableUntil !== null && new Date(s.editableUntil).getTime() < now);
  return { view: { ...view, editOpenUntil: latestUntil(open) }, refresh: elapsed ? () => guardedRefresh(deps, target) : null, tags };
}

/**
 * The "check for update" button. Null for a hidden or unknown item, or
 * one whose kind has no `refresh`; `Conflict('edit_window_closed')` once
 * every post is finalized.
 * @param {ItemDeps} deps @param {string} kindName @param {string} sourceId
 * @returns {Promise<{ itemId: number, updated: number, editOpenUntil: string|null, throttled?: true } | null>}
 */
export async function refreshItem(deps, kindName, sourceId) {
  const target = await visibleItem(deps, kindName, sourceId);
  if (!target?.kind.refresh) return null;
  const open = await unfinalizedSources(deps.db, target.id);
  if (open.length === 0) throw new Conflict('edit_window_closed');
  const result = await guardedRefresh(deps, target);
  if (!result) return { itemId: target.id, updated: 0, editOpenUntil: latestUntil(open), throttled: true };
  return { itemId: target.id, updated: result.updated, editOpenUntil: result.editableUntil };
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
