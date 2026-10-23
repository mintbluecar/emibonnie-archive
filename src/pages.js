// @ts-check
/**
 * The single source of page routes for the build (Plan 1b, "Additional
 * constraints", and Task 3's rulings). Each entry names a page's public
 * path, its HTML file under `public/` (`null` for one a later task still
 * has to add -- listed now purely to reserve its prefix), and, for a page
 * whose content depends on which item or event it's showing, the name of
 * the link-preview meta renderer (`src/routes/meta.js`) that serves it.
 *
 * `scripts/build.js` turns these into `vercel.json`'s rewrites: a page
 * with `meta` goes to the one function (`/api`, which matches the page
 * path itself through `src/routes/index.js`'s meta routes), any other
 * page with a `file` to that file. `src/kinds/defineKind.js` derives its
 * reserved URL-prefix list from here (plus `/api/`), so a kind's
 * `urlPrefix` can never collide with a page's path, even one this plan
 * hasn't built yet. A kind's item page (`<urlPrefix>:id`) always has meta.
 *
 * @typedef {{ path: string, file: string|null, meta?: 'event' }} PageRoute
 */

/** @type {PageRoute[]} */
export const pages = [
  { path: '/', file: 'index.html' },
  { path: '/e/:slug', file: 'event.html', meta: 'event' },
  { path: '/search', file: 'search.html' },
  // Task 6: no meta renderer for these yet (src/routes/meta.js's PAGE_META
  // has only `event`), so these two rewrite straight to their file, same
  // as a static page. If a later task adds person/account link-preview
  // meta, add its renderer there and give these a `meta:` name then.
  { path: '/p/:ig', file: 'person.html' },
  { path: '/tl/:handle', file: 'account.html' },
  { path: '/about', file: 'about.html' },
  { path: '/privacy', file: 'privacy.html' },
  { path: '/takedown', file: 'takedown.html' },
  // scaffold:pages (`npm run new page <name>` adds its entry above this line)
  // Not yet built (later Plan 1b tasks); listed so no kind can claim these prefixes.
  { path: '/add', file: null },
  { path: '/me', file: null },
];
