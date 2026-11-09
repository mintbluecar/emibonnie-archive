// @ts-check
/**
 * The site's dropdown's markup (public/js/core/selectMenu.js): the button
 * and popup laid over a `<select>`, and how an option's lead, text and
 * detail are drawn (public/js/core/menuOption.js builds such options).
 */
import { html } from './html.js';

/** @typedef {import('./html.js').SafeHtml} SafeHtml */
/** @typedef {(el: { innerHTML: string }, safeHtml: SafeHtml) => void} Mount */

/** @param {HTMLOptionElement|undefined} o @returns {SafeHtml} an option's lead, text and detail, as the dropdown draws them */
export function partsOf(o) {
  if (!o) return html``;
  const lead = o.dataset.lead ? html`<span class="select-menu__lead">${o.dataset.lead}</span>` : '';
  const detail = o.dataset.detail ? html`<span class="select-menu__detail">${o.dataset.detail}</span>` : '';
  return html`${lead}<span class="select-menu__name">${o.textContent}</span>${detail}`;
}

/**
 * Lays the button and its popup over `select`, takes the select out of
 * the tab order and accessibility tree, and hands its name to the button.
 * @param {HTMLSelectElement} select
 * @param {string} id
 * @param {Mount} mount dom.js's `mount()`
 */
export function build(select, id, mount) {
  const label = /** @type {HTMLLabelElement|null} */ (select.id ? document.querySelector(`label[for="${CSS.escape(select.id)}"]`) : null);
  if (label && !label.id) label.id = `${id}-label`;
  // With no <label>, the select's own aria-label names the button, and shows on hover.
  const ownName = label ? '' : select.getAttribute('aria-label') ?? '';
  const search = select.dataset.menuSearch;
  const holder = document.createElement('template');
  mount(holder, html`
    <button type="button" class="select-menu__trigger" id="${id}" role="combobox" aria-haspopup="listbox"
      aria-expanded="false" aria-controls="${id}-list" aria-labelledby="${label?.id ?? ''}"
      aria-label="${ownName}" title="${ownName}"><span class="select-menu__value"></span></button>
    <div class="select-menu__list" hidden>
      ${search ? html`<input class="select-menu__search" type="search" placeholder="${search}" aria-label="${search}"
        role="combobox" aria-expanded="true" aria-autocomplete="list" aria-controls="${id}-list" autocomplete="off">` : ''}
      <div class="select-menu__options" id="${id}-list" role="listbox"></div>
    </div>
  `);
  select.after(holder.content);
  const trigger = /** @type {HTMLButtonElement} */ (select.nextElementSibling);
  const popup = /** @type {HTMLElement} */ (trigger.nextElementSibling);
  select.setAttribute('data-menu', '');
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');
  if (label) label.htmlFor = id;
  return {
    trigger,
    popup,
    value: /** @type {HTMLElement} */ (trigger.firstElementChild),
    search: /** @type {HTMLInputElement|null} */ (popup.querySelector('.select-menu__search')),
    listbox: /** @type {HTMLElement} */ (popup.querySelector('[role="listbox"]')),
  };
}
