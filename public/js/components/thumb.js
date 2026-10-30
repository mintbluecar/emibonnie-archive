// @ts-check
/**
 * A preview or result card's small picture (`ThumbVM`, Task 10c): a
 * clip's poster with a ▶ over it, or a photo post's first picture. The
 * `width`/`height` attributes give the image its aspect ratio (no inline
 * style, CSP-safe); CSS fixes its height and caps its width. Async
 * decoding, alt text from copy (`item.thumbClip` / `item.thumbPhoto`).
 * Lazy, except the first few cards of a list (Task 11), which pass
 * `eager`: those are on the first screen, so they load at once, at high
 * priority, rather than waiting for layout to find them in view.
 */
import { html } from '../core/html.js';
import { t } from '../core/site.js';

/** How many cards at the top of a list load their picture eagerly (Task 11). */
export const EAGER_COUNT = 4;

/**
 * @param {import('../../../src/http/contracts.js').ThumbVM|null|undefined} thumb
 * @param {{ eager?: boolean }} [options]
 * @returns {import('../core/html.js').SafeHtml}
 */
export function render(thumb, { eager = false } = {}) {
  if (!thumb) return html``;
  const size = thumb.width > 0 && thumb.height > 0 ? html` width="${thumb.width}" height="${thumb.height}"` : '';
  const loading = eager ? html`loading="eager" fetchpriority="high"` : html`loading="lazy"`;
  return html`
    <span class="c-thumb${thumb.video ? ' c-thumb--video' : ''}">
      <img class="c-thumb__img" src="${thumb.url}" alt="${t(thumb.video ? 'item.thumbClip' : 'item.thumbPhoto')}"${size} ${loading} decoding="async">
      ${thumb.video ? html`<span class="c-thumb__play" aria-hidden="true">▶</span>` : ''}
    </span>
  `;
}
