// @ts-check
/**
 * The search page's filter sheet (task-5-brief.md): who's in it (any-of
 * / all-of over people), type chips (categories from `/api/filters` plus
 * the two placement chips), and selects for event, translator, client
 * and date. A native `<dialog>`, opened by the page with `showModal()`
 * (which already traps focus and makes the rest of the page inert) --
 * this module only has to handle Escape and the close/apply buttons
 * itself, the same `keydown`-on-`dialog` pattern as `zoomDialog.js`
 * ('cancel'/'close' don't bubble, `keydown` does).
 *
 * Every control edits a *tentative* copy of `state` (never the one the
 * page is showing results for): Apply hands it to `onChange` and closes;
 * Escape/the close button discard it. While the sheet is open, every
 * edit also re-fetches the match count (`limit=0`) to keep the apply
 * button's `t('search.showN', {n})` current (task-5-brief.md ruling 3).
 */
import { html } from '../core/html.js';
import { on } from '../core/dom.js';
import { getJson } from '../core/api.js';
import { t } from '../core/site.js';
import * as chips from './chips.js';
import { withFilter, withoutFilter, toApiParams } from '../state/searchState.js';

const PLACEMENT_TYPES = [{ value: 'shared story', label: () => t('search.sharedStory') }, { value: 'posts', label: () => t('search.posts') }];

/** @param {import('../../../src/http/contracts.js').PersonChip[]} people @param {import('../state/searchState.js').State} state */
function peopleSection(people, state) {
  const modeItems = [
    { label: t('search.anyOf'), value: 'any', active: state.peopleMode === 'any' },
    { label: t('search.allOf'), value: 'all', active: state.peopleMode === 'all' },
  ];
  const peopleItems = people.map((p) => ({ label: `${p.emoji} ${p.name}`, colour: p.colour, value: p.id, active: state.people.includes(p.id) }));
  return html`
    <fieldset class="c-filter-sheet__section">
      <legend>${t('search.whoLabel')}</legend>
      <div class="c-filter-sheet__mode">${chips.render({ items: modeItems })}</div>
      <div class="c-filter-sheet__people">${chips.render({ items: peopleItems })}</div>
    </fieldset>
  `;
}

/** @param {{ id: number, name: string }[]} categories @param {import('../state/searchState.js').State} state */
function typesSection(categories, state) {
  const items = [
    ...categories.map((c) => ({ label: c.name, value: c.name, active: state.types.includes(c.name) })),
    ...PLACEMENT_TYPES.map((p) => ({ label: p.label(), value: p.value, active: state.types.includes(p.value) })),
  ];
  return html`
    <fieldset class="c-filter-sheet__section">
      <legend>${t('search.typesLabel')}</legend>
      <div class="c-filter-sheet__types">${chips.render({ items })}</div>
    </fieldset>
  `;
}

/** `` selected`` when `value` is the current one, else nothing (a nested `html` fragment, never a raw string, per the escaping rule). @param {unknown} optionValue @param {unknown} current @returns {import('../core/html.js').SafeHtml|string} */
function selectedAttr(optionValue, current) {
  return String(optionValue) === String(current) ? html` selected` : '';
}

/**
 * @param {import('../../../src/http/contracts.js').FilterOptions} options
 * @param {import('../state/searchState.js').State} state
 */
function selectsSection(options, state) {
  return html`
    <label class="c-filter-sheet__field">
      ${t('search.eventLabel')}
      <select class="c-filter-sheet__event">
        <option value="">${t('search.allEvents')}</option>
        ${options.events.map((e) => html`<option value="${e.slug}"${selectedAttr(e.slug, state.event)}>${e.name}</option>`)}
      </select>
    </label>
    <label class="c-filter-sheet__field">
      ${t('search.accountLabel')}
      <select class="c-filter-sheet__account">
        <option value="">${t('search.allAccounts')}</option>
        ${options.accounts.map((a) => html`<option value="${a.handle}"${selectedAttr(a.handle, state.account)}>@${a.handle}</option>`)}
      </select>
    </label>
    ${options.clients.length > 0 ? html`
      <label class="c-filter-sheet__field">
        ${t('search.clientLabel')}
        <select class="c-filter-sheet__client">
          <option value="">${t('search.allClients')}</option>
          ${options.clients.map((c) => html`<option value="${c.id}"${selectedAttr(c.id, state.client)}>${c.name}</option>`)}
        </select>
      </label>
    ` : ''}
  `;
}

/** @param {import('../state/searchState.js').State} state */
function datesSection(state) {
  return html`
    <label class="c-filter-sheet__field">${t('search.fromLabel')}
      <input class="c-filter-sheet__from" type="date" value="${state.from ?? ''}">
    </label>
    <label class="c-filter-sheet__field">${t('search.toLabel')}
      <input class="c-filter-sheet__to" type="date" value="${state.to ?? ''}">
    </label>
  `;
}

/**
 * @param {{ state: import('../state/searchState.js').State, options: import('../../../src/http/contracts.js').FilterOptions, count: number }} props
 * @returns {import('../core/html.js').SafeHtml}
 */
export function render({ state, options, count }) {
  return html`
    <dialog class="c-filter-sheet" aria-label="${t('search.filters')}">
      <button type="button" class="c-filter-sheet__close" aria-label="${t('search.closeFilters')}">✕</button>
      <h2 class="c-filter-sheet__title">${t('search.filters')}</h2>
      ${peopleSection(options.people, state)}
      ${typesSection(options.categories, state)}
      <div class="c-filter-sheet__selects">${selectsSection(options, state)}${datesSection(state)}</div>
      <button type="button" class="c-filter-sheet__apply">${t('search.showN', { n: count })}</button>
    </dialog>
  `;
}

/** @param {{ classList: { toggle: Function }, setAttribute: Function }} chip @param {boolean} on_ */
function setChipOn(chip, on_) {
  chip.classList.toggle('c-chips__chip--on', on_);
  chip.setAttribute('aria-pressed', String(on_));
}

/** @typedef {{ get: () => import('../state/searchState.js').State, set: (s: import('../state/searchState.js').State) => void }} Store */

/**
 * Toggles one multi-select chip group (people or types): updates the
 * tentative state via `withFilter`/`withoutFilter`, syncs just the
 * clicked chip's own state (never a full re-render -- keeps focus where
 * the user left it), and reports the change.
 * @param {Element|null} groupEl @param {{ field: keyof import('../state/searchState.js').State, parse: (v: string) => unknown }} spec
 * @param {Store} store @param {() => void} onEdit
 */
function bindToggleGroup(groupEl, spec, store, onEdit) {
  if (!groupEl) return;
  on(groupEl, '.c-chips__chip', 'click', (_e, chip) => {
    const value = spec.parse(chip.getAttribute('data-value') ?? '');
    const state = store.get();
    const already = /** @type {unknown[]} */ (state[spec.field]).includes(value);
    store.set(already ? withoutFilter(state, spec.field, value) : withFilter(state, spec.field, value));
    setChipOn(chip, !already);
    onEdit();
  });
}

/**
 * The any/all mode toggle: a single-select chip pair, so picking one
 * also turns the other off (unlike the multi-select groups above).
 * @param {Element|null} modeEl @param {Store} store @param {() => void} onEdit
 */
function bindModeToggle(modeEl, store, onEdit) {
  if (!modeEl) return;
  on(modeEl, '.c-chips__chip', 'click', (_e, chip) => {
    const value = chip.getAttribute('data-value');
    store.set({ ...store.get(), peopleMode: value === 'all' ? 'all' : 'any' });
    for (const c of modeEl.querySelectorAll('.c-chips__chip')) setChipOn(c, c.getAttribute('data-value') === value);
    onEdit();
  });
}

const FIELD_CONTROLS = [
  ['.c-filter-sheet__event', 'event'], ['.c-filter-sheet__account', 'account'], ['.c-filter-sheet__client', 'client'],
  ['.c-filter-sheet__from', 'from'], ['.c-filter-sheet__to', 'to'],
];

/** @param {Element} el @param {Store} store @param {() => void} onEdit */
function bindFieldControls(el, store, onEdit) {
  for (const [selector, field] of FIELD_CONTROLS) {
    on(el, selector, 'change', (_e, control) => {
      const raw = /** @type {HTMLInputElement} */ (control).value;
      const value = field === 'client' ? (raw ? Number(raw) : undefined) : (raw || undefined);
      store.set({ ...store.get(), [field]: value });
      onEdit();
    });
  }
}

/**
 * @param {{ focus?: Function }|null} opener @param {Element} dialog
 * @returns {() => void}
 */
function makeClose(opener, dialog) {
  return () => {
    /** @type {any} */ (dialog).close?.();
    if (opener && 'focus' in opener) /** @type {any} */ (opener).focus();
  };
}

/**
 * @param {Element} el
 * @param {{ state: import('../state/searchState.js').State, options?: import('../../../src/http/contracts.js').FilterOptions,
 *   onChange: (s: import('../state/searchState.js').State) => void, opener?: { focus?: Function }|null,
 *   onTentativeChange?: (s: import('../state/searchState.js').State) => void }} props
 *   `onTentativeChange`: fired on every edit, before Apply, with the not-yet-committed state --
 *   so the page can keep the filter icon's own badge live while the sheet is still open.
 * @returns {void}
 */
export function bind(el, { state, options = { people: [], categories: [], clients: [], events: [], accounts: [] }, onChange, opener = null, onTentativeChange }) {
  const dialog = el.querySelector('.c-filter-sheet') ?? el;
  chips.bind(el);
  let tentative = state;
  /** @type {Store} */
  const store = { get: () => tentative, set: (next) => { tentative = next; } };
  const closeDialog = makeClose(opener, dialog);
  // Escape/the close button discard the tentative edits: the badge's live
  // preview (onEdit, below) reverts to the still-committed `state`.
  const cancel = () => { closeDialog(); onTentativeChange?.(state); };

  // Guards against a stale count response landing after a newer edit's
  // (whichever order the two responses actually arrive in) -- review
  // round 1, I1.
  let seq = 0;
  const refreshCount = async () => {
    const mySeq = ++seq;
    try {
      const { count } = await getJson('/api/search', { ...toApiParams(tentative, options), limit: 0 });
      if (mySeq !== seq) return;
      const applyBtn = dialog.querySelector('.c-filter-sheet__apply');
      if (applyBtn) applyBtn.textContent = t('search.showN', { n: count });
    } catch {
      // best-effort live preview only: a failed count fetch just leaves the button's last text alone
    }
  };
  const onEdit = () => { onTentativeChange?.(tentative); refreshCount(); };

  bindToggleGroup(dialog.querySelector('.c-filter-sheet__people'), { field: 'people', parse: Number }, store, onEdit);
  bindToggleGroup(dialog.querySelector('.c-filter-sheet__types'), { field: 'types', parse: (v) => v }, store, onEdit);
  bindModeToggle(dialog.querySelector('.c-filter-sheet__mode'), store, onEdit);
  bindFieldControls(dialog, store, onEdit);

  on(el, '.c-filter-sheet__apply', 'click', () => { onChange(tentative); closeDialog(); });
  on(el, '.c-filter-sheet__close', 'click', cancel);
  on(el, 'dialog', 'keydown', (e) => { if (e.key === 'Escape') cancel(); });
}
