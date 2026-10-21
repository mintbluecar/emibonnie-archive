// @ts-check
import { NOT_FOUND_CACHE, PUBLIC_CACHE } from '../http/handler.js';
import { eventMetaPage, itemMetaPage } from '../services/meta.js';

/**
 * The page, cached as briefly as a 404 when it carries the generic meta
 * of a hidden or missing target (so a newly visible one gets its preview
 * within a minute); the handler keeps that shorter cache for a GET.
 * @param {{ html: string, found: boolean }} page
 */
const htmlResponse = ({ html, found }) => new Response(html, {
  headers: { 'content-type': 'text/html; charset=utf-8', ...(found ? {} : { 'cache-control': NOT_FOUND_CACHE }) },
});

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
