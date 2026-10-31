// @ts-check
/**
 * The owner's import API (Plan 3): the job list, one job with its counts,
 * rows and markers, and the rows page. Owner-only (`defineRoute`), so
 * each is `private, no-store`.
 */
import { NotFound } from '../http/errors.js';
import { defineRoute } from '../http/defineRoute.js';
import { jobView, rowsPageFor, recentJobs } from '../services/importJob.js';
import { HUB_OFFSET_MAX, integer } from '../services/params.js';

/** `GET /api/owner/imports`: the five most recent jobs. */
export const importsRoute = defineRoute({
  method: 'GET',
  path: '/api/owner/imports',
  auth: 'owner',
  query: [],
  run: async (_ctx, deps) => ({ jobs: await recentJobs(deps) }),
});

/** `GET /api/owner/imports/:id`: one job with counts, its first rows and markers. */
export const importJobRoute = defineRoute({
  method: 'GET',
  path: '/api/owner/imports/:id',
  auth: 'owner',
  query: [],
  run: async ({ params }, deps) => {
    const view = await jobView(deps, Number(params.id));
    if (!view) throw new NotFound();
    return view;
  },
});

/** `GET /api/owner/imports/:id/rows?state&q&offset`: the all-rows table. */
export const importRowsRoute = defineRoute({
  method: 'GET',
  path: '/api/owner/imports/:id/rows',
  auth: 'owner',
  query: ['state', 'q', 'offset'],
  run: async ({ params, query }, deps) => {
    const offset = integer('offset', query.offset, HUB_OFFSET_MAX, 0);
    const page = await rowsPageFor(deps, Number(params.id), {
      state: /** @type {any} */ (query.state), q: /** @type {any} */ (query.q), offset,
    });
    if (!page) throw new NotFound();
    return page;
  },
});
