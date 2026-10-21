// @ts-check
import { PUBLIC_CACHE } from '../http/handler.js';
import { eventMetaPage, itemMetaPage } from '../services/meta.js';

/** @param {string} html */
const htmlResponse = (html) => new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });

/**
 * `GET /api/meta/e/:slug` (behind the `/e/:slug` rewrite): the event page
 * with link-preview meta; generic meta for a hidden or unknown event.
 */
export const eventMeta = {
  method: 'GET',
  path: '/api/meta/e/:slug',
  cache: PUBLIC_CACHE,
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
  /** @param {import('../http/handler.js').RouteInput} input @param {any} deps */
  run: async ({ params, origin }, deps) => htmlResponse(await itemMetaPage(deps, { prefix: params.prefix, sourceId: params.sourceId, origin })),
};
