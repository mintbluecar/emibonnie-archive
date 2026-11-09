// @ts-check
/**
 * The edit event page's field set (event editing, spec screen ②), the
 * same in its three modes: title, date, keywords and hashtags (chips to
 * remove, a box to add), the address (one of the hashtags, or the title,
 * with the `/e/<date>/<tag>` it saves to; disabled once the address is
 * locked), and the live people and platform.
 *
 * `render(store)` is pure. `bind(el, store)` is delegated on `el` once:
 * each edit replaces `store.fields` (through `state/eventFormState.js`)
 * and repaints only the part it changed, so the box being typed in keeps
 * its focus. The page owns `store` and reads `store.fields` to save.
 */
import { html } from '../core/html.js';
import { mount, on } from '../core/dom.js';
import { t } from '../core/site.js';
import { personOption } from '../core/menuOption.js';
import { eventHref } from '../core/routes.js';
import {
  addressPreview, withPersonAdded, withPersonRemoved, withTagAdded, withTagRemoved,
} from '../state/eventFormState.js';

/**
 * @typedef {import('../state/eventFormState.js').EventFields} EventFields
 * @typedef {import('../../../src/http/contracts.js').EventPersonOption} PersonOption
 * @typedef {import('../../../src/http/contracts.js').EventPlatformOption} PlatformOption
 * @typedef {{ fields: EventFields, options: { people: PersonOption[], platforms: PlatformOption[] },
 *   address: { locked: boolean, slug: string }, hints: { date?: string, tags?: string } }} FormStore
 *   `address`: the event whose address is saved (the kept one in a merge);
 *   `hints`: the mode's own notes under the date and the tags, already in words.
 * @typedef {import('../core/html.js').SafeHtml} SafeHtml
 */

const ID = 'c-event-form';

/** @param {string} label @param {'keyword'|'hashtag'} kind @param {string} tag @returns {SafeHtml} */
function tagChip(label, kind, tag) {
  const name = t('adminEventEdit.tagRemove', { label });
  return html`<button type="button" class="chip chip--on" data-action="tag-remove" data-kind="${kind}" data-tag="${tag}"
    title="${name}" aria-label="${name}">${label} <span aria-hidden="true">✕</span></button>`;
}

/** The keyword and hashtag chips. @param {EventFields} fields @returns {SafeHtml} */
function tagList(fields) {
  if (fields.keywords.length + fields.hashtags.length === 0) return html`<span class="meta">${t('adminEventEdit.tagsNone')}</span>`;
  return html`${fields.keywords.map((k) => tagChip(k, 'keyword', k))}${fields.hashtags.map((h) => tagChip(`#${h}`, 'hashtag', h))}`;
}

/** @param {string} value @param {string} label @param {boolean} chosen @returns {SafeHtml} */
const option = (value, label, chosen) => html`<option value="${value}"${chosen ? ' selected' : ''}>${label}</option>`;

/** The address choice and what it saves to (or, locked, the address it keeps). @param {FormStore} store @returns {SafeHtml} */
function addressControl({ fields, address }) {
  const note = address.locked
    ? t('adminEventEdit.addressLocked', { path: eventHref(address.slug) })
    : t('adminEventEdit.addressPreview', { path: addressPreview(fields) });
  return html`
    <label class="field__label" for="${ID}-address">${t('adminEventEdit.address')}</label>
    <span class="field__select"><select id="${ID}-address" data-event-address aria-describedby="${ID}-address-note"${address.locked ? ' disabled' : ''}>
      ${fields.hashtags.map((h) => option(h, `#${h}`, fields.addressTag === h))}
      ${option('', t('adminEventEdit.addressTitle'), fields.addressTag === '')}
    </select></span>
    <p class="field__hint" id="${ID}-address-note" data-event-address-preview>${note}</p>
  `;
}

/** The live people's chips. @param {FormStore} store @returns {SafeHtml} */
function peopleList({ fields, options }) {
  const live = options.people.filter((p) => fields.livePeopleIds.includes(p.id));
  if (live.length === 0) return html`<span class="meta">${t('adminEventEdit.peopleNone')}</span>`;
  return html`${live.map((p) => {
    const name = t('adminEventEdit.personRemove', { name: p.displayName });
    return html`<button type="button" class="chip chip--on" data-action="person-remove" data-person="${p.id}"
      title="${name}" aria-label="${name}">${p.displayName} <span aria-hidden="true">✕</span></button>`;
  })}`;
}

/** The people not yet live, to add. @param {FormStore} store @returns {SafeHtml} */
function personChoices({ fields, options }) {
  const others = options.people.filter((p) => !fields.livePeopleIds.includes(p.id));
  return html`${option('', t('adminEventEdit.personAdd'), true)}${others.map((p) => personOption(String(p.id), p))}`;
}

/** @param {FormStore} store @returns {SafeHtml} */
function liveFields(store) {
  const code = store.fields.livePlatformCode;
  return html`
    <div class="field">
      <span class="field__label" id="${ID}-people">${t('adminEventEdit.people')}</span>
      <div class="cluster cluster--2" role="group" aria-labelledby="${ID}-people" data-event-people>${peopleList(store)}</div>
      <span class="field__select"><select data-event-person-add aria-label="${t('adminEventEdit.personAdd')}">${personChoices(store)}</select></span>
    </div>
    <div class="field">
      <label class="field__label" for="${ID}-platform">${t('adminEventEdit.platform')}</label>
      <span class="field__select"><select id="${ID}-platform" data-event-platform>
        ${option('', t('adminEventEdit.platformNone'), code === null)}
        ${store.options.platforms.map((p) => option(p.code, p.name, p.code === code))}
      </select></span>
    </div>
  `;
}

/** @param {string} id @param {string|undefined} hint @returns {SafeHtml} */
const hintOf = (id, hint) => (hint ? html`<p class="field__hint" id="${id}">${hint}</p>` : html``);

/** @param {FormStore} store @returns {SafeHtml} */
export function render(store) {
  const { fields, hints } = store;
  return html`
    <div class="c-event-form stack stack--4" data-event-form>
      <div class="field">
        <label class="field__label" for="${ID}-name">${t('adminEventEdit.name')}</label>
        <input id="${ID}-name" type="text" data-event-name value="${fields.name}" maxlength="120" required
          placeholder="${t('adminEventEdit.namePlaceholder')}" autocomplete="off">
      </div>
      <div class="field c-event-form__date">
        <label class="field__label" for="${ID}-date">${t('adminEventEdit.date')}</label>
        <input id="${ID}-date" type="date" data-event-date value="${fields.occurredOn}" required${hints.date ? html` aria-describedby="${ID}-date-hint"` : ''}>
        ${hintOf(`${ID}-date-hint`, hints.date)}
      </div>
      <div class="field">
        <span class="field__label" id="${ID}-tags">${t('adminEventEdit.tags')}</span>
        ${hintOf(`${ID}-tags-hint`, hints.tags)}
        <div class="cluster cluster--2" role="group" aria-labelledby="${ID}-tags" data-event-tag-list>${tagList(fields)}</div>
        <div class="c-event-form__add">
          <input type="text" data-event-tag-input aria-label="${t('adminEventEdit.tagAdd')}" placeholder="${t('adminEventEdit.tagAdd')}" autocomplete="off">
          <button class="btn btn--secondary" type="button" data-action="tag-add">${t('adminEventEdit.tagAddButton')}</button>
        </div>
      </div>
      <div class="field" data-event-address-slot>${addressControl(store)}</div>
      ${liveFields(store)}
    </div>
  `;
}

/** @param {Element} el @param {string} selector @param {SafeHtml} markup */
function repaint(el, selector, markup) {
  const slot = el.querySelector(selector);
  if (slot) mount(slot, markup);
}

/** @param {Element} el @param {FormStore} store */
function repaintTags(el, store) {
  repaint(el, '[data-event-tag-list]', tagList(store.fields));
  repaint(el, '[data-event-address-slot]', addressControl(store));
}

/** @param {Element} el @param {FormStore} store */
function repaintPeople(el, store) {
  repaint(el, '[data-event-people]', peopleList(store));
  repaint(el, '[data-event-person-add]', personChoices(store));
}

/** @param {Element} el @param {FormStore} store */
function addTypedTag(el, store) {
  const input = /** @type {HTMLInputElement|null} */ (el.querySelector('[data-event-tag-input]'));
  if (!input) return;
  store.fields = withTagAdded(store.fields, input.value);
  input.value = '';
  repaintTags(el, store);
}

/** @param {Element} el @param {FormStore} store @param {Partial<EventFields>} change */
function typed(el, store, change) {
  store.fields = { ...store.fields, ...change };
  const note = el.querySelector('[data-event-address-preview]');
  if (note && !store.address.locked) note.textContent = t('adminEventEdit.addressPreview', { path: addressPreview(store.fields) });
}

/** @param {Element} el @param {FormStore} store @returns {void} */
export function bind(el, store) {
  /** @param {any} node */
  const value = (node) => String(node.value ?? '');
  on(el, '[data-event-name]', 'input', (_e, node) => typed(el, store, { name: value(node) }));
  on(el, '[data-event-date]', 'input', (_e, node) => typed(el, store, { occurredOn: value(node) }));
  on(el, '[data-event-address]', 'change', (_e, node) => typed(el, store, { addressTag: value(node) }));
  on(el, '[data-event-platform]', 'change', (_e, node) => { store.fields = { ...store.fields, livePlatformCode: value(node) || null }; });
  on(el, '[data-action="tag-add"]', 'click', () => addTypedTag(el, store));
  on(el, '[data-event-tag-input]', 'keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addTypedTag(el, store); }
  });
  on(el, '[data-action="tag-remove"]', 'click', (_e, chip) => {
    const kind = chip.getAttribute('data-kind') === 'hashtag' ? 'hashtag' : 'keyword';
    store.fields = withTagRemoved(store.fields, kind, chip.getAttribute('data-tag') ?? '');
    repaintTags(el, store);
  });
  on(el, '[data-event-person-add]', 'change', (_e, node) => {
    const id = Number(value(node));
    if (id > 0) store.fields = withPersonAdded(store.fields, id);
    repaintPeople(el, store);
  });
  on(el, '[data-action="person-remove"]', 'click', (_e, chip) => {
    store.fields = withPersonRemoved(store.fields, Number(chip.getAttribute('data-person')));
    repaintPeople(el, store);
  });
}
