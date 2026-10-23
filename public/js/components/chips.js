// @ts-check
/**
 * A generic row of pills (filter options, active-filter tags, category
 * labels, …). Every chip's text comes from the caller already resolved
 * (the one copy key here is `hashtagChip`'s tooltip); an `active` chip gets the
 * `--on` state class, and an optional `colour` sets `data-c` for `bind()`.
 * A chip with `value` set is a real `<button type="button">` -- keyboard
 * operable for free (Enter/Space fire `click` on a button natively, no
 * extra JS needed) -- with `aria-pressed` reflecting `active`. A
 * display-only chip (no `value`, e.g. a hashtag/type pill) stays a
 * `<span>`, never a focus stop for something that does nothing on click.
 */
import { html } from '../core/html.js';
import { applyColours } from '../core/dom.js';
import { t } from '../core/site.js';
import { hashtagHref } from '../core/links.js';

/**
 * @typedef {{ label: string, emoji?: string, active?: boolean, colour?: string|null, value?: string|number,
 *   href?: string|null, title?: string }} ChipVM
 *   `href` (optional, Task 10c): an outbound link (from
 *   public/js/core/links.js, so already allowlisted) -- the chip is then an
 *   `<a>` opening in a new tab, with `title` as its tooltip.
 *   `emoji` (optional, Task 10c): shown before the label in its own
 *   element (decorative, `aria-hidden`), spaced by the chip's gap.
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
  const content = item.emoji ? html`<span class="c-chips__emoji c-emoji" aria-hidden="true">${item.emoji}</span><span>${item.label}</span>` : item.label;
  if (item.href) {
    return html`<a class="${classes}" href="${item.href}" target="_blank" rel="noopener noreferrer"${item.title ? html` title="${item.title}"` : ''}${colourAttr}>${content}</a>`;
  }
  if (item.value === undefined) return html`<span class="${classes}"${colourAttr}>${content}</span>`;
  return html`<button type="button" class="${classes}" aria-pressed="${item.active ? 'true' : 'false'}" data-value="${item.value}"${colourAttr}>${content}</button>`;
}

/**
 * A hashtag chip (Task 10c): `#tag`, linking to X's hashtag search in a
 * new tab, with the `chips.searchOnX` tooltip. Keyword chips (no `#`)
 * stay plain `{ label }` chips.
 * @param {string} tag without its `#`
 * @returns {ChipVM}
 */
export function hashtagChip(tag) {
  return { label: `#${tag}`, href: hashtagHref(tag), title: t('chips.searchOnX') };
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
