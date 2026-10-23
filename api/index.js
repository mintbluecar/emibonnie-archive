// @ts-check
/**
 * The only Vercel function. `vercel.json`'s rewrites send every `/api/*`
 * request and every shared `/t/:id` and `/e/:slug` link here, to `/api`,
 * with unnamed sources only; the function sees the original request URL,
 * so src/routes/index.js matches `/api/...` and the page paths directly.
 * Deps are built per request and closed in `finally` (src/http/handler.js).
 */
import { fileURLToPath } from 'node:url';
import { waitUntil } from '@vercel/functions';
import { createDb, dbOptionsFromEnv } from '../src/db/client.js';
import { site, assets } from '../src/site/generated.js';
import { routes } from '../src/routes/index.js';
import { createHandler } from '../src/http/handler.js';

/** The built pages (`npm run build` writes them from `src/html/`; `vercel.json` bundles `public/{item,event}.html` with this function). */
const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));

/**
 * A fresh set of deps for one request: never shared, never cached between
 * requests. Throws (a logged 500) when production has no `DATABASE_URL`.
 * @param {Record<string, string|undefined>} [env]
 */
export function makeDeps(env = process.env) {
  return {
    db: createDb(dbOptionsFromEnv(env)),
    fetchImpl: globalThis.fetch,
    now: () => new Date(),
    site,
    pages: { dir: PUBLIC_DIR, logo: assets.logo },
  };
}

export default { fetch: createHandler({ routes, makeDeps: () => makeDeps(), waitUntil }) };
