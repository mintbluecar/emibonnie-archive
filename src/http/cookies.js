// @ts-check
/**
 * Cookie parsing, serialising and Response helpers for the web sign-in
 * flow. Session cookies are always `HttpOnly; Secure; SameSite=Lax; Path=/`
 * (Global Constraints: sessions), so `serializeCookie` bakes those in and
 * callers only choose the value and its `maxAge`.
 */

/**
 * Parse a `Cookie` request header into a prototype-less name/value map.
 * Values are percent-decoded (RFC 6265); a malformed or empty header gives `{}`.
 * @param {string|null} header
 * @returns {Record<string, string>}
 */
export function parseCookies(header) {
  /** @type {Record<string, string>} */
  const out = Object.create(null);
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    const raw = part.slice(eq + 1).trim();
    if (name === '') continue;
    try {
      out[name] = decodeURIComponent(raw);
    } catch {
      out[name] = raw;
    }
  }
  return out;
}

/**
 * Serialise a Set-Cookie value for a session cookie. Adds `maxAge` and the
 * fixed `HttpOnly; Secure; SameSite=Lax; Path=/`. `maxAge: 0` clears it
 * (the browser deletes the cookie).
 * @param {string} name
 * @param {string} value
 * @param {{ maxAge: number }} options
 * @returns {string}
 */
export function serializeCookie(name, value, { maxAge }) {
  return `${name}=${value}; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax; Path=/`;
}

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
