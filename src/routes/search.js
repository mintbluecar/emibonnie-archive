// @ts-check
import { PUBLIC_CACHE } from '../http/handler.js';
import { search } from '../services/search.js';

/** `GET /api/search`: validated by the service (anything out of bounds is a 400). */
export const route = {
  method: 'GET',
  path: '/api/search',
  cache: PUBLIC_CACHE,
  query: ['q', 'people', 'peopleMode', 'categories', 'placements', 'kinds', 'eventSlug', 'accountHandle', 'clientId', 'from', 'to', 'limit', 'offset'],
  lists: ['people', 'categories', 'placements', 'kinds'],
  /** @param {import('../http/handler.js').RouteInput} input @param {any} deps */
  run: async ({ query }, deps) => search(deps, query),
};
