// @ts-check
/**
 * The only Vercel function. `vercel.json`'s rewrites send every `/api/*`
 * request and every shared `/t/:id` and `/e/:slug` link here, to `/api`,
 * with unnamed sources only; the function sees the original request URL,
 * so src/routes/index.js matches `/api/...` and the page paths directly.
 * Deps are built per request and closed in `finally` (src/http/handler.js).
 */
import { fileURLToPath } from 'node:url';
import { waitUntil, invalidateByTag, dangerouslyDeleteByTag } from '@vercel/functions';
import { createDb, dbOptionsFromEnv } from '../src/db/client.js';
import { site, assets } from '../src/site/generated.js';
import { routes } from '../src/routes/index.js';
import { createHandler } from '../src/http/handler.js';
import { offlineFetch } from '../src/sources/offlineFetch.js';

/** The built pages (`npm run build` writes them from `src/html/`; `vercel.json` bundles `public/{item,event}.html` with this function). */
const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));

/**
 * The fetch the API reads sources through. Production and ordinary local
 * dev use the real network. The engine's e2e run sets
 * `INGEST_FIXTURES_DIR` instead (e2e/helpers.js), so pasting a link in the
 * add form works with no X access at all -- the same offline fixtures
 * `npm run seed-dev` uses. Like `DEV_SIGN_IN`, it never applies on Vercel.
 * @param {Record<string, string|undefined>} env
 * @returns {typeof fetch}
 */
function fetchFor(env) {
  const dir = env.INGEST_FIXTURES_DIR;
  return dir && !env.VERCEL ? offlineFetch(dir) : globalThis.fetch;
}

/**
 * A fresh set of deps for one request: never shared, never cached between
 * requests. Throws (a logged 500) when production has no `DATABASE_URL`.
 * @param {Record<string, string|undefined>} [env]
 */
export function makeDeps(env = process.env) {
  return {
    db: createDb(dbOptionsFromEnv(env)),
    fetchImpl: fetchFor(env),
    now: () => new Date(),
    site,
    env,
    pages: { dir: PUBLIC_DIR, logo: assets.logo },
    invalidateByTag,
    dangerouslyDeleteByTag,
  };
}

export default { fetch: createHandler({ routes, makeDeps: () => makeDeps(), waitUntil }) };
