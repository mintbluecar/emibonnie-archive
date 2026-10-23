// @ts-check
/**
 * A generic row of pills (filter options, active-filter tags, category
 * labels, …). Every chip's text comes from the caller already resolved
 * (this component holds no copy of its own); an `active` chip gets the
 * `--on` state class, and an optional `colour` sets `data-c` for `bind()`.
 * A chip with `value` set is a real `<button type="button">` -- keyboard
 * operable for free (Enter/Space fire `click` on a button natively, no
 * extra JS needed) -- with `aria-pressed` reflecting `active`. A
 * display-only chip (no `value`, e.g. a hashtag/type pill) stays a
 * `<span>`, never a focus stop for something that does nothing on click.
 */
import { html } from '../core/html.js';
import { applyColours } from '../core/dom.js';

/**
 * @typedef {{ label: string, active?: boolean, colour?: string|null, value?: string|number }} ChipVM
 *   `value` (optional): a caller-chosen identifier for a clickable
 *   (filter) chip, carried as `data-value` -- this component never reads
 *   or acts on it itself, only a page's own click handler does.
 */

/**
 * @param {ChipVM} item
 * @returns {import('../core/html.js').SafeHtml}
 */
function oneChip(item) {
  const classes = `c-chips__chip${item.active ? ' c-chips__chip--on' : ''}`;
  const colourAttr = item.colour ? html` data-c="${item.colour}"` : '';
  if (item.value === undefined) return html`<span class="${classes}"${colourAttr}>${item.label}</span>`;
  return html`<button type="button" class="${classes}" aria-pressed="${item.active ? 'true' : 'false'}" data-value="${item.value}"${colourAttr}>${item.label}</button>`;
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
