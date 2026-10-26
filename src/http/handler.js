// @ts-check
/**
 * The one request pipeline behind `api/index.js` (and the dev
 * server): match the route, refuse a write from a foreign Origin, build
 * `deps` for this request only, parse query and body, run the route, and
 * turn its result or error into a Response with the route's cache header.
 *
 * Routes may `deps.defer(task)` work that must not delay the response; it
 * runs under the platform's `waitUntil`, and the request's database is
 * closed only once that work has settled.
 *
 * Failures are logged as method, path and the error -- never request
 * headers or the query string.
 */
import { matchRoute } from './router.js';
import { BadRequest, NotFound, Conflict, RateLimited, PayloadTooLarge, Unauthorized, Forbidden } from './errors.js';
import { originAllowed } from './origin.js';
import { assertKnownParams, parseQuery, readBody } from './query.js';
import { parseCookies } from './cookies.js';

/** Every public GET (Global Constraints: Caching). */
export const PUBLIC_CACHE = 'public, s-maxage=300, stale-while-revalidate=86400, stale-if-error=86400';
/** Video: the stored variants change rarely. */
export const VIDEO_CACHE = 'public, s-maxage=600, stale-while-revalidate=86400, stale-if-error=86400';
/** A public GET's 404: cached briefly, so a newly visible item appears within a minute. */
export const NOT_FOUND_CACHE = 'public, s-maxage=60';
/** Writes and errors. */
export const NO_STORE = 'no-store';

/**
 * @typedef {{ db: { end(): Promise<void> }, fetchImpl: typeof fetch, now: () => Date, site: any, [key: string]: unknown }} BaseDeps
 * @typedef {BaseDeps & { defer: (task: () => Promise<unknown>) => void }} Deps
 * @typedef {{ params: Record<string, string>, query: Record<string, string|string[]>, body: unknown, origin: string,
 *   cookies: Record<string, string>, ip: string|null }} RouteInput
 * @typedef {{ method: string, path: string, cache: string, query?: readonly string[]|null, lists?: readonly string[],
 *   run: (input: RouteInput, deps: any) => Promise<unknown> }} Route
 *   `query`: the query params a GET accepts (default none; null accepts any,
 *   for pages reached through shared links that carry tracking params --
 *   and, Task 10d, an in-place search's own state, e.g. `?people=1&people=2`:
 *   such a route's query is never parsed, so a repeated param can't 400 the page).
 *   `lists`: which of them hold lists.
 * @typedef {{ routes: Route[], makeDeps: () => BaseDeps, waitUntil: (promise: Promise<unknown>) => void,
 *   log?: (line: string) => void, env?: Record<string, string|undefined> }} HandlerOptions
 */

/** @param {number} status @param {unknown} body @param {string} cache */
function json(status, body, cache) {
  return Response.json(body, { status, headers: { 'cache-control': cache } });
}

/** @param {unknown} err @returns {string} */
function describe(err) {
  return err instanceof Error ? (err.stack ?? `${err.name}: ${err.message}`) : String(err);
}

/**
 * The status and JSON body for a known request error, or null for an
 * unexpected one (which the caller logs as a 500). Kept separate so
 * `errorResponse` stays a simple dispatch.
 * @param {unknown} err
 * @returns {{ status: number, body: { error: string, message?: string } } | null}
 */
function mappedError(err) {
  if (err instanceof NotFound) return { status: 404, body: { error: 'not_found' } };
  if (err instanceof PayloadTooLarge) return { status: 413, body: { error: 'payload_too_large' } };
  if (err instanceof BadRequest) return { status: 400, body: { error: 'bad_request', message: err.message } };
  if (err instanceof URIError) return { status: 400, body: { error: 'bad_request', message: 'malformed path' } };
  if (err instanceof Conflict) return { status: 409, body: { error: err.code } };
  if (err instanceof RateLimited) return { status: 429, body: { error: 'rate_limited' } };
  if (err instanceof Unauthorized) return { status: 401, body: { error: 'signed_out' } };
  if (err instanceof Forbidden) return { status: 403, body: { error: err.code } };
  return null;
}

/**
 * @param {unknown} err @param {Route|null} route
 * @param {{ method: string, pathname: string, log: (line: string) => void }} ctx
 */
function errorResponse(err, route, { method, pathname, log }) {
  const mapped = mappedError(err);
  if (mapped) {
    const cache = mapped.status === 404 && route?.method === 'GET' ? NOT_FOUND_CACHE : NO_STORE;
    return json(mapped.status, mapped.body, cache);
  }
  log(`[api] ${method} ${pathname} failed: ${describe(err)}`);
  return json(500, { error: 'internal' }, NO_STORE);
}

/**
 * The route's cache header always wins, with one exception: a GET route's
 * own Response may shorten it to `NOT_FOUND_CACHE` (the meta pages'
 * generic meta for a hidden or missing target).
 * @param {unknown} result @param {Route} route
 */
function toResponse(result, route) {
  const response = result instanceof Response ? result : json(200, result, route.cache);
  const own = response.headers.get('cache-control');
  const cache = route.method === 'GET' && own === NOT_FOUND_CACHE ? own : route.cache;
  response.headers.set('cache-control', cache);
  return response;
}

/**
 * Runs `fn` with this request's deps, closing the database in `finally` --
 * at once, or after the deferred work settles (kept alive by `waitUntil`).
 * @template T
 * @param {HandlerOptions['makeDeps']} makeDeps
 * @param {{ waitUntil: HandlerOptions['waitUntil'], onError: (err: unknown) => void }} background
 * @param {(deps: Deps) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withDeps(makeDeps, { waitUntil, onError }, fn) {
  /** @type {Promise<unknown>[]} */
  const tasks = [];
  const base = makeDeps();
  const defer = (/** @type {() => Promise<unknown>} */ task) => { tasks.push(Promise.resolve().then(task).catch(onError)); };
  try {
    return await fn({ ...base, defer });
  } finally {
    const end = () => base.db.end().catch(onError);
    if (tasks.length > 0) waitUntil(Promise.allSettled(tasks).then(end));
    else await end();
  }
}

/**
 * The client IP from the proxy headers: the first entry of
 * `x-forwarded-for`, else `x-real-ip`, else null. It is never logged.
 * @param {Request} request
 * @returns {string|null}
 */
function ipOf(request) {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim() || null;
  const real = request.headers.get('x-real-ip');
  return real ? real.trim() || null : null;
}

/**
 * HEAD is answered by the matching GET route: same status and headers, no body.
 * @param {(request: Request) => Promise<Response>} handle
 * @returns {(request: Request) => Promise<Response>}
 */
function withHead(handle) {
  return async (request) => {
    if (request.method !== 'HEAD') return handle(request);
    const res = await handle(new Request(request.url, { method: 'GET', headers: request.headers }));
    return new Response(null, { status: res.status, headers: res.headers });
  };
}

/**
 * @param {HandlerOptions} options
 * @returns {(request: Request) => Promise<Response>}
 */
export function createHandler({ routes, makeDeps, waitUntil, log = console.error, env = process.env }) {
  return withHead(async function handle(request) {
    const url = new URL(request.url);
    const ctx = { method: request.method, pathname: url.pathname, log };
    /** @type {Route|null} */
    let route = null;
    try {
      const match = matchRoute(routes, request.method, url.pathname);
      if (!match) return json(404, { error: 'not_found' }, NO_STORE);
      route = match.route;
      if (route.method !== 'GET' && !originAllowed(request, env)) return json(403, { error: 'forbidden' }, NO_STORE);
      const query = route.query === null ? {} : parseQuery(url.searchParams, route.lists);
      if (route.method === 'GET') assertKnownParams(query, route.query);
      const input = { params: match.params, query, body: await readBody(request), origin: url.origin,
        cookies: parseCookies(request.headers.get('cookie')), ip: ipOf(request) };
      const onError = (/** @type {unknown} */ err) => log(`[api] ${ctx.method} ${ctx.pathname} background work failed: ${describe(err)}`);
      const result = await withDeps(makeDeps, { waitUntil, onError }, (deps) => /** @type {Route} */ (route).run(input, deps));
      return toResponse(result, route);
    } catch (err) {
      return errorResponse(err, route, ctx);
    }
  });
}
