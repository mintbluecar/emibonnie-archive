// @ts-check
/**
 * The front-end's own copy of the event page's path prefix (mirrors
 * `src/pages.js`: `{ path: '/e/:date/:tag', file: 'event.html' }`). `public/js`
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

const EVENT_PATH_PATTERN = new RegExp(`^${escapeRegExp(EVENT_PATH_PREFIX)}([^/]+)/([^/]+)`);

/**
 * `addressPath` puts an event slug (`<date>/<tag>`) in a path, each part
 * encoded and the `/` kept; `slugPart` is the slug half of an address
 * tag. Both are the server's own pure rules (`src/domain/eventAddress.js`),
 * re-exported so browser code takes them from here.
 */
import { addressPath, slugPart } from '../../../src/domain/eventAddress.js';

export { addressPath, slugPart };

/** `'2026-01-01/an-event'` -> `'/e/2026-01-01/an-event'`. @param {string} slug @returns {string} */
export function eventHref(slug) {
  return `${EVENT_PATH_PREFIX}${addressPath(slug)}`;
}

/**
 * The slug (`<date>/<tag>`) out of an event page's own pathname (e.g.
 * `window.location.pathname`), or `null` if it isn't one -- a one-part
 * `/e/<x>` included (that address form is gone).
 * @param {string} pathname
 * @returns {string|null}
 */
export function slugFromEventPath(pathname) {
  const match = EVENT_PATH_PATTERN.exec(pathname);
  return match ? `${decodeURIComponent(match[1])}/${decodeURIComponent(match[2])}` : null;
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
 * The edit page's own prefix (`/edit/:kind/:sourceId`). The me page links
 * to it from Task 12 and the item page's footer from Task 13, so the
 * prefix lives here (like the others) rather than being typed into a page.
 * Task 13 added the page to `src/pages.js`; `test/core/routes.test.js`
 * pins the two together.
 */
export const EDIT_PATH_PREFIX = '/edit/';

/** `('translation', '123')` -> `'/edit/translation/123'`. @param {string} kind @param {string} sourceId @returns {string} */
export function editHref(kind, sourceId) {
  return `${EDIT_PATH_PREFIX}${encodeURIComponent(kind)}/${encodeURIComponent(sourceId)}`;
}

/**
 * The owner's import review page prefix (`/admin/imports/:id`, Plan 3) --
 * the one place a client builds that link; the me page's recent-imports
 * list uses `importHref`.
 */
export const IMPORT_PATH_PREFIX = '/admin/imports/';

/** `7` -> `'/admin/imports/7'`. @param {number} jobId @returns {string} */
export function importHref(jobId) {
  return `${IMPORT_PATH_PREFIX}${encodeURIComponent(String(jobId))}`;
}

/**
 * The owner's event admin pages (event editing): the list, one edit page
 * in three modes (edit, merge, create from a split) and an event's
 * entries. Ids are integers, so each list stays a readable `3,7`.
 */
export const ADMIN_EVENTS_PATH = '/admin/events';
const ADMIN_EVENT_EDIT_PATH = `${ADMIN_EVENTS_PATH}/edit`;
const ADMIN_EVENT_ENTRIES_PATH = `${ADMIN_EVENTS_PATH}/entries`;

/** @param {number[]} ids @returns {string} */
const idList = (ids) => ids.map((id) => String(Math.trunc(id))).join(',');

/** `3` -> `'/admin/events/edit?id=3'`. @param {number} id @returns {string} */
export function adminEventEditHref(id) {
  return `${ADMIN_EVENT_EDIT_PATH}?id=${idList([id])}`;
}

/** `[3, 7]` -> `'/admin/events/edit?merge=3,7'`. @param {number[]} ids @returns {string} */
export function adminEventMergeHref(ids) {
  return `${ADMIN_EVENT_EDIT_PATH}?merge=${idList(ids)}`;
}

/** `(5, [11, 12])` -> `'/admin/events/edit?from=5&items=11,12'`. @param {number} fromId @param {number[]} itemIds @returns {string} */
export function adminEventSplitHref(fromId, itemIds) {
  return `${ADMIN_EVENT_EDIT_PATH}?from=${idList([fromId])}&items=${idList(itemIds)}`;
}

/** `5` -> `'/admin/events/entries?id=5'`. @param {number} id @returns {string} */
export function adminEventEntriesHref(id) {
  return `${ADMIN_EVENT_ENTRIES_PATH}?id=${idList([id])}`;
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
