// @ts-check
/**
 * The translation kind's X profile link: shared by the kind definition
 * (`index.js`'s `profileUrl`, used by the translator/account page) and
 * the presenter (the preview/detail "translated by" credit link).
 */

/** @param {string} handle @returns {string} */
export function profileUrl(handle) {
  return `https://x.com/${encodeURIComponent(handle)}`;
}
