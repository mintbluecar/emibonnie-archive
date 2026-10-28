// @ts-check
import { PUBLIC_CACHE, PRIVATE_NO_STORE, jsonWithCache } from '../http/handler.js';
import { withCacheTags } from '../http/cacheTags.js';
import { NotFound } from '../http/errors.js';
import { itemPage } from '../services/itemPage.js';
import { currentUser } from '../services/session.js';

/**
 * `GET /api/item/:kind/:sourceId`: one visible item's page, with
 * `editOpenUntil`. An elapsed, unfinalized edit window is refreshed in
 * the background (`deps.defer`), so the response isn't delayed and the
 * CDN still caches it. A signed-in viewer gets `canEdit`/`canCheckFollowUps`
 * and a `private, no-store` response (the flags are per-user); everyone
 * else gets the public view under the route's cache.
 */
export const route = {
  method: 'GET',
  path: '/api/item/:kind/:sourceId',
  cache: PUBLIC_CACHE,
  /** @param {import('../http/handler.js').RouteInput} input @param {any} deps */
  run: async (input, deps) => {
    const viewer = await currentUser(deps, input);
    const page = await itemPage(deps, input.params.kind, input.params.sourceId, viewer);
    if (!page) throw new NotFound();
    if (page.refresh) deps.defer(page.refresh);
    // A signed-in view carries per-user buttons: private, and never tagged.
    if (viewer) return jsonWithCache(page.view, PRIVATE_NO_STORE);
    return withCacheTags(jsonWithCache(page.view, PUBLIC_CACHE), page.tags);
  },
};
