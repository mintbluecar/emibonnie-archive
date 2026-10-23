// @ts-check
/**
 * Small inline SVG icons that stand in for words (the owner's icon rule:
 * an icon with a tooltip, its `title` and accessible name from copy).
 * Each SVG itself is `aria-hidden`; the wrapper carries the name.
 */
import { html } from '../core/html.js';
import { t } from '../core/site.js';

/**
 * The "translate" glyph (文A style): Google's Material Icons `translate`
 * path, Apache License 2.0 (github.com/google/material-design-icons).
 */
const TRANSLATE_PATH = 'M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z';

/**
 * The translator mark before a translator's handle (Task 10c, in place
 * of the word "tl"), named by the `item.translator` copy.
 * @returns {import('../core/html.js').SafeHtml}
 */
export function translator() {
  const label = t('item.translator');
  return html`<span class="c-icon c-icon--translator" role="img" aria-label="${label}" title="${label}"><svg width="1.1em" height="1.1em" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${TRANSLATE_PATH}"></path></svg></span>`;
}
