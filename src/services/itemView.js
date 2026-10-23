// @ts-check
/**
 * One visible item's page view (src/http/contracts.js `ItemView`): its
 * kind's detail, plus the shared fields every kind's page shows -- tags,
 * category, who added it, and its neighbours in its event. Never names a
 * kind.
 */
import { neighbours } from '../repo/items.js';
import { findVisibleItemId, loadCards, loadItemExtras } from '../repo/cards.js';
import { kindsOf, eventRefOf, presenterContext, detailsFor } from './cards.js';

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
  const kind = card ? kindsOf(deps)[card.kind] : undefined;
  return card && kind ? { sourceId: card.sourceId, url: `${kind.urlPrefix}${card.sourceId}` } : null;
}

/**
 * The visible item a kind name and source id address, with its card and
 * the kind's details; null when any of them is missing.
 * @param {ViewDeps} deps @param {string} kindName @param {string} sourceId
 */
async function loadVisible(deps, kindName, sourceId) {
  const kind = Object.hasOwn(kindsOf(deps), kindName) ? kindsOf(deps)[kindName] : undefined;
  if (!kind) return null;
  const id = await findVisibleItemId(deps.db, { kind: kind.name, platform: kind.platform, externalId: sourceId });
  const card = id === null ? undefined : (await loadCards(deps.db, [id])).get(id);
  const details = card ? (await detailsFor(deps, [card])).get(card.id) : undefined;
  return card && details ? { kind, card, details } : null;
}

/**
 * One visible item's page: its kind's detail, with the shared header
 * fields and its neighbours in its event. Null for an unknown kind, an
 * unknown id or a hidden item.
 * @param {ViewDeps} deps @param {string} kindName @param {string} sourceId
 * @returns {Promise<ItemView|null>}
 */
export async function itemView(deps, kindName, sourceId) {
  const found = await loadVisible(deps, kindName, sourceId);
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
  };
}
