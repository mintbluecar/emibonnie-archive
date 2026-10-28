// @ts-check
/**
 * X OAuth 2.0 (Authorization Code with PKCE) and the `/2/users/me` call
 * (Plan 2a Task 5). Scopes are exactly `users.read tweet.read`; no email
 * or profile image is requested or stored. Endpoint URLs and parameters
 * follow X's current OAuth 2.0 docs.
 */

const AUTHORIZE_URL = 'https://x.com/i/oauth2/authorize';
const TOKEN_URL = 'https://api.x.com/2/oauth2/token';
const ME_URL = 'https://api.x.com/2/users/me';

/**
 * The authorization URL to redirect the browser to.
 * @param {{ clientId: string, redirectUri: string, state: string, challenge: string }} input
 * @returns {string}
 */
export function authorizeUrl({ clientId, redirectUri, state, challenge }) {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', 'users.read tweet.read');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

/** @param {string} id @param {string} secret */
const basic = (id, secret) => `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`;

/**
 * Exchange the authorization `code` for an access token.
 * @param {{ env: Record<string, string|undefined>, fetchImpl: typeof fetch }} deps
 * @param {{ code: string, verifier: string, redirectUri: string }} input
 * @returns {Promise<string>} the access token
 */
export async function exchangeCode(deps, { code, verifier, redirectUri }) {
  const clientId = deps.env.X_CLIENT_ID ?? '';
  const form = new URLSearchParams({
    code, grant_type: 'authorization_code', client_id: clientId,
    redirect_uri: redirectUri, code_verifier: verifier,
  });
  const res = await deps.fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { authorization: basic(clientId, deps.env.X_CLIENT_SECRET ?? ''), 'content-type': 'application/x-www-form-urlencoded' },
    body: form,
  });
  if (!res.ok) throw new Error(`x token exchange failed: ${res.status}`);
  const json = await res.json();
  if (typeof json.access_token !== 'string') throw new Error('x token exchange returned no access_token');
  return json.access_token;
}

/**
 * The signed-in X user's numeric id and username. The id must be numeric.
 * @param {{ env: Record<string, string|undefined>, fetchImpl: typeof fetch }} deps
 * @param {string} token
 * @returns {Promise<{ id: string, username: string }>}
 */
export async function fetchMe(deps, token) {
  const res = await deps.fetchImpl(ME_URL, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`x users/me failed: ${res.status}`);
  const json = await res.json();
  const id = String(json.data?.id ?? '');
  if (!/^\d+$/.test(id)) throw new Error('x users/me returned a non-numeric id');
  return { id, username: String(json.data?.username ?? '') };
}
