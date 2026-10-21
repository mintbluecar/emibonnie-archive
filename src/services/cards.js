// @ts-check
/**
 * Turns item ids into the kind-presented view models every list and
 * page shows: loads the shared cards (visible items only), then each
 * kind's details, and hands both to that kind's presenter with one
 * presenter context per request. Never names a kind: kinds come from the
 * registry (or `deps.kinds`).
 */
import { kindsRegistry } from '../kinds/_registry.js';
import { listPeople } from '../repo/people.js';
import { loadCards } from '../repo/cards.js';
import { formatName } from '../site/loadSite.js';

/** @typedef {import('../kinds/defineKind.js').Kind} Kind */
/** @typedef {import('../repo/cards.js').Card} Card */
/** @typedef {import('../http/contracts.js').Preview} Preview */
/** @typedef {import('../http/contracts.js').PersonChip} PersonChip */
/** @typedef {import('../http/contracts.js').EventRef} EventRef */
/** @typedef {import('../kinds/defineKind.js').PresentContext} PresentContext */
/** @typedef {import('../repo/people.js').Person} Person */
/**
 * @typedef {{ db: import('../db/common.js').Db, site: import('../site/schema.js').Site,
 *   kinds?: Record<string, Readonly<Kind>> }} ViewDeps
 */

/** @param {ViewDeps} deps @returns {Record<string, Readonly<Kind>>} */
export function kindsOf(deps) {
  return deps.kinds ?? kindsRegistry;
}

/** @param {Person} person @param {(name: string) => string} format @returns {PersonChip} */
export function chipOf(person, format) {
  return { id: person.id, name: format(person.displayName), emoji: person.emoji, colour: person.colour, igHandle: person.igHandle };
}

/** @param {Card['event']} event @returns {EventRef|null} */
export function eventRefOf(event) {
  return event ? { slug: event.slug, name: event.name, occurredOn: event.occurredOn } : null;
}

/**
 * @param {ViewDeps} deps
 * @returns {Promise<PresentContext>}
 */
export async function presenterContext(deps) {
  const people = new Map((await listPeople(deps.db)).map((p) => [p.id, p]));
  const format = (/** @type {string} */ name) => formatName(deps.site, name);
  const kinds = kindsOf(deps);
  return {
    people,
    formatName: format,
    urlFor: (kind, sourceId) => `${kinds[kind]?.urlPrefix ?? '/'}${sourceId}`,
    chips: (list) => [...new Set(list.map((p) => p.personId))]
      .map((id) => people.get(id))
      .filter((p) => p !== undefined)
      .map((p) => chipOf(p, format)),
  };
}

/**
 * Each kind's details for the cards of that kind, in one call per kind.
 * @param {ViewDeps} deps
 * @param {Card[]} cards
 * @returns {Promise<Map<number, any>>}
 */
export async function detailsFor(deps, cards) {
  const kinds = kindsOf(deps);
  /** @type {Map<number, any>} */
  const details = new Map();
  for (const name of new Set(cards.map((c) => c.kind))) {
    const kind = kinds[name];
    if (!kind) continue;
    const loaded = await kind.loadDetails(deps.db, cards.filter((c) => c.kind === name).map((c) => c.id));
    for (const [id, entry] of loaded) details.set(id, entry);
  }
  return details;
}

/**
 * The previews of the visible items among `itemIds`, in that order.
 * Hidden ids and items of unknown kinds are left out.
 * @param {ViewDeps} deps
 * @param {number[]} itemIds
 * @param {PresentContext} ctx
 * @returns {Promise<{ card: Card, details: any, preview: Preview }[]>}
 */
export async function previewsFor(deps, itemIds, ctx) {
  const cards = await loadCards(deps.db, itemIds);
  const ordered = itemIds.map((id) => cards.get(id)).filter((c) => c !== undefined);
  const details = await detailsFor(deps, ordered);
  const kinds = kindsOf(deps);
  return ordered
    .filter((card) => kinds[card.kind] && details.has(card.id))
    .map((card) => {
      const entry = details.get(card.id);
      return { card, details: entry, preview: /** @type {Preview} */ (kinds[card.kind].present.preview(card, entry, ctx)) };
    });
}
