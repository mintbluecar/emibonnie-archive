// @ts-check
/**
 * The translation kind's front-end "detail" half: the pinned media (when
 * there is any), credits, cast legend, the bubbles, and a toggle that
 * reveals the verbatim original text. Media here is the minimal
 * video/images/quote markup; swapping it for a "no longer available"
 * note when a source has gone (Review Focus #2) is Task 4's job.
 */
import { html } from '../../core/html.js';
import { on } from '../../core/dom.js';
import { t } from '../../core/site.js';
import { dayLabel } from '../../core/format.js';
import * as cast from '../../components/cast.js';
import * as bubbles from '../../components/bubbles.js';

const ORIGINAL_SELECTOR = '.k-translation-detail__original-toggle';

/**
 * @param {import('../../../../src/http/contracts.js').MediaVM|null} media
 * @returns {import('../../core/html.js').SafeHtml}
 */
function renderMedia(media) {
  if (!media) return html``;
  if (media.type === 'video') return renderVideo(media);
  if (media.type === 'images') return renderImages(media);
  return renderQuote(media);
}

/**
 * @param {import('../../../../src/http/contracts.js').VideoVM} video
 * @returns {import('../../core/html.js').SafeHtml}
 */
function renderVideo(video) {
  const best = [...video.variants].sort((a, b) => b.bitrate - a.bitrate)[0];
  return html`
    <video class="k-translation-detail__video" controls playsinline width="${video.width}" height="${video.height}">
      ${best ? html`<source src="${best.url}">` : ''}
    </video>
  `;
}

/**
 * @param {import('../../../../src/http/contracts.js').ImagesVM} imagesVm
 * @returns {import('../../core/html.js').SafeHtml}
 */
function renderImages(imagesVm) {
  return html`
    <div class="k-translation-detail__images">
      ${imagesVm.images.map((image) => html`<img src="${image.url}" width="${image.width}" height="${image.height}" alt="">`)}
    </div>
  `;
}

/**
 * @param {import('../../../../src/http/contracts.js').QuoteVM} quote
 * @returns {import('../../core/html.js').SafeHtml}
 */
function renderQuote(quote) {
  return html`
    <div class="k-translation-detail__quote">
      ${quote.authorName || quote.authorHandle ? html`
        <p class="k-translation-detail__quote-author">${quote.authorName ?? ''}${quote.authorHandle ? html` @${quote.authorHandle}` : ''}</p>
      ` : ''}
      <p class="k-translation-detail__quote-text">${quote.text}</p>
      ${quote.inner ? renderMedia(quote.inner) : ''}
    </div>
  `;
}

/**
 * @param {import('../../../../src/http/contracts.js').DetailVM['credits']} credits
 * @returns {import('../../core/html.js').SafeHtml}
 */
function creditsLine(credits) {
  return html`
    <p class="k-translation-detail__credits">
      ${credits.account ? html`${t('item.translatedBy')} <b>@${credits.account.handle}</b>` : ''}
      ${credits.clipBy ? html` · ${t('item.clipBy')} <b>@${credits.clipBy}</b>` : ''}
      · ${dayLabel(credits.occurredOn)}
    </p>
  `;
}

/** @param {string} text @returns {import('../../core/html.js').SafeHtml[]} */
function originalParagraphs(text) {
  return text.split(/\n\s*\n/).map((para) => html`<p class="k-translation-detail__original-para">${para}</p>`);
}

/**
 * @param {import('../../../../src/http/contracts.js').DetailVM} detail
 * @returns {import('../../core/html.js').SafeHtml}
 */
export function render(detail) {
  return html`
    <div class="k-translation-detail" data-kind="translation">
      ${renderMedia(detail.media)}
      ${creditsLine(detail.credits)}
      ${cast.render({ cast: detail.cast })}
      ${bubbles.render({ bubbles: detail.bubbles })}
      <button class="k-translation-detail__original-toggle" type="button" aria-expanded="false">${t('item.showOriginal')}</button>
      <div class="k-translation-detail__original" hidden>${originalParagraphs(detail.original)}</div>
    </div>
  `;
}

/**
 * Wires the colours `cast`/`bubbles` rendered, plus the show-original toggle.
 * @param {Element} el
 * @returns {void}
 */
export function bind(el) {
  cast.bind(el);
  bubbles.bind(el);
  on(el, ORIGINAL_SELECTOR, 'click', (_e, target) => {
    const original = el.querySelector('.k-translation-detail__original');
    if (!original) return;
    const expanded = target.getAttribute('aria-expanded') === 'true';
    target.setAttribute('aria-expanded', String(!expanded));
    /** @type {HTMLElement} */ (original).hidden = expanded;
  });
}
