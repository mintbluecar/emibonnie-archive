// @ts-check
/**
 * The translation kind's front-end "section" half (public/js/kinds/_registry.js's
 * `KIND_UI.translation.section`): a stack of `previewCard`s for a hub
 * page's `Section` of translation items (src/http/contracts.js), or a
 * grid of compact ones (kindTranslation.css). Entries show opening
 * lines, never a title.
 */
import { html } from '../../core/html.js';
import * as previewCard from '../../components/previewCard.js';

/**
 * @param {import('../../../../src/http/contracts.js').Section} section
 * @param {{ compact?: boolean }} [ctx] `compact`: the event, person and translator
 *   pages show each entry as a compact preview (Task 9b)
 * @returns {import('../../core/html.js').SafeHtml}
 */
export function render(section, ctx = {}) {
  const compact = ctx.compact === true;
  const cards = section.items.map((result) => previewCard.render({ result, compact }));
  return compact
    ? html`<div class="k-translation-grid" data-kind="translation">${cards}</div>`
    : html`<div class="stack stack--2" data-kind="translation">${cards}</div>`;
}

/** @param {Element} el @returns {void} */
export function bind(el) {
  previewCard.bind(el);
}
