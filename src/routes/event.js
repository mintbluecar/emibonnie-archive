// @ts-check
import { PUBLIC_CACHE } from '../http/handler.js';
import { NotFound } from '../http/errors.js';
import { eventView } from '../services/hubs.js';

/** `GET /api/event/:slug`: one visible event and its items per kind
 * (`?limit=`/`?offset=` page each section: src/http/contracts.js `Section`). */
export const route = {
  method: 'GET',
  path: '/api/event/:slug',
  cache: PUBLIC_CACHE,
  query: ['limit', 'offset'],
  /** @param {import('../http/handler.js').RouteInput} input @param {any} deps */
  run: async ({ params, query }, deps) => {
    const view = await eventView(deps, params.slug, query);
    if (!view) throw new NotFound();
    return view;
  },
};
