// @ts-check
import { PUBLIC_CACHE } from '../http/handler.js';
import { NotFound } from '../http/errors.js';
import { personView } from '../services/hubs.js';

/** `GET /api/person/:ig`: a person's page (with `redirectTo` after a handle change). */
export const route = {
  method: 'GET',
  path: '/api/person/:ig',
  cache: PUBLIC_CACHE,
  /** @param {import('../http/handler.js').RouteInput} input @param {any} deps */
  run: async ({ params }, deps) => {
    const view = await personView(deps, params.ig);
    if (!view) throw new NotFound();
    return view;
  },
};
