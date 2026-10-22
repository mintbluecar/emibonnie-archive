// @ts-check
/**
 * A generic row of pills (filter options, active-filter tags, category
 * labels, …). Every chip's text comes from the caller already resolved
 * (this component holds no copy of its own); an `active` chip gets the
 * `--on` state class, and an optional `colour` sets `data-c` for `bind()`.
 */
import { html } from '../core/html.js';
import { applyColours } from '../core/dom.js';

/** @typedef {{ label: string, active?: boolean, colour?: string|null }} ChipVM */

/**
 * @param {ChipVM} item
 * @returns {import('../core/html.js').SafeHtml}
 */
function oneChip(item) {
  const classes = `c-chips__chip${item.active ? ' c-chips__chip--on' : ''}`;
  return html`<span class="${classes}"${item.colour ? html` data-c="${item.colour}"` : ''}>${item.label}</span>`;
}

/**
 * @param {{ items: ChipVM[] }} props
 * @returns {import('../core/html.js').SafeHtml}
 */
export function render(props) {
  return html`<div class="c-chips">${props.items.map(oneChip)}</div>`;
}

/** @param {Element} el @returns {void} */
export function bind(el) {
  applyColours(el);
}
