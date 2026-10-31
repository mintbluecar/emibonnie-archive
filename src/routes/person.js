// @ts-check
import { PUBLIC_CACHE, jsonWithCache } from '../http/handler.js';
import { withCacheTags } from '../http/cacheTags.js';
import { personTag } from '../domain/cacheTags.js';
import { NotFound } from '../http/errors.js';
import { personView } from '../services/hubs.js';

/** `GET /api/person/:ig`: a person's page (with `redirectTo` after a handle
 * change); `?limit=`/`?offset=` page each section (src/http/contracts.js `Section`). */
export const route = {
  method: 'GET',
  path: '/api/person/:ig',
  cache: PUBLIC_CACHE,
  query: ['limit', 'offset'],
  /** @param {import('../http/handler.js').RouteInput} input @param {import('../http/deps.js').Deps} deps */
  run: async ({ params, query }, deps) => {
    const view = await personView(deps, params.ig, query);
    if (!view) throw new NotFound();
    return withCacheTags(jsonWithCache(view, PUBLIC_CACHE), [personTag(view.person.id)]);
  },
};
