// @ts-check
/**
 * `POST /api/auth/dev`: a local-only sign-in for e2e and dev. Works only
 * when `env.DEV_SIGN_IN === '1'` and `env.VERCEL` is unset; otherwise it
 * is a 404 (so the endpoint doesn't exist in production).
 */
import { NO_STORE } from '../http/handler.js';
import { NotFound } from '../http/errors.js';
import { jsonWithCookies } from '../http/cookies.js';
import { signInUser } from '../services/session.js';

/** @param {Record<string, string|undefined>} [env] */
function devEnabled(env = {}) {
  // `!env.VERCEL`, not `env.VERCEL === undefined`: the e2e dev server
  // forces `VERCEL` to an *empty* string so a value from the shell can
  // never leak in (e2e/helpers.js), and Vercel itself always sets it to
  // a non-empty value (its own `1`). An empty or missing `VERCEL` means
  // "not deployed", which is when this local-only route may exist.
  return env.DEV_SIGN_IN === '1' && !env.VERCEL;
}

export const route = {
  method: 'POST',
  path: '/api/auth/dev',
  cache: NO_STORE,
  /** @param {import('../http/handler.js').RouteInput} input @param {any} deps */
  run: async (input, deps) => {
    if (!devEnabled(deps.env)) throw new NotFound();
    const as = (/** @type {any} */ (input.body))?.as;
    if (as === 'owner') {
      const signedIn = await signInUser(deps, { via: 'x', subject: deps.site.ownerXUserId, handle: 'owner' });
      return jsonWithCookies({ ok: true }, [signedIn.cookie]);
    }
    if (as === 'member') {
      const signedIn = await signInUser(deps, { via: 'x', subject: '999999', handle: 'dev_member' });
      return jsonWithCookies({ ok: true }, [signedIn.cookie]);
    }
    if (as === 'google') {
      const signedIn = await signInUser(deps, { via: 'google', subject: 'dev-google', handle: null });
      return jsonWithCookies({ ok: true }, [signedIn.cookie]);
    }
    return jsonWithCookies({ error: 'bad_request', message: 'unknown as' }, [], 400);
  },
};
