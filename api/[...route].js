// @ts-check
/**
 * The only Vercel function. Every `/api/*` request (and, through the
 * `vercel.json` rewrites, every shared `/t/:id` and `/e/:slug` link)
 * lands here: deps are built per request and closed in `finally`
 * (src/http/handler.js), and routing goes through src/routes/index.js.
 */
import { fileURLToPath } from 'node:url';
import { waitUntil } from '@vercel/functions';
import { createDb } from '../src/db/client.js';
import { site, assets } from '../src/site/generated.js';
import { routes } from '../src/routes/index.js';
import { createHandler } from '../src/http/handler.js';

/** The built pages (`vercel.json` bundles `public/{item,event}.html` with this function). */
const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));

/** A fresh set of deps for one request: never shared, never cached between requests. */
function makeDeps() {
  return {
    db: createDb({ url: process.env.DATABASE_URL, dir: process.env.PGLITE_DIR }),
    fetchImpl: globalThis.fetch,
    now: () => new Date(),
    site,
    pages: { dir: PUBLIC_DIR, logo: assets.logo },
  };
}

export default { fetch: createHandler({ routes, makeDeps, waitUntil }) };
