// @ts-check
/**
 * `defineRoute(spec)`: the one place that owns a route's auth, rate limit,
 * body parsing and cache default, so a route's `run` starts from a resolved
 * user and a parsed body. In order, the wrapper:
 *
 * 1. resolves the user: `'user'` → `requireUser`, `'owner'` → `requireOwner`,
 *    `'optional'` → `currentUser`, `'none'` → no lookup (user is null);
 * 2. applies `spec.limit` (a `LIMITS` name): an IP-keyed bucket counts the
 *    caller's IP, any other bucket the user's id;
 * 3. parses the body with `spec.body`, which throws `BadRequest` (a 400);
 * 4. runs the route with `{ params, query, body, user, ip, origin, cookies }`.
 *
 * The cache defaults to `PRIVATE_NO_STORE` for a GET that requires a user and
 * `NO_STORE` for a write; any other GET declares its own. Declaring
 * `PUBLIC_CACHE` on a GET that requires a user throws when the route is
 * defined, and so does a user-keyed limit on a route that may have no user.
 *
 * The returned `Route` carries a read-only `auth`. A route not built here
 * counts as `auth: 'none'`.
 */
import { NO_STORE, PRIVATE_NO_STORE, PUBLIC_CACHE } from './handler.js';
import { currentUser, requireOwner, requireUser } from '../services/session.js';
import { LIMITS, limit } from '../services/limits.js';

/** @typedef {import('./handler.js').Route} Route */
/** @typedef {import('./handler.js').RouteInput} RouteInput */
/** @typedef {import('../services/session.js').SessionUser} SessionUser */
/** @typedef {'none'|'optional'|'user'|'owner'} Auth */

/**
 * The user a route of auth `A` sees.
 * @template {Auth} A
 * @typedef {A extends 'user'|'owner' ? SessionUser : A extends 'optional' ? SessionUser|null : null} UserFor
 */

/**
 * @template {Auth} A
 * @template T
 * @typedef {{ params: Record<string, string>, query: Record<string, string|string[]>, body: T, user: UserFor<A>,
 *   ip: string|null, origin: string, cookies: Record<string, string> }} RouteContext
 */

/**
 * @template {Auth} A
 * @template T
 * @typedef {{ method: 'GET'|'POST', path: string, auth: A, limit?: keyof typeof LIMITS, body?: (raw: unknown) => T,
 *   cache?: string, query?: readonly string[]|null, run: (ctx: RouteContext<A, T>, deps: any) => Promise<unknown> }} RouteSpec
 */

const SIGNED_IN = new Set(['user', 'owner']);

/**
 * A JSON body's fields: the object itself, or `{}` for anything else, so a
 * parser reads `fieldsOf(raw).name` without casting the body.
 * @param {unknown} raw
 * @returns {Record<string, unknown>}
 */
export function fieldsOf(raw) {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? /** @type {Record<string, unknown>} */ (raw) : {};
}

/** @param {keyof typeof LIMITS} name */
const ipKeyed = (name) => {
  const entry = LIMITS[name];
  return 'subject' in entry && entry.subject === 'ip';
};

/**
 * The route's cache header, or throws for a combination that could share a
 * signed-in response or that has no safe default.
 * @param {RouteSpec<Auth, unknown>} spec
 * @returns {string}
 */
function cacheOf(spec) {
  const signedIn = SIGNED_IN.has(spec.auth);
  if (spec.method !== 'GET') return spec.cache ?? NO_STORE;
  if (signedIn && spec.cache === PUBLIC_CACHE) throw new Error(`${spec.path}: a GET that requires a user cannot be public`);
  if (spec.cache) return spec.cache;
  if (signedIn) return PRIVATE_NO_STORE;
  throw new Error(`${spec.path}: a GET without a required user declares its cache`);
}

/**
 * @param {any} deps @param {RouteInput} input @param {Auth} auth
 * @returns {Promise<SessionUser|null>}
 */
function userFor(deps, input, auth) {
  if (auth === 'owner') return requireOwner(deps, input);
  if (auth === 'user') return requireUser(deps, input);
  if (auth === 'optional') return currentUser(deps, input);
  return Promise.resolve(null);
}

/**
 * @template {Auth} A
 * @template [T=unknown]
 * @param {RouteSpec<A, T>} spec
 * @returns {Route & { readonly auth: A }}
 */
export function defineRoute(spec) {
  const cache = cacheOf(/** @type {RouteSpec<Auth, unknown>} */ (spec));
  const limitName = spec.limit;
  if (limitName && !ipKeyed(limitName) && !SIGNED_IN.has(spec.auth)) {
    throw new Error(`${spec.path}: the ${limitName} limit is keyed by user, so the route needs auth 'user' or 'owner'`);
  }
  /** @param {RouteInput} input @param {any} deps */
  const run = async (input, deps) => {
    const user = await userFor(deps, input, spec.auth);
    if (limitName) await limit(deps, limitName, ipKeyed(limitName) ? input.ip : (user?.id ?? null));
    const body = spec.body ? spec.body(input.body) : /** @type {T} */ (input.body);
    const { params, query, ip, origin, cookies } = input;
    return spec.run({ params, query, body, user: /** @type {UserFor<A>} */ (user), ip: ip ?? null, origin, cookies: cookies ?? {} }, deps);
  };
  return Object.freeze({ method: spec.method, path: spec.path, auth: spec.auth, cache, query: spec.query, run });
}
