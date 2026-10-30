// @ts-check
/**
 * `POST /api/auth/dev`: a local-only sign-in for e2e and dev. Works only
 * when `env.DEV_SIGN_IN === '1'` and `env.VERCEL` is unset; otherwise it
 * is a 404 (so the endpoint doesn't exist in production). `as:
 * 'translator'` signs in as the first credited X account, so the browser
 * can reach a real translator's own pages.
 *
 * `GET /api/auth/dev?as=<role>[&handle=<x handle>][&returnTo=<path>]`: the
 * same sign-in for a browser, then a redirect back. `as=guest` signs out
 * instead. Either way it sets a `dev_as` cookie, which tells the dev
 * server (`DEV_AS`, scripts/dev.js) not to sign the browser in again.
 * Note this GET changes state (a session, cookies) -- acceptable only
 * because the route is dev-only and never exists when deployed.
 */
import { NO_STORE } from '../http/handler.js';
import { NotFound } from '../http/errors.js';
import { jsonWithCookies, redirectWithCookies, serializeCookie } from '../http/cookies.js';
import { signInUser } from '../services/session.js';
import { safeReturnTo } from '../services/oauthState.js';

/** The roles `as` accepts; `guest` (signed out) only on the GET. */
export const DEV_ROLES = Object.freeze(['owner', 'translator', 'member', 'google', 'guest']);

/** The cookie that marks a browser as already handled by `DEV_AS`. */
export const DEV_AS_COOKIE = 'dev_as';

/** @param {Record<string, string|undefined>} [env] */
function devEnabled(env = {}) {
  // `!env.VERCEL`, not `env.VERCEL === undefined`: the e2e dev server
  // forces `VERCEL` to an *empty* string so a value from the shell can
  // never leak in (e2e/helpers.js), and Vercel itself always sets it to
  // a non-empty value (its own `1`). An empty or missing `VERCEL` means
  // "not deployed", which is when this local-only route may exist.
  return env.DEV_SIGN_IN === '1' && !env.VERCEL;
}

/**
 * The first X account with a visible credited entry (or the one with
 * `handle`): the way into a real translator's own pages without knowing a
 * numeric id.
 * @param {any} deps @param {string|undefined} handle
 */
async function translatorAccount(deps, handle) {
  const { rows } = await deps.db.query(
    `select a.external_id, a.handle from accounts a
     where a.platform = 'x' and a.external_id is not null and a.deleted_at is null and a.opted_out_at is null
       and ($1::text is null or lower(a.handle) = lower($1))
       and exists (select 1 from items i where i.credited_account_id = a.id
         and i.deleted_at is null and i.review_state = 'published')
     order by a.id limit 1`,
    [handle ?? null],
  );
  return rows[0] ?? null;
}

/**
 * Signs in as `as`: the cookie and, for a translator, the handle; `null`
 * when no translator matches; `undefined` for an unknown role.
 * @param {any} deps @param {unknown} as @param {string} [handle]
 * @returns {Promise<{ cookie: string, handle?: string }|null|undefined>}
 */
async function signInAs(deps, as, handle) {
  if (as === 'owner') return signInUser(deps, { via: 'x', subject: deps.site.ownerXUserId, handle: 'owner' });
  if (as === 'member') return signInUser(deps, { via: 'x', subject: '999999', handle: 'dev_member' });
  if (as === 'google') return signInUser(deps, { via: 'google', subject: 'dev-google', handle: null });
  if (as === 'translator') {
    const account = await translatorAccount(deps, handle);
    if (!account) return null;
    const signedIn = await signInUser(deps, { via: 'x', subject: account.external_id, handle: account.handle });
    return { cookie: signedIn.cookie, handle: account.handle };
  }
  return undefined;
}

export const route = {
  method: 'POST',
  path: '/api/auth/dev',
  cache: NO_STORE,
  /** @param {import('../http/handler.js').RouteInput} input @param {any} deps */
  run: async (input, deps) => {
    if (!devEnabled(deps.env)) throw new NotFound();
    const as = (/** @type {any} */ (input.body))?.as;
    const signedIn = await signInAs(deps, as);
    if (signedIn === undefined) return jsonWithCookies({ error: 'bad_request', message: 'unknown as' }, [], 400);
    if (signedIn === null) return jsonWithCookies({ error: 'not_found' }, [], 404);
    return jsonWithCookies(as === 'translator' ? { ok: true, handle: signedIn.handle } : { ok: true }, [signedIn.cookie]);
  },
};

export const getRoute = {
  method: 'GET',
  path: '/api/auth/dev',
  cache: NO_STORE,
  query: ['as', 'handle', 'returnTo'],
  /** @param {import('../http/handler.js').RouteInput} input @param {any} deps */
  run: async (input, deps) => {
    if (!devEnabled(deps.env)) throw new NotFound();
    const as = String(input.query.as ?? '');
    const handle = input.query.handle === undefined ? undefined : String(input.query.handle);
    const returnTo = safeReturnTo(String(input.query.returnTo ?? '/'));
    const marker = serializeCookie(DEV_AS_COOKIE, as, { maxAge: 60 * 60 * 24 * 30 });
    if (as === 'guest') return redirectWithCookies(returnTo, [marker, serializeCookie('sid', '', { maxAge: 0 })]);
    const signedIn = await signInAs(deps, as, handle);
    if (signedIn === undefined) return jsonWithCookies({ error: 'bad_request', message: `as must be one of ${DEV_ROLES.join(', ')}` }, [], 400);
    if (signedIn === null) return jsonWithCookies({ error: 'not_found', message: 'no translator with a published entry matches' }, [], 404);
    return redirectWithCookies(returnTo, [marker, signedIn.cookie]);
  },
};
