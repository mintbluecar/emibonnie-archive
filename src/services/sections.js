// @ts-check
/**
 * The per-kind sections a hub page (event, person, translator) lists:
 * one page of each kind's visible items, with that kind's real total
 * (a count query, never the page's length) and whether more follow.
 * Never names a kind: kinds come from the registry, in its order.
 */
import { countVisibleItemsByKind, listVisibleItemIds } from '../repo/items.js';
import { kindsOf, eventRefOf, presenterContext, previewsFor } from './cards.js';

/** @typedef {import('./cards.js').ViewDeps} ViewDeps */
/** @typedef {{ eventId?: number, personId?: number, accountId?: number }} SectionScope */
/** @typedef {import('../http/contracts.js').Section} Section */

/**
 * @param {ViewDeps} deps
 * @param {{ scope: SectionScope, order: 'asc'|'desc', page: { limit: number, offset: number }, withEvent: boolean }} request
 *   `withEvent`: each item also carries its event (person and translator pages).
 * @returns {Promise<{ sections: any[], totals: Record<string, number> }>}
 *   `sections`: kinds with no visible items left out; `totals`: visible items per kind.
 */
export async function sectionsOf(deps, { scope, order, page, withEvent }) {
  const [ctx, totals] = await Promise.all([presenterContext(deps), countVisibleItemsByKind(deps.db, scope)]);
  /** @type {Section[]} */
  const sections = [];
  for (const kind of Object.keys(kindsOf(deps))) {
    const total = totals[kind] ?? 0;
    if (total === 0) continue;
    const rows = await listVisibleItemIds(deps.db, { ...scope, kind, order, limit: page.limit, offset: page.offset });
    const entries = await previewsFor(deps, rows.map((r) => r.id), ctx);
    const items = entries.map(({ card, preview }) => (withEvent ? { ...preview, event: eventRefOf(card.event) } : preview));
    sections.push({ kind, total, hasMore: page.offset + rows.length < total, items });
  }
  return { sections, totals };
}
