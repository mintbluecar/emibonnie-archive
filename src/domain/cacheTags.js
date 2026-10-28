// @ts-check
/**
 * The cache-tag vocabulary (Plan 2b). A public response carries the tags
 * of what it shows, and a purge names the same strings: one coarse tag
 * for home and one for search, and one per item, event, person and
 * translator page. Pure: no database, no framework, so routes, the meta
 * renderer and the purge service all build identical strings.
 *
 * Vercel's rules: comma-separated, ≤128 tags per response, ≤256 bytes
 * each, and no commas in a tag (https://vercel.com/docs/caching/cdn-cache/purge,
 * read 2026-10-28).
 */

/** Every visible item on home. @type {string} */
export const HOME_TAG = 'home';
/** Every search response. @type {string} */
export const SEARCH_TAG = 'search';

/** @param {number} id @returns {string} */
export function itemTag(id) {
  return `item:${id}`;
}

/** @param {string} slug @returns {string} */
export function eventTag(slug) {
  return `event:${slug}`;
}

/**
 * People are tagged by their numeric id, not their handle: a person's IG
 * handle can change, and an id can't, so a purge after a rename still
 * reaches the page's cached copies.
 * @param {number} id @returns {string}
 */
export function personTag(id) {
  return `person:${id}`;
}

/** @param {string} handle @returns {string} */
export function accountTag(handle) {
  return `account:${String(handle).toLowerCase()}`;
}
