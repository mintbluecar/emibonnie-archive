// @ts-check
/**
 * The single source of page routes for the build (Plan 1b, "Additional
 * constraints", and Task 3's rulings). Each entry names a page's public
 * path, its HTML file under `public/` (`null` for one a later task still
 * has to add -- listed now purely to reserve its prefix), and, for a page
 * whose content depends on which item or event it's showing, the meta
 * route (`src/routes/meta.js`) it rewrites to for link previews.
 *
 * `scripts/build.js` turns these into `vercel.json`'s rewrites (a page
 * already covered by the route table's own rewrites, e.g. the event meta
 * route, is left out there rather than listed twice). `src/kinds/defineKind.js`
 * derives its reserved URL-prefix list from here (plus `/api/`), so a
 * kind's `urlPrefix` can never collide with a page's path, even one this
 * plan hasn't built yet.
 *
 * @typedef {{ path: string, file: string|null, meta?: string }} PageRoute
 */

/** @type {PageRoute[]} */
export const pages = [
  { path: '/', file: 'index.html' },
  { path: '/e/:slug', file: 'event.html', meta: '/meta/e/:slug' },
  { path: '/search', file: 'search.html' },
  // Task 6: no meta route for these yet. src/routes/meta.js only defines
  // eventMeta/itemMeta, and src/routes/index.js's pageMetaRoutes() only
  // wires those two -- there's no /api/meta/p/:ig or /api/meta/tl/:handle
  // to point a `meta:` entry at, so these two rewrite straight to their
  // file instead, same as a static page. If a later task adds person/
  // account link-preview meta, give these a `meta:` string then.
  { path: '/p/:ig', file: 'person.html' },
  { path: '/tl/:handle', file: 'account.html' },
  { path: '/about', file: 'about.html' },
  { path: '/privacy', file: 'privacy.html' },
  { path: '/takedown', file: 'takedown.html' },
  // Not yet built (later Plan 1b tasks); listed so no kind can claim these prefixes.
  { path: '/add', file: null },
  { path: '/me', file: null },
];
