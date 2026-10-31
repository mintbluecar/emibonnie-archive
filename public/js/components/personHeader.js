// @ts-check
/**
 * A person page's header: a centred card tinted with the person's colour
 * (`data-c` + `bind()`), with a large emoji, their name, their IG handle,
 * then the page's own counts line and action (the scoped-search icon), as
 * in mockups/people-me-v1.html (Task 9b).
 */
import { html } from '../core/html.js';
import { applyColours } from '../core/dom.js';

/**
 * @param {{ person: import('../../../src/http/contracts.js').PersonChip & { featured: boolean },
 *   counts?: import('../core/html.js').SafeHtml, action?: import('../core/html.js').SafeHtml }} props
 *   `counts`: the page's counts line, as text (this card sets its look).
 * @returns {import('../core/html.js').SafeHtml}
 */
export function render(props) {
  const { person, counts, action } = props;
  return html`
    <div class="c-person-header"${person.colour ? html` data-c="${person.colour}"` : ''}>
      <span class="c-person-header__emoji c-emoji" aria-hidden="true">${person.emoji}</span>
      <h1 class="c-person-header__name">${person.name}</h1>
      ${person.igHandle ? html`<p class="c-person-header__handle">@${person.igHandle}</p>` : ''}
      ${counts ? html`<p class="meta c-person-header__counts">${counts}</p>` : ''}
      ${action ? html`<div class="c-person-header__action">${action}</div>` : ''}
    </div>
  `;
}

/** @param {Element} el @returns {void} */
export function bind(el) {
  applyColours(el);
}
