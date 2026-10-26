// @ts-check
import { PUBLIC_CACHE, PRIVATE_NO_STORE } from '../http/handler.js';
import { NotFound } from '../http/errors.js';
import { itemPage } from '../services/itemPage.js';
import { currentUser } from '../services/session.js';

/**
 * `GET /api/item/:kind/:sourceId`: one visible item's page, with
 * `editOpenUntil`. An elapsed, unfinalized edit window is refreshed in
 * the background (`deps.defer`), so the response isn't delayed and the
 * CDN still caches it. A signed-in viewer gets `canEdit`/`canCheckFollowUps`
 * and a `private, no-store` response (the flags are per-user).
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
    if (viewer) {
      return new Response(JSON.stringify(page.view), {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': PRIVATE_NO_STORE },
      });
    }
    return page.view;
  },
};
