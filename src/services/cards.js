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
import { loadCards, loadOwnCards } from '../repo/cards.js';
import { formatName } from '../site/loadSite.js';
import { ROLE_EMOJI } from '../domain/constants.js';

/** @typedef {import('../kinds/defineKind.js').Kind} Kind */
/** @typedef {import('../repo/cards.js').Card} Card */
/** @typedef {import('../http/contracts.js').Preview} Preview */
/** @typedef {import('../http/contracts.js').KindPreview} KindPreview */
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
    roleEmoji: { ...ROLE_EMOJI, ...deps.site.roleEmoji },
    urlFor: (kind, sourceId) => `${kinds[kind]?.urlPrefix ?? '/'}${sourceId}`,
    chips: (list) => [...new Set(list.map((p) => p.personId))]
      .map((id) => people.get(id))
      .filter((p) => p !== undefined)
      .map((p) => chipOf(p, format)),
  };
}

/**
 * Each kind's details for the cards of that kind, in one call per kind.
 * `includePending` reaches every kind's `loadDetails` (Task 12: the
 * submitter's own list shows text still held for review).
 * @param {ViewDeps} deps
 * @param {Card[]} cards
 * @param {{ includePending?: boolean }} [options]
 * @returns {Promise<Map<number, any>>}
 */
export async function detailsFor(deps, cards, { includePending = false } = {}) {
  const kinds = kindsOf(deps);
  /** @type {Map<number, any>} */
  const details = new Map();
  for (const name of new Set(cards.map((c) => c.kind))) {
    const kind = kinds[name];
    if (!kind) continue;
    const loaded = await kind.loadDetails(deps.db, cards.filter((c) => c.kind === name).map((c) => c.id), { includePending });
    for (const [id, entry] of loaded) details.set(id, entry);
  }
  return details;
}

/**
 * Presents `ordered` cards (already in display order) with their details.
 * @param {ViewDeps} deps
 * @param {Card[]} ordered
 * @param {PresentContext} ctx
 * @param {{ includePending?: boolean }} [options]
 * @returns {Promise<{ card: Card, details: any, preview: Preview }[]>}
 */
async function presentCards(deps, ordered, ctx, options = {}) {
  const details = await detailsFor(deps, ordered, options);
  const kinds = kindsOf(deps);
  return ordered
    .filter((card) => kinds[card.kind] && details.has(card.id))
    .map((card) => {
      const entry = details.get(card.id);
      const own = /** @type {KindPreview} */ (kinds[card.kind].present.preview(card, entry, ctx));
      return { card, details: entry, preview: { ...own, occurredOn: card.occurredOn, placement: card.placement } };
    });
}

/**
 * The previews of the visible items among `itemIds`, in that order: each
 * kind's own preview plus the shared `occurredOn` and `placement`.
 * Hidden ids and items of unknown kinds are left out.
 * @param {ViewDeps} deps
 * @param {number[]} itemIds
 * @param {PresentContext} ctx
 * @returns {Promise<{ card: Card, details: any, preview: Preview }[]>}
 */
export async function previewsFor(deps, itemIds, ctx) {
  const cards = await loadCards(deps.db, itemIds);
  const ordered = itemIds.map((id) => cards.get(id)).filter((c) => c !== undefined);
  return presentCards(deps, ordered, ctx);
}

/**
 * The submitter's own previews among `itemIds`, in that order, in any
 * review state and including text still held for review (Task 12's
 * "added by me"). Same shape as `previewsFor`, but `loadOwnCards` in
 * place of the visible-only loader.
 * @param {ViewDeps} deps
 * @param {number[]} itemIds
 * @param {PresentContext} ctx
 * @returns {Promise<{ card: Card, details: any, preview: Preview }[]>}
 */
export async function ownPreviewsFor(deps, itemIds, ctx) {
  const cards = await loadOwnCards(deps.db, itemIds);
  const ordered = itemIds.map((id) => cards.get(id)).filter((c) => c !== undefined);
  return presentCards(deps, ordered, ctx, { includePending: true });
}
