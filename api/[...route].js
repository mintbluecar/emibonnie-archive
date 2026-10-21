// @ts-check
/**
 * The only Vercel function. Every `/api/*` request (and, through the
 * `vercel.json` rewrites, every shared `/t/:id` and `/e/:slug` link)
 * lands here: deps are built per request and closed in `finally`
 * (src/http/handler.js), and routing goes through src/routes/index.js.
 */
import { fileURLToPath } from 'node:url';
import { waitUntil } from '@vercel/functions';
import { createDb, dbOptionsFromEnv } from '../src/db/client.js';
import { site, assets } from '../src/site/generated.js';
import { routes } from '../src/routes/index.js';
import { createHandler } from '../src/http/handler.js';

/** The built pages (`vercel.json` bundles `public/{item,event}.html` with this function). */
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
