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
import { dayLabel } from '../../core/format.js';
import { thaiSpans } from '../../core/thai.js';
import * as cast from '../../components/cast.js';
import * as bubbles from '../../components/bubbles.js';

/**
 * `translated by: @handle · clip by @source · 14 Oct 2026` (task-4 brief;
 * owner 2026-10-23: the translator's own dedicated, linked credit line in
 * place of the translate icon): the account credits, then the event date
 * it happened on (`dayLabel`). No time (Task 10b, owner's rule): never
 * the viewer's local time, and the post time isn't the event's.
 * @param {import('../../../../src/http/contracts.js').DetailVM['credits']} credits
 * @returns {import('../../core/html.js').SafeHtml}
 */
function creditsLine(credits) {
  return html`
    <p class="meta k-translation-detail__credits">
      ${credits.account ? html`${t('item.translatedBy')} <a class="k-translation-detail__credit-link" href="${credits.account.url}" target="_blank" rel="noopener noreferrer">@${credits.account.handle}</a>` : ''}
      ${credits.clipBy ? html` · ${t('item.clipBy')} <b>@${credits.clipBy}</b>` : ''}
      · ${dayLabel(credits.occurredOn)}
    </p>
  `;
}

/**
 * The verbatim original, as one element whose CSS (`white-space:
 * pre-wrap`, kindTranslation.css) keeps every line break and blank line
 * the stored text has -- a thread's parts are joined by a blank line, so
 * they stay apart too (Task 10b). Escaped by `html`; no `<br>`s. No
 * whitespace inside the element besides the text's own.
 * @param {string} text
 * @returns {import('../../core/html.js').SafeHtml}
 */
function originalText(text) {
  return html`<p class="k-translation-detail__original-text">${thaiSpans(text, site.sourceLanguage)}</p>`;
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
      <details>
        <summary class="meta tap-link k-translation-detail__original-toggle">${t('item.showOriginal')}</summary>
        ${originalText(detail.original)}
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
