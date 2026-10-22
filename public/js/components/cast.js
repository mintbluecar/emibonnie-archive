// @ts-check
/**
 * The cast legend: who speaks, in `CastVM` order (src/http/contracts.js).
 * A person chip carries its colour via `data-c` (+ `bind()`, see
 * public/js/components/bubbles.js for the same pattern); a role chip has
 * none, so it keeps the CSS default. Every chip's emoji has a visible
 * name right next to it, satisfying the a11y "visible name or aria-label"
 * rule without any extra markup.
 */
import { html } from '../core/html.js';

/**
 * @param {import('../../../src/http/contracts.js').CastVM} member
 * @returns {import('../core/html.js').SafeHtml}
 */
function chip(member) {
  const colour = member.kind === 'person' ? member.colour : null;
  return html`
    <span class="c-cast__chip"${colour ? html` data-c="${colour}"` : ''}>
      <span aria-hidden="true">${member.emoji}</span> ${member.name}
    </span>
  `;
}

/**
 * @param {{ cast: import('../../../src/http/contracts.js').CastVM[] }} props
 * @returns {import('../core/html.js').SafeHtml}
 */
export function render(props) {
  return html`<div class="c-cast">${props.cast.map(chip)}</div>`;
}

/** @param {Element} el @returns {void} */
export function bind(el) {
  for (const node of el.querySelectorAll('[data-c]')) {
    const colour = node.getAttribute('data-c');
    if (colour) /** @type {HTMLElement} */ (node).style.setProperty('--c', colour);
  }
}
