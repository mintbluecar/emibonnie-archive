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
 * title (see mockups/screens-v2.html's event screen).
 */
import { html } from '../core/html.js';
import { t } from '../core/site.js';
import * as bubbles from './bubbles.js';

/**
 * @param {import('../../../src/http/contracts.js').Preview} preview
 * @returns {import('../core/html.js').SafeHtml}
 */
function metaRow(preview) {
  return html`
    <div class="c-preview-card__meta">
      ${preview.people.map((person) => html`<span aria-hidden="true">${person.emoji}</span>`)}
      ${preview.accountHandle ? html` · ${t('item.translatedBy')} @${preview.accountHandle}` : ''}
      ${preview.hasVideo ? html` · <span role="img" aria-label="${t('item.hasVideo')}">🎬</span>` : ''}
      ${preview.followsOnFrom ? html` · ${t('item.followsOn')} ↑` : ''}
    </div>
  `;
}

/**
 * @param {{ result: import('../../../src/http/contracts.js').Preview }} props
 * @returns {import('../core/html.js').SafeHtml}
 */
export function render(props) {
  const { result } = props;
  return html`
    <a class="c-preview-card" href="${result.url}">
      ${bubbles.render({ bubbles: result.lines })}
      ${metaRow(result)}
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
