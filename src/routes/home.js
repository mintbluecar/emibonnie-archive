// @ts-check
import { PUBLIC_CACHE, jsonWithCache } from '../http/handler.js';
import { withCacheTags } from '../http/cacheTags.js';
import { HOME_TAG } from '../domain/cacheTags.js';
import { homeView } from '../services/hubs.js';

/** `GET /api/home`: every visible event, newest first, grouped by month. */
export const route = {
  method: 'GET',
  path: '/api/home',
  cache: PUBLIC_CACHE,
  /** @param {import('../http/handler.js').RouteInput} _input @param {import('../http/deps.js').Deps} deps */
  run: async (_input, deps) => withCacheTags(jsonWithCache(await homeView(deps), PUBLIC_CACHE), [HOME_TAG]),
};
