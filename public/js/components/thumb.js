// @ts-check
/**
 * A preview or result card's small picture (`ThumbVM`, Task 10c): a
 * clip's poster with a ▶ over it, or a photo post's first picture. The
 * `width`/`height` attributes give the image its aspect ratio (no inline
 * style, CSP-safe); CSS fixes its height and caps its width. Lazy, async
 * decoding, alt text from copy (`item.thumbClip` / `item.thumbPhoto`).
 */
import { html } from '../core/html.js';
import { t } from '../core/site.js';

/**
 * @param {import('../../../src/http/contracts.js').ThumbVM|null|undefined} thumb
 * @returns {import('../core/html.js').SafeHtml}
 */
export function render(thumb) {
  if (!thumb) return html``;
  const size = thumb.width > 0 && thumb.height > 0 ? html` width="${thumb.width}" height="${thumb.height}"` : '';
  return html`
    <span class="c-thumb${thumb.video ? ' c-thumb--video' : ''}">
      <img class="c-thumb__img" src="${thumb.url}" alt="${t(thumb.video ? 'item.thumbClip' : 'item.thumbPhoto')}"${size} loading="lazy" decoding="async">
      ${thumb.video ? html`<span class="c-thumb__play" aria-hidden="true">▶</span>` : ''}
    </span>
  `;
}
