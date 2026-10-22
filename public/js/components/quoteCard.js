// @ts-check
/**
 * The quote card (task-4 brief): author name, handle, date and the
 * original text (Thai spans get `lang`, same splitting as
 * `public/js/components/bubbles.js`). When `inner` is present, the quoted
 * post's pictures or clip render inside the card, using the same capped
 * carousel or video player as the translator's own media.
 */
import { html } from '../core/html.js';
import { site } from '../core/site.js';
import { dayLabel } from '../core/format.js';
import { thaiSpans } from '../core/thai.js';
import * as videoPlayer from './videoPlayer.js';
import * as carousel from './carousel.js';

/**
 * @param {import('../../../src/http/contracts.js').QuoteVM} quote
 * @returns {import('../core/html.js').SafeHtml}
 */
function authorLine(quote) {
  if (!quote.authorName && !quote.authorHandle) return html``;
  return html`
    <p class="c-quote__author">
      ${quote.authorName ?? ''}${quote.authorHandle ? html` @${quote.authorHandle}` : ''}
      ${quote.postedAt ? html` · ${dayLabel(quote.postedAt.slice(0, 10))}` : ''}
    </p>
  `;
}

/**
 * @param {import('../../../src/http/contracts.js').VideoVM|import('../../../src/http/contracts.js').ImagesVM} inner
 * @returns {import('../core/html.js').SafeHtml}
 */
function innerMedia(inner) {
  if (inner.type === 'video') return videoPlayer.render(inner);
  return carousel.render(inner);
}

/**
 * @param {import('../../../src/http/contracts.js').QuoteVM} quote
 * @returns {import('../core/html.js').SafeHtml}
 */
export function render(quote) {
  return html`
    <div class="c-quote">
      ${authorLine(quote)}
      <p class="c-quote__text">${thaiSpans(quote.text, site.sourceLanguage)}</p>
      ${quote.inner ? innerMedia(quote.inner) : ''}
    </div>
  `;
}

/**
 * Binds the inner clip or carousel, when there is one.
 * @param {Element} el the element containing the rendered `.c-quote`
 * @param {{ quote: import('../../../src/http/contracts.js').QuoteVM, kind: string, sourceId: string }} props
 * @returns {void}
 */
export function bind(el, { quote, kind, sourceId }) {
  const box = el.querySelector('.c-quote');
  if (!box || !quote.inner) return;
  if (quote.inner.type === 'video') videoPlayer.bind(box, { kind, sourceId, variants: quote.inner.variants });
  else carousel.bind(box, quote.inner);
}
