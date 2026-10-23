// @ts-check
/**
 * Thai-script detection for the a11y `lang` rule (see docs/.../1b plan,
 * "Additional constraints" → Accessibility: "Translation text carries
 * `lang="<site.sourceLanguage>"` on Thai-script spans, as detected by
 * `\p{Script=Thai}`"). Written once here so every place that renders
 * translated text -- public/js/components/bubbles.js and
 * public/js/kinds/translation/detail.js -- shares the same splitting and
 * escaping behaviour.
 */
import { html } from './html.js';

const THAI_RUN = /[\p{Script=Thai}]+/gu;

/**
 * Splits `text` into an array of plain strings and `lang`-tagged `SafeHtml`
 * spans for its Thai-script runs. `html\`…\`` escapes the plain parts and
 * the already-safe spans alike, so a hostile value (e.g. `<script>`) is
 * never unescaped by this split.
 * @param {string} text
 * @param {string} lang the value to put in `lang="…"` (`site.sourceLanguage`)
 * @returns {(string|import('./html.js').SafeHtml)[]}
 */
export function thaiSpans(text, lang) {
  /** @type {(string|import('./html.js').SafeHtml)[]} */
  const parts = [];
  let last = 0;
  for (const match of text.matchAll(THAI_RUN)) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push(html`<span lang="${lang}">${match[0]}</span>`);
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
