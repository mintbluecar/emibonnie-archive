// @ts-check
/**
 * A `Preview` card (src/http/contracts.js): a kind-agnostic shell around
 * its opening `lines` (rendered by `bubbles`, whose own escaping and
 * `data-c` colours this card's `bind()` delegates to) plus a meta row --
 * who's in it, the translator's handle, whether it has video, and
 * whether it follows on from an earlier entry (plain text, not a link --
 * the mockups show it that way, and the card's own outer `<a>` is
 * already the one link; nesting another inside it would be invalid
 * markup and ambiguous to click). Entries show opening lines, never a
 * title (see mockups/screens-v2.html's event screen). The outer `<a>`
 * also carries `data-person-ids`/`data-account` generically, so a hub
 * page's own client-side people/translator filter (Plan 1b Task 3) works
 * for any kind's entries without this component or the page knowing
 * which kind it is.
 *
 * A card with media shows its thumbnail (`thumb.js`, Task 10c) beside
 * the text; a clip's ▶ thumbnail then stands in for the meta row's 🎬
 * (kept for a clip with no poster).
 *
 * `compact` (Task 9b: the event, person and translator pages) shows the same
 * lines as one clamped run of "emoji text" (`bubbles.renderCompact`)
 * instead of full bubbles, as in mockups/people-me-v1.html.
 */
import { html } from '../core/html.js';
import { t } from '../core/site.js';
import * as bubbles from './bubbles.js';
import * as thumb from './thumb.js';

/**
 * @param {import('../../../src/http/contracts.js').Preview} preview
 * @returns {import('../core/html.js').SafeHtml}
 */
function metaRow(preview) {
  return html`
    <div class="c-preview-card__meta">
      ${preview.people.map((person) => html`<span aria-hidden="true">${person.emoji}</span>`)}
      ${preview.accountHandle ? html` · ${t('item.translatedBy')} @${preview.accountHandle}` : ''}
      ${preview.hasVideo && !preview.thumb ? html` · <span role="img" aria-label="${t('item.hasVideo')}">🎬</span>` : ''}
      ${preview.followsOnFrom ? html` · ${t('item.followsOn')} ↑` : ''}
    </div>
  `;
}

/**
 * @param {{ result: import('../../../src/http/contracts.js').Preview, compact?: boolean }} props
 * @returns {import('../core/html.js').SafeHtml}
 */
export function render(props) {
  const { result, compact = false } = props;
  const personIds = result.people.map((person) => person.id).join(',');
  return html`
    <a
      class="c-preview-card${compact ? ' c-preview-card--compact' : ''}${result.thumb ? ' c-preview-card--thumb' : ''}"
      href="${result.url}"
      data-person-ids="${personIds}"
      ${result.accountHandle ? html`data-account="${result.accountHandle}"` : ''}
    >
      <div class="c-preview-card__body">
        ${compact ? bubbles.renderCompact({ bubbles: result.lines }) : bubbles.render({ bubbles: result.lines })}
        ${metaRow(result)}
      </div>
      ${thumb.render(result.thumb)}
    </a>
  `;
}

/**
 * @param {Element} el
 * @returns {void}
 */
export function bind(el) {
  bubbles.bind(el);
}
