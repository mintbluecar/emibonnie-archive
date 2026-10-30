// @ts-check
import { PUBLIC_CACHE, PRIVATE_NO_STORE, jsonWithCache } from '../http/handler.js';
import { withCacheTags } from '../http/cacheTags.js';
import { NotFound } from '../http/errors.js';
import { defineRoute } from '../http/defineRoute.js';
import { itemPage } from '../services/itemPage.js';

/**
 * `GET /api/item/:kind/:sourceId`: one visible item's page, with
 * `editOpenUntil`. An elapsed, unfinalized edit window is refreshed in
 * the background (`deps.defer`), so the response isn't delayed and the
 * CDN still caches it. A signed-in viewer gets `canEdit`/`canCheckFollowUps`
 * and a `private, no-store` response (the flags are per-user); everyone
 * else gets the public view under the route's cache.
 */
export const route = defineRoute({
  method: 'GET',
  path: '/api/item/:kind/:sourceId',
  auth: 'optional',
  cache: PUBLIC_CACHE,
  run: async ({ params, user: viewer }, deps) => {
    const page = await itemPage(deps, params.kind, params.sourceId, viewer);
    if (!page) throw new NotFound();
    if (page.refresh) deps.defer(page.refresh);
    // A signed-in view carries per-user buttons: private, and never tagged.
    if (viewer) return jsonWithCache(page.view, PRIVATE_NO_STORE);
    return withCacheTags(jsonWithCache(page.view, PUBLIC_CACHE), page.tags);
  },
});
