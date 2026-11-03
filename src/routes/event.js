// @ts-check
import { PUBLIC_CACHE, jsonWithCache } from '../http/handler.js';
import { withCacheTags } from '../http/cacheTags.js';
import { eventTag } from '../domain/cacheTags.js';
import { NotFound } from '../http/errors.js';
import { eventView } from '../services/hubs.js';

/** `GET /api/event/:date/:tag`: one visible event (slug `<date>/<tag>`) and its items per kind
 * (`?limit=`/`?offset=` page each section: src/http/contracts.js `Section`;
 * `?order=asc|desc`, default `asc`, the "newest first" toggle). */
export const route = {
  method: 'GET',
  path: '/api/event/:date/:tag',
  cache: PUBLIC_CACHE,
  query: ['limit', 'offset', 'order'],
  /** @param {import('../http/handler.js').RouteInput} input @param {import('../http/deps.js').Deps} deps */
  run: async ({ params, query }, deps) => {
    const view = await eventView(deps, `${params.date}/${params.tag}`, query);
    if (!view) throw new NotFound();
    return withCacheTags(jsonWithCache(view, PUBLIC_CACHE), [eventTag(view.event.slug)]);
  },
};
