// @ts-check
import { PUBLIC_CACHE } from '../http/handler.js';
import { filterOptions } from '../services/hubs.js';

/** `GET /api/filters`: the search filter options (visible accounts only). */
export const route = {
  method: 'GET',
  path: '/api/filters',
  cache: PUBLIC_CACHE,
  /** @param {import('../http/handler.js').RouteInput} _input @param {any} deps */
  run: async (_input, deps) => filterOptions(deps),
};
