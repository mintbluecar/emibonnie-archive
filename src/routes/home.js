// @ts-check
import { PUBLIC_CACHE } from '../http/handler.js';
import { homeView } from '../services/hubs.js';

/** `GET /api/home`: every visible event, newest first, grouped by month. */
export const route = {
  method: 'GET',
  path: '/api/home',
  cache: PUBLIC_CACHE,
  /** @param {import('../http/handler.js').RouteInput} _input @param {any} deps */
  run: async (_input, deps) => homeView(deps),
};
