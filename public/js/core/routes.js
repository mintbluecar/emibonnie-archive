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

/** The translator handle out of an account page's own pathname, or `null` if it isn't one. @param {string} pathname @returns {string|null} */
export function accountFromAccountPath(pathname) {
  const match = ACCOUNT_PATH_PATTERN.exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
}
