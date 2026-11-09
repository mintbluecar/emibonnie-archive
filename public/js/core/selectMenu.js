// @ts-check
/**
 * The site's own dropdown (owner, 2026-11-09: never the browser's native
 * picker). Every `<select>` inside a `.field__select` gets a button and an
 * option list laid over it, drawn in the site's look; the `<select>`
 * stays underneath as the one source of truth. Picking an option sets its
 * value and fires the same bubbling `change` (and `input`) a native pick
 * would, so page code, forms and tests that read or drive the `<select>`
 * keep working unchanged.
 *
 * What a `<select>` may ask of it, by attribute:
 *   - an `<option>`'s `data-lead` is drawn before its text (a person's
 *     emoji), `data-detail` after it, smaller and lighter (their IG
 *     handle; it's what shortens when space runs out);
 *   - an `<option data-action>` (e.g. "＋ New person") is drawn as an
 *     action, set apart above the rest; put actions first;
 *   - a `hidden` `<option>` (a "choose…" placeholder) shows on the closed
 *     button but never in the list;
 *   - `data-menu-search="<placeholder>"` on the `<select>` adds a search
 *     box at the top of the open list, filtering by text and detail
 *     (actions always stay).
 *
 * The button follows the WAI-ARIA "select-only combobox" pattern
 * (https://www.w3.org/WAI/ARIA/apg/patterns/combobox/examples/combobox-select-only/):
 * `aria-activedescendant` points at the active option, and the keys are
 * the pattern's -- Down/Up/Enter/Space/Home/End open it, arrows move,
 * Enter/Space/Tab pick, Escape closes, and typing jumps to the next
 * option starting with what was typed. With a search box, focus moves
 * into it while the list is open (the pattern's editable combobox), and
 * typing filters instead. The `<select>` itself leaves the tab order and
 * the accessibility tree; its `<label>` (or its `aria-label`) names the
 * button instead.
 *
 * Bound once per page by `mountPage()` (public/js/core/dom.js), which
 * hands over its `mount()` -- the one place markup reaches the DOM --
 * rather than this module importing dom.js back; a MutationObserver
 * enhances every `<select>` a later render adds.
 */
import { html } from './html.js';
import { build, partsOf } from './selectMenuMarkup.js';
import { CLOSED_KEYS, OPEN_KEYS, SEARCH_PASS, isChar } from './selectMenuKeys.js';

/** @typedef {(el: { innerHTML: string }, safeHtml: import('./html.js').SafeHtml) => void} Mount */

const SELECTOR = '.field__select select:not([data-menu])';
const TYPEAHEAD_MS = 500;
const LIST_MAX = 300;

/** @type {WeakMap<HTMLSelectElement, SelectMenu>} */
const menuOf = new WeakMap();
let count = 0;
let observing = false;
/** dom.js's `mount()`, set by `bindSelectMenus()`. @type {Mount} */
let mount = () => {};

/** @param {HTMLOptionElement} o @returns {string} what a search matches against */
const haystackOf = (o) => `${o.textContent ?? ''} ${o.dataset.detail ?? ''}`.toLowerCase();

/** @param {Event} e @returns {number|null} the option index under the pointer */
function optionIndexOf(e) {
  const option = /** @type {HTMLElement|null} */ (/** @type {Element} */ (e.target).closest('[role="option"]'));
  return option ? Number(option.dataset.index) : null;
}

class SelectMenu {
  /** @param {HTMLSelectElement} select */
  constructor(select) {
    this.select = select;
    this.active = -1;
    this.typed = '';
    this.typedAt = 0;
    count += 1;
    this.id = `select-menu-${count}`;
    const { trigger, popup, value, search, listbox } = build(select, this.id, mount);
    this.trigger = trigger;
    this.popup = popup;
    this.value = value;
    this.search = search;
    this.listbox = listbox;
    this.bind();
    this.sync();
  }

  bind() {
    const { trigger, popup, select, search } = this;
    trigger.addEventListener('click', () => (this.isOpen() ? this.close() : this.open()));
    trigger.addEventListener('keydown', (e) => this.onKey(e));
    // Leaving the button and its popup closes the list; moving between them doesn't.
    for (const el of [trigger, popup]) {
      el.addEventListener('focusout', (e) => {
        const next = /** @type {Node|null} */ (e.relatedTarget);
        if (!next || (next !== trigger && !popup.contains(next))) this.close();
      });
    }
    // Keep focus where it is while the pointer picks (the pattern's rule).
    popup.addEventListener('mousedown', (e) => {
      if (e.target !== search) e.preventDefault();
    });
    popup.addEventListener('mousemove', (e) => {
      const i = this.positionOf(optionIndexOf(e));
      if (i !== -1 && i !== this.active) this.setActive(i);
    });
    popup.addEventListener('click', (e) => {
      const i = optionIndexOf(e);
      if (i !== null) this.choose(i);
    });
    search?.addEventListener('input', () => this.render(search.value));
    search?.addEventListener('keydown', (e) => this.onKey(e));
    // A change made on the <select> itself (a test's selectOption, say) shows on the button.
    select.addEventListener('change', () => this.sync());
  }

  /** Shows the `<select>`'s chosen option and disabled state on the button. */
  sync() {
    mount(this.value, partsOf(this.select.selectedOptions[0]));
    this.trigger.disabled = this.select.disabled;
  }

  isOpen() {
    return !this.popup.hidden;
  }

  /** @returns {HTMLElement[]} the options listed now, in order */
  options() {
    return [...this.listbox.querySelectorAll('[role="option"]')].map((el) => /** @type {HTMLElement} */ (el));
  }

  /** @param {number|null} index a `<select>` option index @returns {number} its position in the list, or -1 */
  positionOf(index) {
    return this.options().findIndex((el) => Number(el.dataset.index) === index);
  }

  /** @param {string} query the search box's text; every option for '' */
  render(query) {
    const q = query.trim().toLowerCase();
    const shown = [...this.select.options].map((o, i) => ({ o, i }))
      .filter(({ o }) => !o.hidden && (o.hasAttribute('data-action') || haystackOf(o).includes(q)));
    mount(this.listbox, html`${shown.map(({ o, i }) => html`
      <div class="select-menu__option" role="option"${o.hasAttribute('data-action') ? html` data-action` : ''}
        id="${this.id}-o${i}" data-index="${i}" aria-selected="${String(o.selected)}"
        aria-disabled="${String(o.disabled)}">${partsOf(o)}</div>`)}`);
    if (q) this.setActive(shown.findIndex(({ o }) => !o.hasAttribute('data-action')));
  }

  /** @param {number} i a position in the list */
  setActive(i) {
    const all = this.options();
    if (all.length === 0) return;
    this.active = Math.max(0, Math.min(i, all.length - 1));
    for (const [n, el] of all.entries()) el.toggleAttribute('data-active', n === this.active);
    (this.search ?? this.trigger).setAttribute('aria-activedescendant', all[this.active].id);
    all[this.active].scrollIntoView({ block: 'nearest' });
  }

  /** @param {'first'|'last'|number} [at] where to start: an end, a `<select>` index, else the chosen option */
  open(at) {
    const { select, popup, trigger, search } = this;
    if (this.isOpen() || select.disabled) return;
    this.render('');
    if (search) search.value = '';
    popup.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    this.place();
    const chosen = this.positionOf(typeof at === 'number' ? at : select.selectedIndex);
    this.setActive(at === 'first' ? 0 : at === 'last' ? Infinity : Math.max(0, chosen));
    search?.focus();
  }

  /** Opens upward when it would run off the bottom, and lines up on the right when it would run off the side. */
  place() {
    const { popup, trigger } = this;
    const box = trigger.getBoundingClientRect();
    const below = window.innerHeight - box.bottom;
    popup.toggleAttribute('data-up', below < Math.min(popup.scrollHeight, LIST_MAX) && box.top > below);
    popup.removeAttribute('data-end');
    popup.toggleAttribute('data-end', popup.getBoundingClientRect().right > document.documentElement.clientWidth);
  }

  /** @param {boolean} [refocus] put focus back on the button (Escape) */
  close(refocus = false) {
    if (!this.isOpen()) return;
    const hadFocus = this.popup.contains(document.activeElement);
    this.popup.hidden = true;
    this.trigger.setAttribute('aria-expanded', 'false');
    this.trigger.removeAttribute('aria-activedescendant');
    this.active = -1;
    if (refocus || hadFocus) this.trigger.focus();
  }

  chooseActive() {
    const el = this.options()[this.active];
    if (el) this.choose(Number(el.dataset.index));
  }

  /** @param {number} i a `<select>` option index */
  choose(i) {
    const { select } = this;
    const option = select.options[i];
    if (!option || option.disabled) return;
    this.close(true);
    if (select.selectedIndex === i) return;
    select.selectedIndex = i;
    this.sync();
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /** @param {string} key one printable character, typed on the closed button */
  typeahead(key) {
    if (this.search) {
      this.open();
      this.search.value = key;
      this.render(key);
      return;
    }
    const now = Date.now();
    this.typed = now - this.typedAt > TYPEAHEAD_MS ? key : this.typed + key;
    this.typedAt = now;
    const names = [...this.select.options].map((o) => (o.hidden ? '' : (o.textContent ?? '').trim().toLowerCase()));
    const from = this.typed.length === 1 ? this.select.selectedIndex + 1 : Math.max(this.select.selectedIndex, 0);
    const hit = [...names.keys()].map((n) => (n + from) % names.length).find((n) => names[n] && names[n].startsWith(this.typed.toLowerCase()));
    if (hit !== undefined) this.open(hit);
  }

  /** @param {KeyboardEvent} e */
  onKey(e) {
    const inSearch = e.target === this.search;
    if (this.isOpen() && e.key === 'Tab') {
      if (inSearch) this.chooseActive();
      else this.close();
      return;
    }
    const action = this.isOpen() ? !(inSearch && SEARCH_PASS.has(e.key)) && OPEN_KEYS[e.key] : CLOSED_KEYS[e.key];
    if (action) action(this, e);
    else if (!inSearch && isChar(e)) this.typeahead(e.key);
    else return;
    e.preventDefault();
    // Escape closes only the list, never the dialog or sheet around it.
    e.stopPropagation();
  }
}

/** @param {ParentNode} root @returns {void} */
function enhanceWithin(root) {
  for (const select of root.querySelectorAll(SELECTOR)) {
    const el = /** @type {HTMLSelectElement} */ (select);
    menuOf.set(el, new SelectMenu(el));
  }
}

/** @param {MutationRecord} m @returns {HTMLSelectElement|null} the enhanced select a mutation changed */
function changedSelect(m) {
  const target = /** @type {Element} */ (m.target);
  const select = target instanceof HTMLSelectElement ? target : target.parentElement;
  return select instanceof HTMLSelectElement && select.hasAttribute('data-menu') ? select : null;
}

/**
 * Enhances every dropdown on the page now and in every later render.
 * Safe to call on each `mountPage()`: the observer starts once.
 * @param {Mount} mountFn dom.js's `mount()`
 * @returns {void}
 */
export function bindSelectMenus(mountFn) {
  // Like bindThemeToggles: nothing to do without a real DOM (a page test's stand-in document).
  if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function' || typeof MutationObserver === 'undefined') return;
  mount = mountFn;
  enhanceWithin(document);
  if (observing) return;
  observing = true;
  new MutationObserver((mutations) => {
    for (const m of mutations) {
      const select = changedSelect(m);
      if (select) menuOf.get(select)?.sync();
    }
    enhanceWithin(document);
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
}
