// @ts-check
/**
 * `POST /api/dev/import { urls }`: creates a real held import job, for the
 * browser tests only. DEV_SIGN_IN and no VERCEL, like `authDev`.
 */
import { NO_STORE } from '../http/handler.js';
import { NotFound } from '../http/errors.js';
import { seedHeldJob } from '../services/importJob.js';
import { parseTweetId } from '../sources/url.js';

export const devImportRoute = {
  method: 'POST',
  path: '/api/dev/import',
  cache: NO_STORE,
  /** @param {import('../http/handler.js').RouteInput} input @param {any} deps */
  run: async (input, deps) => {
    if (!(deps.env?.DEV_SIGN_IN === '1' && !deps.env?.VERCEL)) throw new NotFound();
    const body = /** @type {any} */ (input.body);
    const urls = Array.isArray(body?.urls) ? body.urls : [];
    const ids = /** @type {string[]} */ (urls.map((/** @type {unknown} */ url) => parseTweetId(String(url))).filter((/** @type {string|null} */ id) => id !== null));
    return ids.length === 0 ? { jobId: null, rows: [] } : seedHeldJob(deps, ids);
  },
};
