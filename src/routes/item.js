// @ts-check
import { PUBLIC_CACHE, jsonWithCache } from '../http/handler.js';
import { withCacheTags } from '../http/cacheTags.js';
import { NotFound } from '../http/errors.js';
import { defineRoute } from '../http/defineRoute.js';
import { itemPage } from '../services/itemPage.js';

/**
 * `GET /api/item/:kind/:sourceId`: one visible item's page, with
 * `editOpenUntil` -- the same answer for every caller, signed in or not,
 * so the CDN caches it under the item's tags. A held or hidden item is a
 * 404 for everyone (the owner reads a held entry through `…/viewer`, as
 * every signed-in caller reads their own buttons there). An elapsed,
 * unfinalized edit window is refreshed in the background (`deps.defer`),
 * so the response isn't delayed and the CDN still caches it.
 */
export const route = defineRoute({
  method: 'GET',
  path: '/api/item/:kind/:sourceId',
  auth: 'none',
  cache: PUBLIC_CACHE,
  run: async ({ params }, deps) => {
    const page = await itemPage(deps, params.kind, params.sourceId);
    if (!page) throw new NotFound();
    if (page.refresh) deps.defer(page.refresh);
    return withCacheTags(jsonWithCache(page.view, PUBLIC_CACHE), page.tags);
  },
});
