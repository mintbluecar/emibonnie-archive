// @ts-check
/**
 * Google OIDC sign-in (Plan 2a Task 6). Scope is `openid` only, so Google
 * returns no name or email -- just a stable `sub`. The `id_token` from the
 * token endpoint is validated for `iss`, `aud`, `exp` and `nonce`; it comes
 * directly from Google over TLS, so it is used without signature
 * verification (OpenID Connect Core, token endpoint over TLS).
 */

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/**
 * @param {{ clientId: string, redirectUri: string, state: string, nonce: string, challenge: string }} input
 * @returns {string}
 */
export function authorizeUrl({ clientId, redirectUri, state, nonce, challenge }) {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', 'openid');
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', nonce);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

/** @param {unknown} token */
function parseJwtPayload(token) {
  const parts = String(token).split('.');
  if (parts.length !== 3) throw new Error('google id_token is not a JWT');
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
}

/** @param {string} idToken @param {string} clientId @param {string} nonce */
function requireValidSub(idToken, clientId, nonce) {
  const payload = parseJwtPayload(idToken);
  if (payload.iss !== 'https://accounts.google.com') throw new Error('google id_token issuer mismatch');
  if (payload.aud !== clientId) throw new Error('google id_token audience mismatch');
  if (typeof payload.exp !== 'number' || payload.exp < Date.now() / 1000) throw new Error('google id_token expired');
  if (payload.nonce !== nonce) throw new Error('google id_token nonce mismatch');
  if (typeof payload.sub !== 'string' || payload.sub === '') throw new Error('google id_token missing sub');
  return payload.sub;
}

/**
 * Exchange the code for an `id_token` and return the validated OIDC `sub`.
 * @param {{ env: Record<string, string|undefined>, fetchImpl: typeof fetch }} deps
 * @param {{ code: string, verifier: string, redirectUri: string, nonce: string }} input
 * @returns {Promise<{ sub: string }>}
 */
export async function exchangeCode(deps, { code, verifier, redirectUri, nonce }) {
  const form = new URLSearchParams({
    code, grant_type: 'authorization_code', client_id: deps.env.GOOGLE_CLIENT_ID ?? '',
    redirect_uri: redirectUri, code_verifier: verifier,
  });
  const res = await deps.fetchImpl(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form });
  if (!res.ok) throw new Error(`google token exchange failed: ${res.status}`);
  const json = await res.json();
  const idToken = json.id_token;
  if (typeof idToken !== 'string') throw new Error('google token exchange returned no id_token');
  return { sub: requireValidSub(idToken, deps.env.GOOGLE_CLIENT_ID ?? '', nonce) };
}
