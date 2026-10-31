// @ts-check
import { NO_STORE } from '../http/handler.js';
import { NotFound } from '../http/errors.js';
import { refreshItem } from '../services/itemPage.js';
import { purgeReloadedItem } from '../services/cache.js';

/**
 * `POST /api/item/:kind/:sourceId/refresh`: the "check for update"
 * button. No sign-in; the handler's Origin check applies. Throttled
 * (no X fetch) within 60 s of the last refresh; 409 once every post is
 * finalized.
 */
export const route = {
  method: 'POST',
  path: '/api/item/:kind/:sourceId/refresh',
  cache: NO_STORE,
  /** @param {import('../http/handler.js').RouteInput} input @param {import('../http/deps.js').Deps} deps */
  run: async ({ params }, deps) => {
    const result = await refreshItem(deps, params.kind, params.sourceId);
    if (!result) throw new NotFound();
    // `itemId` is for the purge, never for the response.
    const { itemId, ...body } = result;
    // The button reloads the public page next: its own CDN copy is deleted
    // before this response, so the reload never gets the stale one.
    if (result.updated > 0) await purgeReloadedItem(deps, itemId);
    return body;
  },
};
