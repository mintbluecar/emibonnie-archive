// @ts-check
/**
 * A search `SearchResult` card (src/http/contracts.js): the event it
 * happened in, its `matchLines` (verbatim text, with each speaker shown
 * by display emoji, so `q`'s matches are highlighted against the text
 * itself), and a meta line. The raw line is
 * split on `q` *before* escaping, so a match inside what would otherwise
 * become an HTML entity (e.g. `q: 'amp'` against `'a & amp'`) marks only
 * the real word, never text that only looks like it once escaped.
 *
 * With a query, only the matching lines show (the spec: "Results show
 * the event and date, then the matching lines"). `matchLines` is only
 * ever populated when a text query (`q`) ran (src/http/contracts.js:
 * "none without q"), and is empty too when `q` matched something other
 * than the text (an event name, a hashtag, a person). Then this card
 * shows at most the item's first two opening lines, compact
 * (`bubbles.renderCompact`, Task 9b), as one run of "emoji text".
 *
 * The card root is a non-link `<article>` (owner, 2026-10-23), not an
 * `<a>`: the translator's own dedicated credit line (`cardCredit.js`)
 * needs its own link, which can't nest inside another. The main link
 * (`.c-result-card__link`) wraps the opening content and stretches over
 * the whole card (resultCard.css's `::after`), so the card stays one big
 * click target; the credit link sits above that overlay.
 */
import { html } from '../core/html.js';
import { dayLabel } from '../core/format.js';
import * as bubbles from './bubbles.js';
import * as thumb from './thumb.js';
import * as cardCredit from './cardCredit.js';

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

/** Opening lines shown when there are no matching lines (Task 9b). */
const FALLBACK_LINES = 2;

/**
 * @param {import('../../../src/http/contracts.js').SearchResult} result
 * @returns {import('../core/html.js').SafeHtml}
 */
function metaLine(result) {
  return html`
    <div class="meta c-result-card__meta">
      ${result.people.map((person) => html`<span aria-hidden="true">${person.emoji}</span>`)}
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
    : bubbles.renderCompact({ bubbles: result.lines.filter((b) => b.kind !== 'note').slice(0, FALLBACK_LINES) });
  return html`
    <article class="card card--flush" data-result-card>
      <a class="card__link c-result-card__link" href="${result.url}"${result.thumb ? html` data-thumb` : ''}>
        <div class="c-result-card__body">
          ${result.event ? html`<div class="label c-result-card__event">${result.event.name} · ${dayLabel(result.occurredOn)}</div>` : ''}
          ${text}
          ${metaLine(result)}
        </div>
        ${thumb.render(result.thumb)}
      </a>
      ${cardCredit.render(result)}
    </article>
  `;
}

/** @param {Element} el @returns {void} */
export function bind(el) {
  bubbles.bind(el);
}
