// @ts-check
/**
 * The Origin check for writes (every non-GET route): the browser's
 * `Origin` header must equal the request URL's own origin, or be listed
 * in the `ALLOWED_ORIGINS` env (comma-separated, exact origins). A
 * missing `Origin` (or the opaque `null`) is refused: every browser sends
 * one on a cross-site or same-site POST.
 */

/**
 * @param {Request} request
 * @param {Record<string, string|undefined>} env
 * @returns {boolean}
 */
export function originAllowed(request, env) {
  const origin = request.headers.get('origin');
  if (!origin || origin === 'null') return false;
  if (origin === new URL(request.url).origin) return true;
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  return allowed.includes(origin);
}
