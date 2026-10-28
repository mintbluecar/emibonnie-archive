// @ts-check
import { PUBLIC_CACHE, jsonWithCache } from '../http/handler.js';
import { withCacheTags } from '../http/cacheTags.js';
import { HOME_TAG, SEARCH_TAG } from '../domain/cacheTags.js';
import { filterOptions } from '../services/hubs.js';

/** `GET /api/filters`: the search filter options (visible accounts only). */
export const route = {
  method: 'GET',
  path: '/api/filters',
  cache: PUBLIC_CACHE,
  /** @param {import('../http/handler.js').RouteInput} _input @param {any} deps */
  run: async (_input, deps) => withCacheTags(jsonWithCache(await filterOptions(deps), PUBLIC_CACHE), [HOME_TAG, SEARCH_TAG]),
};
