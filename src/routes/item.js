// @ts-check
import { PUBLIC_CACHE } from '../http/handler.js';
import { NotFound } from '../http/errors.js';
import { itemPage } from '../services/itemPage.js';

/**
 * `GET /api/item/:kind/:sourceId`: one visible item's page, with
 * `editOpenUntil`. An elapsed, unfinalized edit window is refreshed in
 * the background (`deps.defer`), so the response isn't delayed and the
 * CDN still caches it.
 */
export const route = {
  method: 'GET',
  path: '/api/item/:kind/:sourceId',
  cache: PUBLIC_CACHE,
  /** @param {import('../http/handler.js').RouteInput} input @param {any} deps */
  run: async ({ params }, deps) => {
    const page = await itemPage(deps, params.kind, params.sourceId);
    if (!page) throw new NotFound();
    if (page.refresh) deps.defer(page.refresh);
    return page.view;
  },
};
