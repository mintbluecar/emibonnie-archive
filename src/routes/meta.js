// @ts-check
import { PUBLIC_CACHE } from '../http/handler.js';
import { eventMetaPage, itemMetaPage } from '../services/meta.js';

/** @param {string} html */
const htmlResponse = (html) => new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });

/**
 * `GET /api/meta/e/:slug` (behind the `/e/:slug` rewrite): the event page
 * with link-preview meta; generic meta for a hidden or unknown event.
 * Shared links carry tracking params (`?s=20`), so any query is accepted
 * and ignored.
 */
export const eventMeta = {
  method: 'GET',
  path: '/api/meta/e/:slug',
  cache: PUBLIC_CACHE,
  query: null,
  /** @param {import('../http/handler.js').RouteInput} input @param {any} deps */
  run: async ({ params, origin }, deps) => htmlResponse(await eventMetaPage(deps, { slug: params.slug, origin })),
};

/**
 * `GET /api/meta/:prefix/:sourceId` (behind each kind's `<urlPrefix>:id`
 * rewrite, e.g. `/t/:id`): the item page with link-preview meta; generic
 * meta for a hidden or unknown item. Listed after `eventMeta`.
 */
export const itemMeta = {
  method: 'GET',
  path: '/api/meta/:prefix/:sourceId',
  cache: PUBLIC_CACHE,
  query: null,
  /** @param {import('../http/handler.js').RouteInput} input @param {any} deps */
  run: async ({ params, origin }, deps) => htmlResponse(await itemMetaPage(deps, { prefix: params.prefix, sourceId: params.sourceId, origin })),
};

/**
 * The same meta routes on the original page paths (`/e/:slug`, and
 * `<urlPrefix>:sourceId` for each registered kind), in case the platform
 * hands the function the original path instead of the rewritten one.
 * @param {{ urlPrefix: string }[]} kinds
 */
export function pageMetaRoutes(kinds) {
  const event = { ...eventMeta, path: '/e/:slug' };
  const items = kinds.map(({ urlPrefix }) => ({
    ...itemMeta,
    path: `${urlPrefix}:sourceId`,
    /** @param {import('../http/handler.js').RouteInput} input @param {any} deps */
    run: async (input, deps) => itemMeta.run({ ...input, params: { ...input.params, prefix: urlPrefix.slice(1, -1) } }, deps),
  }));
  return [event, ...items];
}
