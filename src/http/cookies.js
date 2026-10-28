// @ts-check
/**
 * Cookie Response helpers for the web sign-in flow. `parseCookies` and
 * `serializeCookie` are pure and live in src/domain/cookies.js (services
 * need them too); this module adds the http-layer Response builders that
 * set cookies.
 */
export { parseCookies, serializeCookie } from '../domain/cookies.js';

/**
 * A JSON response that also sets cookies (`Set-Cookie`).
 * @param {unknown} body
 * @param {string[]} cookies
 * @param {number} [status]
 * @returns {Response}
 */
export function jsonWithCookies(body, cookies, status = 200) {
  const headers = new Headers();
  for (const cookie of cookies) headers.append('set-cookie', cookie);
  return Response.json(body, { status, headers });
}

/**
 * A 302 redirect that also sets cookies. The handler's `toResponse` keeps
 * the route's cache header on it.
 * @param {string} location
 * @param {string[]} cookies
 * @returns {Response}
 */
export function redirectWithCookies(location, cookies) {
  const headers = new Headers();
  for (const cookie of cookies) headers.append('set-cookie', cookie);
  headers.set('location', location);
  return new Response(null, { status: 302, headers });
}
