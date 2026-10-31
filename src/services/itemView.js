// @ts-check
/**
 * One visible item's page view (src/http/contracts.js `ItemView`): its
 * kind's detail, plus the shared fields every kind's page shows -- tags,
 * category, who added it, and its neighbours in its event. Never names a
 * kind.
 */
import { neighbours } from '../repo/items.js';
import { findVisibleItemId, loadCards, loadCardsAny, loadItemExtras } from '../repo/cards.js';
import { findItemIdBySource } from '../repo/itemState.js';
import { kindNamed, eventRefOf, presenterContext, detailsFor } from './cards.js';
import { editRoleFor } from './editItem.js';

/** @typedef {import('./cards.js').ViewDeps} ViewDeps */
/** @typedef {import('../http/contracts.js').KindPreview} KindPreview */
/** @typedef {import('../http/contracts.js').DetailVM} DetailVM */
/** @typedef {import('../http/contracts.js').ItemView} ItemView */
/** @typedef {import('../http/contracts.js').ItemLink} ItemLink */
/** @typedef {import('../http/contracts.js').AddedByVM} AddedByVM */
/** @typedef {import('../repo/cards.js').ItemExtras} ItemExtras */

/**
 * Who added an item, as the public may see it: an X user by their handle
 * (or as "a fan" once that account opted out), anyone else by their chosen
 * display name, a deleted user (or one with no name) as "a fan", and the
 * engine's own `system` writes (seeds, imports) as null. Never an id or email.
 * @param {ItemExtras['submitter']} submitter
 * @returns {AddedByVM|null}
 */
export function addedByOf(submitter) {
  if (!submitter || submitter.role === 'system') return null;
  if (submitter.deleted) return { kind: 'fan' };
  if (submitter.onX) return submitter.xHandle ? { kind: 'handle', handle: submitter.xHandle } : { kind: 'fan' };
  const name = submitter.name?.trim() ?? '';
  return name ? { kind: 'name', name } : { kind: 'fan' };
}

/** @param {ViewDeps} deps @param {number|null} itemId @returns {Promise<ItemLink|null>} */
async function linkTo(deps, itemId) {
  if (itemId === null) return null;
  const card = (await loadCards(deps.db, [itemId])).get(itemId);
  const kind = card ? kindNamed(deps, card.kind) : null;
  return card && kind ? { sourceId: card.sourceId, url: `${kind.urlPrefix}${card.sourceId}` } : null;
}

/**
 * The visible item a kind name and source id address, with its card and
 * the kind's details; null when any of them is missing.
 * @param {ViewDeps} deps @param {string} kindName @param {string} sourceId
 * @param {boolean} [allowAnyState] the owner resolves held entries too
 */
async function loadVisible(deps, kindName, sourceId, allowAnyState = false) {
  const kind = kindNamed(deps, kindName);
  if (!kind) return null;
  const ref = { kind: kind.name, platform: kind.platform, externalId: sourceId };
  const id = allowAnyState ? await findItemIdBySource(deps.db, ref) : await findVisibleItemId(deps.db, ref);
  const card = id === null ? undefined : (await (allowAnyState ? loadCardsAny(deps.db, [id]) : loadCards(deps.db, [id]))).get(id);
  const details = card ? (await detailsFor(deps, [card])).get(card.id) : undefined;
  return card && details ? { kind, card, details } : null;
}

/**
 * The signed-in caller's own buttons on an item (`ItemViewerVM`'s
 * `canEdit`/`canCheckFollowUps`): whether they may edit it, and whether
 * its kind can check for follow-ups at all (the method is optional).
 * @param {import('../db/common.js').Db} db @param {{ checkFollowUps?: unknown }} kind @param {number} itemId
 * @param {import('./session.js').SessionUser} viewer
 * @returns {Promise<{ canEdit: boolean, canCheckFollowUps: boolean }>}
 */
export async function viewerFieldsOf(db, kind, itemId, viewer) {
  const role = await editRoleFor(db, itemId, viewer);
  return { canEdit: role !== null, canCheckFollowUps: role !== null && typeof kind.checkFollowUps === 'function' };
}

/**
 * One item's page view: its kind's detail, with the shared header fields
 * and its neighbours in its event. Null for an unknown kind, an unknown
 * id or a hidden item -- unless `anyState`, which the owner's
 * `…/viewer` uses to resolve an entry the public can't see; that view
 * also carries the entry's `reviewState`, for the held banner.
 * @param {ViewDeps & { kinds?: any }} deps @param {string} kindName @param {string} sourceId
 * @param {{ anyState?: boolean }} [options]
 * @returns {Promise<(ItemView & { reviewState?: string })|null>}
 */
export async function itemView(deps, kindName, sourceId, { anyState = false } = {}) {
  const found = await loadVisible(deps, kindName, sourceId, anyState);
  const extras = found ? await loadItemExtras(deps.db, found.card.id) : null;
  if (!found || !extras) return null;
  const { kind, card, details } = found;
  const ctx = await presenterContext(deps);
  const preview = /** @type {KindPreview} */ (kind.present.preview(card, details, ctx));
  const detail = /** @type {DetailVM} */ (kind.present.detail(card, details, ctx));
  const { prev, next } = card.event ? await neighbours(deps.db, card.id) : { prev: null, next: null };
  return {
    ...detail, kind: kind.name, sourceId: card.sourceId, url: preview.url, placement: card.placement,
    event: eventRefOf(card.event), people: preview.people,
    tags: { keyword: extras.keyword, hashtags: extras.hashtags }, category: extras.category, addedBy: addedByOf(extras.submitter),
    followsOnFrom: preview.followsOnFrom, prev: await linkTo(deps, prev), next: await linkTo(deps, next),
    ...(anyState ? { reviewState: card.reviewState } : {}),
  };
}
