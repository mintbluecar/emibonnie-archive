// @ts-check
/**
 * The front-end's own copy of the event page's path prefix (mirrors
 * `src/pages.js`: `{ path: '/e/:slug', file: 'event.html' }`). `public/js`
 * can't import `src/**` (eslint layer rule: it's server-only code with
 * Node built-ins), so this file is the *one* place any client code reads
 * or matches the event path -- every other page/component imports
 * `eventHref`/`slugFromEventPath` from here rather than typing `'/e/'`
 * itself (review round 2: `eventCard.js`, `event.js`'s own
 * `slugFromPath`, and this file's own earlier `eventUrl` each hardcoded
 * it once; all three now go through this module, and nothing else does).
 * `test/core/routes.test.js` imports `src/pages.js` too (tests may cross
 * layers) and asserts `EVENT_PATH_PREFIX` matches the real route, so the
 * two can't silently drift apart.
 *
 * The item page has no equivalent hand-typed prefix anywhere in
 * `public/js`: `public/js/pages/item.js`'s `kindFromPath` already reads
 * each kind's `urlPrefix` off the generated `KIND_UI` registry (itself
 * built from the server-side kinds registry by `scripts/build.js`), and
 * every item link in the UI comes from a server-provided `url` field
 * (`ItemLink.url`, `Preview.url`, …), never built from a prefix client-side.
 */

export const EVENT_PATH_PREFIX = '/e/';

/** @param {string} value @returns {string} */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const EVENT_PATH_PATTERN = new RegExp(`^${escapeRegExp(EVENT_PATH_PREFIX)}([^/]+)`);

/** `'an-event-2026-01-01'` -> `'/e/an-event-2026-01-01'`. @param {string} slug @returns {string} */
export function eventHref(slug) {
  return `${EVENT_PATH_PREFIX}${encodeURIComponent(slug)}`;
}

/**
 * The slug out of an event page's own pathname (e.g.
 * `window.location.pathname`), or `null` if it isn't one.
 * @param {string} pathname
 * @returns {string|null}
 */
export function slugFromEventPath(pathname) {
  const match = EVENT_PATH_PATTERN.exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

/** `src/pages.js`'s `/p/:ig` route prefix (see `EVENT_PATH_PREFIX`'s own doc comment -- same reasoning, same pin in `test/core/routes.test.js`). */
export const PERSON_PATH_PREFIX = '/p/';
const PERSON_PATH_PATTERN = new RegExp(`^${escapeRegExp(PERSON_PATH_PREFIX)}([^/]+)`);

/** `src/pages.js`'s `/tl/:handle` route prefix (the translator/"account" page). */
export const ACCOUNT_PATH_PREFIX = '/tl/';
const ACCOUNT_PATH_PATTERN = new RegExp(`^${escapeRegExp(ACCOUNT_PATH_PREFIX)}([^/]+)`);

/** `'someone'` -> `'/p/someone'`. @param {string} ig @returns {string} */
export function personHref(ig) {
  return `${PERSON_PATH_PREFIX}${encodeURIComponent(ig)}`;
}

/** The IG handle out of a person page's own pathname, or `null` if it isn't one. @param {string} pathname @returns {string|null} */
export function igFromPersonPath(pathname) {
  const match = PERSON_PATH_PATTERN.exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

/** `'tl_alpha'` -> `'/tl/tl_alpha'`. @param {string} handle @returns {string} */
export function accountHref(handle) {
  return `${ACCOUNT_PATH_PREFIX}${encodeURIComponent(handle)}`;
}

/**
 * The edit page's own prefix (`/edit/:kind/:sourceId`). Plan 2a Task 14
 * adds the page to `src/pages.js`; the me page links to it from Task 12,
 * so the prefix lives here (like the others) rather than being typed into
 * the page. `EDIT_PATH_PREFIX` can't be pinned to `src/pages.js` until
 * that route exists.
 */
export const EDIT_PATH_PREFIX = '/edit/';

/** `('translation', '123')` -> `'/edit/translation/123'`. @param {string} kind @param {string} sourceId @returns {string} */
export function editHref(kind, sourceId) {
  return `${EDIT_PATH_PREFIX}${encodeURIComponent(kind)}/${encodeURIComponent(sourceId)}`;
}

/** The translator handle out of an account page's own pathname, or `null` if it isn't one. @param {string} pathname @returns {string|null} */
export function accountFromAccountPath(pathname) {
  const match = ACCOUNT_PATH_PATTERN.exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

/*
 * Every other page path the front end links to (Task 10b: links had
 * drifted to `/about/`, `/privacy/`, `/takedown/` -- trailing slashes no
 * route in `src/pages.js` has, so they 404'd). Each mirrors a
 * `src/pages.js` entry exactly, with no trailing slash, and
 * `test/core/routes.test.js` pins each one to it, so no page or
 * component types a page path itself. `/add` and `/me` were reserved
 * placeholders in Plan 1b; Plan 2a built them (Task 12 for `/me`,
 * Task 13 for the add form). There is no search page (Task 10d): search
 * happens in place, and `/search` only redirects home.
 */
export const HOME_PATH = '/';
export const ABOUT_PATH = '/about';
export const PRIVACY_PATH = '/privacy';
export const TAKEDOWN_PATH = '/takedown';
export const ADD_PATH = '/add';
export const ME_PATH = '/me';

/**
 * `path` with an optional query string (no leading `?`) -- how an
 * in-place search writes its state onto the page's own URL.
 * `withQuery('/e/x', 'q=hi')` -> `'/e/x?q=hi'`; an empty query leaves `path` bare.
 * @param {string} path @param {string|URLSearchParams} [query]
 * @returns {string}
 */
export function withQuery(path, query = '') {
  const qs = String(query);
  return qs ? `${path}?${qs}` : path;
}
