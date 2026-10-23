// @ts-check

/**
 * @typedef {{ method: string, path: string }} RouteLike
 * @typedef {{ route: RouteLike, params: Record<string, string> }} RouteMatch
 */

/**
 * Splits a route pattern or a pathname into its non-empty segments.
 * @param {string} path
 * @returns {string[]}
 */
function segmentsOf(path) {
  return path.split('/').filter((segment) => segment.length > 0);
}

/**
 * Finds the route whose method and path pattern match a request. Path
 * patterns use `:param` segments (e.g. `/api/event/:slug`). Shared by the
 * Vercel function (`api/index.js`) and the dev server.
 * @template {RouteLike} T
 * @param {T[]} routes
 * @param {string} method
 * @param {string} pathname
 * @returns {{ route: T, params: Record<string, string> } | null}
 */
export function matchRoute(routes, method, pathname) {
  const requestSegments = segmentsOf(pathname);
  for (const route of routes) {
    if (route.method !== method) continue;

    const routeSegments = segmentsOf(route.path);
    if (routeSegments.length !== requestSegments.length) continue;

    /** @type {Record<string, string>} */
    const params = {};
    let matched = true;
    for (let i = 0; i < routeSegments.length; i += 1) {
      const routeSegment = routeSegments[i];
      const requestSegment = requestSegments[i];
      if (routeSegment.startsWith(':')) {
        params[routeSegment.slice(1)] = decodeURIComponent(requestSegment);
      } else if (routeSegment !== requestSegment) {
        matched = false;
        break;
      }
    }

    if (matched) return { route, params };
  }
  return null;
}

/**
 * The `vercel.json` rewrite `source` for a route or page pattern, with
 * every `:param` segment made an unnamed group (`/e/:slug` -> `/e/(.*)`).
 * A named param in a rewrite `source` is added to the destination's
 * query string: Vercel's rewrites doc says so ("This converts a request
 * like /resize/800/600 to /api/sharp?width=800&height=600",
 * https://vercel.com/docs/routing/rewrites), and a scratch-project echo
 * function confirmed it on 2026-10-23 (`/t/:id` arrived as `/t/123?id=123`,
 * while `/api/(.*)` added nothing). The handler refuses unknown query
 * params, so every generated source is unnamed. The function still sees
 * the original URL, which is why `matchRoute` matches page paths.
 * @param {string} pattern
 * @returns {string}
 */
export function unnamedSource(pattern) {
  return pattern.replace(/\/:[A-Za-z_]\w*/g, '/(.*)');
}
