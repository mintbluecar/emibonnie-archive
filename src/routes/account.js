// @ts-check
import { PUBLIC_CACHE, jsonWithCache } from '../http/handler.js';
import { withCacheTags } from '../http/cacheTags.js';
import { accountTag } from '../domain/cacheTags.js';
import { NotFound } from '../http/errors.js';
import { accountView } from '../services/hubs.js';

/**
 * `GET /api/account/:handle`: a translator's page. An opted-out account
 * answers only `{ account: { handle, optedOut: true } }`, echoing the
 * handle that was asked for. `?limit=`/`?offset=` page each section
 * (src/http/contracts.js `Section`).
 */
export const route = {
  method: 'GET',
  path: '/api/account/:handle',
  cache: PUBLIC_CACHE,
  query: ['limit', 'offset'],
  /** @param {import('../http/handler.js').RouteInput} input @param {import('../http/deps.js').Deps} deps */
  run: async ({ params, query }, deps) => {
    const view = await accountView(deps, params.handle, query);
    if (!view) throw new NotFound();
    return withCacheTags(jsonWithCache(view, PUBLIC_CACHE), [accountTag(view.account.handle)]);
  },
};
