// @ts-check
/**
 * Calls the real route table through the real handler with test deps:
 * the shared database (its `end()` left to the test file), the fixture
 * page HTML, and a `waitUntil` that collects deferred work so a test can
 * `settle()` it.
 */
import { fileURLToPath } from 'node:url';
import { createHandler } from '../../src/http/handler.js';
import { routes } from '../../src/routes/index.js';

export const ORIGIN = 'https://archive.example';
export const PAGES_DIR = fileURLToPath(new URL('../fixtures/static/', import.meta.url));

/**
 * @param {any} deps `{ db, site, fetchImpl, now }` -- any `env` of its own is only a fallback default
 *   (below), never what a route actually sees: `deps.env` always ends up being the handler's own `env`.
 * @param {{ log?: (line: string) => void, env?: Record<string, string> }} [options]
 */
export function apiFor(deps, options = {}) {
  const env = options.env ?? deps.env ?? {};
  /** @type {Promise<unknown>[]} */
  const pending = [];
  /** `makeDeps` takes the handler's own `env` (createHandler calls it with one), so `deps.env` can never
   * disagree with it -- even if `deps` above carried its own `env`, it's overwritten here. */
  const makeDeps = (/** @type {Record<string, string|undefined>} */ handlerEnv) => ({
    ...deps, db: { ...deps.db, end: async () => {} }, pages: { dir: PAGES_DIR, logo: '/site/logo.svg' }, env: handlerEnv,
  });
  const handle = createHandler({
    routes, makeDeps, log: options.log ?? ((line) => { throw new Error(`unexpected log: ${line}`); }), env,
    waitUntil: (p) => { pending.push(p); },
  });
  /**
   * @param {string} method @param {string} path
   * @param {{ body?: unknown, cookies?: Record<string, string>, origin?: string|null, headers?: Record<string, string> }} [init]
   */
  async function call(method, path, init = {}) {
    const headers = new Headers(init.headers);
    const origin = init.origin === undefined ? ORIGIN : init.origin;
    if (origin !== null && method !== 'GET') headers.set('origin', origin);
    if (init.body !== undefined) headers.set('content-type', 'application/json');
    if (init.cookies) {
      const pairs = Object.entries(init.cookies).map(([k, v]) => `${k}=${v}`);
      if (pairs.length > 0) headers.set('cookie', pairs.join('; '));
    }
    const res = await handle(new Request(`${ORIGIN}${path}`, {
      method, headers, body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }));
    return { status: res.status, headers: res.headers, setCookies: res.headers.getSetCookie(), text: await res.text() };
  }
  async function settle() {
    while (pending.length > 0) await Promise.all(pending.splice(0));
  }
  return { call, settle, pending };
}
