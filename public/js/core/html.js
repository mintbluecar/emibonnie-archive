// @ts-check
/**
 * An auto-escaping HTML template tag. `html` escapes every interpolated
 * value unless it is already `SafeHtml` (produced by `html` itself or
 * `raw()`), so page and component code can never forget to escape user
 * text. See docs/superpowers/plans/2026-10-21-1b-pages-and-launch.md,
 * "Additional constraints" → Escaping. `raw()` is only ever for markup
 * that already came out of another component's `render()`.
 */

const ESCAPE_CHARS = /[&<>"']/g;
/** @type {Record<string, string>} */
const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export class SafeHtml {
  /** @param {string} markup */
  constructor(markup) {
    this.markup = markup;
  }
  /** @returns {string} */
  toString() {
    return this.markup;
  }
}

/**
 * Wraps markup that's already safe to insert verbatim -- output from
 * another component's `render()`. Never pass user-controlled text here.
 * @param {string} markup
 * @returns {SafeHtml}
 */
export function raw(markup) {
  return new SafeHtml(markup);
}

/** @param {string} text @returns {string} */
function escape(text) {
  return text.replace(ESCAPE_CHARS, (ch) => ENTITIES[ch]);
}

/**
 * Renders one interpolated value: `null`/`undefined`/`false` vanish,
 * arrays render part by part (each part following these same rules),
 * `SafeHtml` passes through unescaped, everything else is stringified
 * and escaped.
 * @param {unknown} value
 * @returns {string}
 */
function renderValue(value) {
  if (value === null || value === undefined || value === false) return '';
  if (value instanceof SafeHtml) return value.toString();
  if (Array.isArray(value)) return value.map(renderValue).join('');
  return escape(String(value));
}

/**
 * Tagged template: `` html`<p>${name}</p>` ``. Every interpolation is
 * escaped unless it's `SafeHtml` (from a nested `html` call or `raw()`).
 * @param {TemplateStringsArray} strings
 * @param {...unknown} values
 * @returns {SafeHtml}
 */
export function html(strings, ...values) {
  let markup = strings[0];
  for (let i = 0; i < values.length; i++) markup += renderValue(values[i]) + strings[i + 1];
  return new SafeHtml(markup);
}
