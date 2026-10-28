// @ts-check
/**
 * `GET /api/auth/x/start` and `/api/auth/x/callback`: sign in with X
 * (OAuth 2.0 Authorization Code with PKCE, scopes `users.read tweet.read`).
 * The start route rate-limits by IP, then stores the PKCE verifier and the
 * return path in a signed state cookie and redirects to X. The callback
 * exchanges the code, reads `/2/users/me`, signs the user in, and redirects
 * back with the session cookie -- or to `/me?signin=failed` on any failure
 * (recording `xSignInFailedAt` for the owner), except a bad state, which is
 * a 400.
 */
import { createHash, randomBytes } from 'node:crypto';
import { NO_STORE } from '../http/handler.js';
import { BadRequest } from '../http/errors.js';
import { redirectWithCookies, jsonWithCookies } from '../http/cookies.js';
import { limit } from '../services/limits.js';
import { signInUser, recordXSignInFailure } from '../services/session.js';
import { issueState, takeState, clearStateCookie } from '../services/oauthState.js';
import { authorizeUrl, exchangeCode, fetchMe } from '../services/xSignIn.js';

/** @param {import('../http/handler.js').RouteInput} input */
const redirectUriFor = (input) => `${input.origin}/api/auth/x/callback`;

/** Record the failure for the owner and send the user back to /me. @param {any} deps */
async function signInFailed(deps) {
  await recordXSignInFailure(deps);
  return redirectWithCookies('/me?signin=failed', [clearStateCookie()]);
}

export const route = {
  method: 'GET',
  path: '/api/auth/x/start',
  cache: NO_STORE,
  query: ['return'],
  /** @param {import('../http/handler.js').RouteInput} input @param {any} deps */
  run: async (input, deps) => {
    await limit(deps, 'signIn', input.ip);
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const { state, cookie } = issueState(deps.env, { verifier, returnTo: String(input.query.return ?? '/me') });
    const url = authorizeUrl({
      clientId: deps.env.X_CLIENT_ID ?? '', redirectUri: redirectUriFor(input), state, challenge,
    });
    return redirectWithCookies(url, [cookie]);
  },
};

export const callbackRoute = {
  method: 'GET',
  path: '/api/auth/x/callback',
  cache: NO_STORE,
  query: ['code', 'state', 'error'],
  /** @param {import('../http/handler.js').RouteInput} input @param {any} deps */
  run: async (input, deps) => {
    let taken;
    try {
      taken = takeState(deps.env, input, String(input.query.state ?? ''));
    } catch (err) {
      if (err instanceof BadRequest) return jsonWithCookies({ error: 'bad_request', message: 'bad oauth state' }, [clearStateCookie()], 400);
      throw err;
    }
    const { verifier, returnTo } = taken;
    if (input.query.error !== undefined) return redirectWithCookies('/me?signin=failed', [clearStateCookie()]);
    if (verifier === null) return redirectWithCookies('/me?signin=failed', [clearStateCookie()]);
    try {
      const token = await exchangeCode(deps, { code: String(input.query.code ?? ''), verifier, redirectUri: redirectUriFor(input) });
      const me = await fetchMe(deps, token);
      const signedIn = await signInUser(deps, { via: 'x', subject: me.id, handle: me.username });
      return redirectWithCookies(returnTo, [clearStateCookie(), signedIn.cookie]);
    } catch {
      return signInFailed(deps);
    }
  },
};
