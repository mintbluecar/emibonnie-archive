// @ts-check
/**
 * The owner's import API (Plan 3): the job list, one job with its counts,
 * rows and markers, and the rows page. Plus a dev-only seed so the browser
 * tests can create a real job on the e2e database.
 */
import { NO_STORE, PRIVATE_NO_STORE } from '../http/handler.js';
import { NotFound } from '../http/errors.js';
import { requireOwner } from '../services/session.js';
import { jobView, rowsPageFor, recentJobs, seedHeldJob } from '../services/importJob.js';
import { HUB_OFFSET_MAX, integer } from '../services/params.js';
import { parseTweetId } from '../sources/url.js';

/** `GET /api/owner/imports`: the five most recent jobs. */
export const importsRoute = {
  method: 'GET',
  path: '/api/owner/imports',
  cache: PRIVATE_NO_STORE,
  query: [],
  /** @param {import('../http/handler.js').RouteInput} input @param {any} deps */
  run: async (input, deps) => {
    await requireOwner(deps, input);
    return { jobs: await recentJobs(deps) };
  },
};

/** `GET /api/owner/imports/:id`: one job with counts, its first rows and markers. */
export const importJobRoute = {
  method: 'GET',
  path: '/api/owner/imports/:id',
  cache: PRIVATE_NO_STORE,
  query: [],
  /** @param {import('../http/handler.js').RouteInput} input @param {any} deps */
  run: async (input, deps) => {
    await requireOwner(deps, input);
    const view = await jobView(deps, Number(input.params.id));
    if (!view) throw new NotFound();
    return view;
  },
};

/** `GET /api/owner/imports/:id/rows?state&q&offset`: the all-rows table. */
export const importRowsRoute = {
  method: 'GET',
  path: '/api/owner/imports/:id/rows',
  cache: PRIVATE_NO_STORE,
  query: ['state', 'q', 'offset'],
  /** @param {import('../http/handler.js').RouteInput} input @param {any} deps */
  run: async (input, deps) => {
    await requireOwner(deps, input);
    const offset = integer('offset', input.query.offset, HUB_OFFSET_MAX, 0);
    const page = await rowsPageFor(deps, Number(input.params.id), {
      state: /** @type {any} */ (input.query.state), q: /** @type {any} */ (input.query.q), offset,
    });
    if (!page) throw new NotFound();
    return page;
  },
};

/** `POST /api/dev/import { urls }`: a real held job, for the browser tests only. */
export const devImportRoute = {
  method: 'POST',
  path: '/api/dev/import',
  cache: NO_STORE,
  /** @param {import('../http/handler.js').RouteInput} input @param {any} deps */
  run: async (input, deps) => {
    if (!(deps.env?.DEV_SIGN_IN === '1' && !deps.env?.VERCEL)) throw new NotFound();
    const body = /** @type {any} */ (input.body);
    const ids = (Array.isArray(body?.urls) ? body.urls : []).map((/** @type {unknown} */ url) => parseTweetId(String(url))).filter((/** @type {string|null} */ id) => id !== null);
    if (ids.length === 0) return { jobId: null, rows: [] };
    return seedHeldJob(deps, ids);
  },
};
