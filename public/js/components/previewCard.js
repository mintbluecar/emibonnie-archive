// @ts-check
/**
 * A `Preview` card (src/http/contracts.js): a kind-agnostic shell around
 * its opening `lines` (rendered by `bubbles`, whose own escaping and
 * `data-c` colours this card's `bind()` delegates to) plus a meta row --
 * who's in it, the translator's handle, whether it has video, and
 * whether it follows on from an earlier entry. Entries show opening
 * lines, never a title (see mockups/screens-v2.html's event screen).
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
      ${preview.followsOnFrom ? html` · <a href="${preview.followsOnFrom.url}">${t('item.followsOn')} ↑</a>` : ''}
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
