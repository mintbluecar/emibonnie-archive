// @ts-check
/**
 * The translation kind's front-end "detail" half: credits, cast legend,
 * the bubbles, and a toggle that reveals the verbatim original text.
 * Media is kind-agnostic (`MediaVM` is a generic contract shape, not a
 * translation-kind concept) and the item page's own pinned area owns it
 * via `public/js/components/mediaBox.js` instead -- see that module's
 * doc comment. This file renders only what's specific to the kind.
 */
import { html } from '../../core/html.js';
import { site, t } from '../../core/site.js';
import { dayLabel, timePair } from '../../core/format.js';
import { thaiSpans } from '../../core/thai.js';
import * as cast from '../../components/cast.js';
import * as bubbles from '../../components/bubbles.js';

/**
 * `tl @handle · clip by @source · 4:00 pm bangkok · 14 Oct 2026`
 * (task-4 brief): the account credits, then when the post was made
 * (`timePair`) and the event date it happened on (`dayLabel`).
 * @param {import('../../../../src/http/contracts.js').DetailVM['credits']} credits
 * @returns {import('../../core/html.js').SafeHtml}
 */
function creditsLine(credits) {
  return html`
    <p class="k-translation-detail__credits">
      ${credits.account ? html`${t('item.translatedBy')} <b>@${credits.account.handle}</b>` : ''}
      ${credits.clipBy ? html` · ${t('item.clipBy')} <b>@${credits.clipBy}</b>` : ''}
      ${credits.postedAt ? html` · ${timePair(credits.postedAt, site.timezone)}` : ''}
      · ${dayLabel(credits.occurredOn)}
    </p>
  `;
}

/** @param {string} text @returns {import('../../core/html.js').SafeHtml[]} */
function originalParagraphs(text) {
  return text
    .split(/\n\s*\n/)
    .map((para) => html`<p class="k-translation-detail__original-para">${thaiSpans(para, site.sourceLanguage)}</p>`);
}

/**
 * `afterCredits` is an optional slot rendered right after the credits
 * line, before the cast legend -- the item page (task-4 brief: "Right:
 * credits ..., then pills, then cast, then bubbles") uses it to place
 * its own, generic pills row there without this kind-specific file ever
 * needing to know what a "pill" is. Any kind's `detail.render` may
 * support the same optional second argument.
 * @param {import('../../../../src/http/contracts.js').DetailVM} detail
 * @param {{ afterCredits?: import('../../core/html.js').SafeHtml }} [extra]
 * @returns {import('../../core/html.js').SafeHtml}
 */
export function render(detail, extra = {}) {
  return html`
    <div class="k-translation-detail" data-kind="translation">
      ${creditsLine(detail.credits)}
      ${extra.afterCredits ?? ''}
      ${cast.render({ cast: detail.cast })}
      ${bubbles.render({ bubbles: detail.bubbles })}
      <details class="k-translation-detail__original">
        <summary class="k-translation-detail__original-toggle">${t('item.showOriginal')}</summary>
        ${originalParagraphs(detail.original)}
      </details>
    </div>
  `;
}

/**
 * Wires the colours `cast`/`bubbles` rendered. The "show original"
 * disclosure is a native `<details>` (task-4 brief), so it needs no JS.
 * @param {Element} el
 * @returns {void}
 */
export function bind(el) {
  cast.bind(el);
  bubbles.bind(el);
}
