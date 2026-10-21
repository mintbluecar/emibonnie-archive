// @ts-check
import { PUBLIC_CACHE } from '../http/handler.js';
import { NotFound } from '../http/errors.js';
import { eventView } from '../services/hubs.js';

/** `GET /api/event/:slug`: one visible event and its items per kind. */
export const route = {
  method: 'GET',
  path: '/api/event/:slug',
  cache: PUBLIC_CACHE,
  /** @param {import('../http/handler.js').RouteInput} input @param {any} deps */
  run: async ({ params }, deps) => {
    const view = await eventView(deps, params.slug);
    if (!view) throw new NotFound();
    return view;
  },
};
