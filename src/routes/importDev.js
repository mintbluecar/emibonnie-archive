// @ts-check
/**
 * `POST /api/dev/import { urls }`: creates a real held import job, for the
 * browser tests only. DEV_SIGN_IN and no VERCEL, like `authDev`.
 */
import { NotFound } from '../http/errors.js';
import { defineRoute, fieldsOf } from '../http/defineRoute.js';
import { seedHeldJob } from '../services/importJob.js';
import { parseTweetId } from '../sources/url.js';

/** `{ urls }`: the post ids among them (anything else is dropped). @param {unknown} raw @returns {string[]} */
function idsBody(raw) {
  const { urls } = fieldsOf(raw);
  const ids = Array.isArray(urls) ? urls.map((url) => parseTweetId(String(url))) : [];
  return ids.filter((id) => id !== null);
}

export const devImportRoute = defineRoute({
  method: 'POST',
  path: '/api/dev/import',
  auth: 'none',
  // No `body` parser: the gate answers 404 before the body is read, so a
  // deployed site never reveals the route.
  run: async ({ body }, deps) => {
    if (!(deps.env?.DEV_SIGN_IN === '1' && !deps.env?.VERCEL)) throw new NotFound();
    const ids = idsBody(body);
    return ids.length === 0 ? { jobId: null, rows: [] } : seedHeldJob(deps, ids);
  },
});
