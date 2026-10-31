// @ts-check
/**
 * `GET /api/auth/google/start` and `/callback`: sign in with Google (OIDC,
 * scope `openid` only). Mirrors the X flow: the start route rate-limits by
 * IP, stores the PKCE verifier and a `nonce` in a signed state cookie and
 * redirects to Google; the callback exchanges the code, validates the
 * `id_token` (iss/aud/exp/nonce) and signs the user in.
 */
import { createHash, randomBytes } from 'node:crypto';
import { NO_STORE } from '../http/handler.js';
import { BadRequest } from '../http/errors.js';
import { redirectWithCookies, jsonWithCookies } from '../http/cookies.js';
import { defineRoute } from '../http/defineRoute.js';
import { signInUser } from '../services/session.js';
import { issueState, takeState, clearStateCookie } from '../services/oauthState.js';
import { authorizeUrl, exchangeCode } from '../services/googleSignIn.js';

/** @param {import('../http/handler.js').RouteInput} input */
const redirectUriFor = (input) => `${input.origin}/api/auth/google/callback`;

export const route = defineRoute({
  method: 'GET',
  path: '/api/auth/google/start',
  auth: 'none',
  limit: 'signIn',
  cache: NO_STORE,
  query: ['return'],
  run: async (input, deps) => {
    const verifier = randomBytes(32).toString('base64url');
    const nonce = randomBytes(24).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const { state, cookie } = issueState(deps, { verifier, returnTo: String(input.query.return ?? '/me'), nonce });
    const url = authorizeUrl({
      clientId: deps.env.GOOGLE_CLIENT_ID ?? '', redirectUri: redirectUriFor(input), state, nonce, challenge,
    });
    return redirectWithCookies(url, [cookie]);
  },
});

export const callbackRoute = {
  method: 'GET',
  path: '/api/auth/google/callback',
  cache: NO_STORE,
  query: ['code', 'state', 'error'],
  /** @param {import('../http/handler.js').RouteInput} input @param {import('../http/deps.js').Deps} deps */
  run: async (input, deps) => {
    let taken;
    try {
      taken = takeState(deps, input, String(input.query.state ?? ''));
    } catch (err) {
      if (err instanceof BadRequest) return jsonWithCookies({ error: 'bad_request', message: 'bad oauth state' }, [clearStateCookie()], 400);
      throw err;
    }
    const { verifier, returnTo, nonce } = taken;
    if (input.query.error !== undefined || verifier === null || nonce === null) {
      return redirectWithCookies('/me?signin=failed', [clearStateCookie()]);
    }
    try {
      const { sub } = await exchangeCode(deps, { code: String(input.query.code ?? ''), verifier, redirectUri: redirectUriFor(input), nonce });
      const signedIn = await signInUser(deps, { via: 'google', subject: sub, handle: null });
      return redirectWithCookies(returnTo, [clearStateCookie(), ...signedIn.cookies]);
    } catch {
      return redirectWithCookies('/me?signin=failed', [clearStateCookie()]);
    }
  },
};
