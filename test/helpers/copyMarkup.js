// @ts-check
/**
 * Matching the site's own copy inside rendered markup. `html`
 * (public/js/core/html.js) escapes every interpolated value, so copy with
 * an apostrophe or a quote reaches the DOM as `&#39;` / `&quot;`. A
 * component test that asserts on a copy *value* has to compare against
 * that same escaped text -- otherwise it fails on punctuation and says
 * nothing about the component. `escape()` mirrors the tag's table; the
 * two agree because both are pinned to the same five characters.
 */

/** The same entity table `html` uses, keyed by the raw character. */
const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/**
 * `text` as `html` would put it in markup.
 * @param {string} text
 * @returns {string}
 */
export function escape(text) {
  return text.replace(/[&<>"']/g, (ch) => ENTITIES[/** @type {keyof typeof ENTITIES} */ (ch)]);
}

/**
 * A regex source string matching `text` exactly as it appears in markup:
 * both the HTML entities and the regex metacharacters are escaped. Use it
 * when the copy sits inside a larger pattern (`>…<`, `role="alert"…`);
 * use `copyRe` for a bare copy value.
 * @param {string} text
 * @returns {string}
 */
export function pattern(text) {
  return escape(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A RegExp matching `text` as rendered markup.
 * @param {string} text
 * @returns {RegExp}
 */
export function copyRe(text) {
  return new RegExp(pattern(text));
}
