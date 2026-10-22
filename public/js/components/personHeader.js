// @ts-check
/** A person page's header: emoji, name, their IG handle, coloured via `data-c` + `bind()`. */
import { html } from '../core/html.js';

/**
 * @param {{ person: import('../../../src/http/contracts.js').PersonChip & { featured: boolean } }} props
 * @returns {import('../core/html.js').SafeHtml}
 */
export function render(props) {
  const { person } = props;
  return html`
    <div class="c-person-header"${person.colour ? html` data-c="${person.colour}"` : ''}>
      <span class="c-person-header__emoji" aria-hidden="true">${person.emoji}</span>
      <div>
        <h1 class="c-person-header__name">${person.name}</h1>
        ${person.igHandle ? html`<p class="c-person-header__handle">@${person.igHandle}</p>` : ''}
      </div>
    </div>
  `;
}

/** @param {Element} el @returns {void} */
export function bind(el) {
  for (const node of el.querySelectorAll('[data-c]')) {
    const colour = node.getAttribute('data-c');
    if (colour) /** @type {HTMLElement} */ (node).style.setProperty('--c', colour);
  }
}
