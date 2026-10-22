// @ts-check
/**
 * A search `SearchResult` card (src/http/contracts.js): the event it
 * happened in, its `matchLines` (verbatim, so `q`'s matches are
 * highlighted against the raw text), and a meta line. The raw line is
 * split on `q` *before* escaping, so a match inside what would otherwise
 * become an HTML entity (e.g. `q: 'amp'` against `'a & amp'`) marks only
 * the real word, never text that only looks like it once escaped.
 *
 * `matchLines` is only ever populated when a text query (`q`) ran
 * (src/http/contracts.js: "none without q") -- a filters-only search
 * (people/types/event/.../no text) always has an empty `matchLines`, so
 * this card falls back to `bubbles.render({ bubbles: result.lines })`,
 * the item's own opening lines, the same fallback `previewCard.js`
 * already uses (review round 1, I4).
 */
import { html } from '../core/html.js';
import { dayLabel } from '../core/format.js';
import { t } from '../core/site.js';
import * as bubbles from './bubbles.js';

/** @param {string} text @returns {string} */
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @param {string} line
 * @param {string} q
 * @returns {import('../core/html.js').SafeHtml}
 */
function highlighted(line, q) {
  if (!q) return html`${line}`;
  const parts = line.split(new RegExp(`(${escapeRegExp(q)})`, 'gi'));
  return html`${parts.map((part, i) => (i % 2 === 1 ? html`<mark>${part}</mark>` : part))}`;
}

/**
 * @param {import('../../../src/http/contracts.js').SearchResult} result
 * @returns {import('../core/html.js').SafeHtml}
 */
function metaLine(result) {
  return html`
    <div class="c-result-card__meta">
      ${result.people.map((person) => html`<span aria-hidden="true">${person.emoji}</span>`)}
      ${result.accountHandle ? html` · ${t('item.translatedBy')} @${result.accountHandle}` : ''}
    </div>
  `;
}

/**
 * @param {{ result: import('../../../src/http/contracts.js').SearchResult, q: string }} props
 * @returns {import('../core/html.js').SafeHtml}
 */
export function render(props) {
  const { result, q } = props;
  const text = result.matchLines.length > 0
    ? html`<div class="c-result-card__text">${result.matchLines.map((line) => html`<div class="c-result-card__line">${highlighted(line, q)}</div>`)}</div>`
    : bubbles.render({ bubbles: result.lines });
  return html`
    <a class="c-result-card" href="${result.url}">
      ${result.event ? html`<div class="c-result-card__event">${result.event.name} · ${dayLabel(result.occurredOn)}</div>` : ''}
      ${text}
      ${metaLine(result)}
    </a>
  `;
}

/** @param {Element} el @returns {void} */
export function bind(el) {
  bubbles.bind(el);
}
