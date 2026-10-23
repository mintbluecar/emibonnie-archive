// @ts-check
import { NO_STORE } from '../http/handler.js';
import { NotFound } from '../http/errors.js';
import { refreshItem } from '../services/itemPage.js';

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
  /** @param {import('../http/handler.js').RouteInput} input @param {any} deps */
  run: async ({ params }, deps) => {
    const result = await refreshItem(deps, params.kind, params.sourceId);
    if (!result) throw new NotFound();
    return result;
  },
};
