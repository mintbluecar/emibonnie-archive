// @ts-check
/**
 * The speaker answer in one import marker row (or one entry behind
 * "review"): a select of the known people, "＋ add a new person" (its
 * name and IG handle fields open under the select, and saving creates
 * them through `POST /api/people` first), "not a speaker" (the marker's
 * lines read as plain text), then the roles.
 */
import { html } from '../core/html.js';
import { on } from '../core/dom.js';
import { t, site } from '../core/site.js';
import { menuOption, personOption } from '../core/menuOption.js';
import { ROLE_EMOJI } from '../../../src/domain/constants.js';

/**
 * @typedef {{ id: number, displayName: string, emoji: string, igHandle?: string|null }} Person
 * @typedef {{ people: Person[], roles: string[] }} Catalogue
 * @typedef {{ person: number }|{ role: string }|{ plain: true }} Answer
 * @typedef {(input: { displayName: string, igHandle: string }) => Promise<{ id: number }>} CreatePerson
 */

/** The select value that opens the new-person fields. */
const NEW_PERSON = 'new';
/** The select value for "not a speaker". */
const NOT_SPEAKER = 'plain';

/**
 * An id fragment for a row: its parts joined, a marker's characters as
 * code points (an emoji isn't welcome in an id).
 * @param {(string|number|null)[]} parts
 */
export function rowId(parts) {
  return parts.map((part) => [...String(part)].map((ch) => ch.codePointAt(0)?.toString(16)).join('_')).join('-');
}

/**
 * A role's emoji in the dropdown: the site's default for it (`roleEmoji`
 * over `ROLE_EMOJI`), and for crowd -- which has none, as it shows as a
 * note, not a speaker -- a crowd, here only.
 * @param {string} role
 */
const roleEmojiOf = (role) => /** @type {Record<string, string|undefined>} */ ({ crowd: '👥', ...ROLE_EMOJI, .../** @type {Record<string, string>} */ (site.roleEmoji ?? {}) })[role] ?? '';

/** @param {{ name: string }} a @param {{ name: string }} b */
const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

/**
 * The select, searchable: its "choose" placeholder (never listed), the
 * two actions -- not a speaker, a new person -- then the roles, then the
 * known people, each A to Z by what they show. Values: `''`,
 * `person:<id>`, `new`, `plain`, `role:<name>`.
 * @param {Catalogue} catalogue
 * @param {{ attr: string, value: string, label: string }} field
 */
export function speakerSelect(catalogue, { attr, value, label }) {
  const roles = catalogue.roles.map((role) => {
    const name = t(`add.role.${role}`);
    return { name, option: menuOption(`role:${role}`, name, { lead: roleEmojiOf(role) }) };
  }).sort(byName);
  const people = catalogue.people
    .map((person) => ({ name: person.displayName, option: personOption(`person:${person.id}`, person) }))
    .sort(byName);
  const speakers = [...roles, ...people];
  return html`<div class="field c-import-speakers__pick"><span class="field__select"><select ${attr}="${value}" aria-label="${label}"
    data-speaker-select data-menu-search="${t('import.marker.search')}">
    <option value="" hidden>${t('import.marker.choose')}</option>
    <option value="${NOT_SPEAKER}" data-action>${t('import.marker.notSpeaker')}</option>
    <option value="${NEW_PERSON}" data-action>${t('import.marker.newPerson')}</option>
    ${speakers.map((s) => s.option)}
  </select></span></div>`;
}

/**
 * The new person's name and handle, hidden until the row's select asks
 * for them.
 * @param {string} id a `rowId()`, unique on the page
 */
export function newPersonFields(id) {
  return html`<div class="cluster cluster--2 c-import-speakers__new" data-new-person hidden>
    <div class="field">
      <label class="field__label" for="imp-name-${id}">${t('add.newPersonName')}</label>
      <input id="imp-name-${id}" type="text" maxlength="30" autocomplete="off" data-new-name>
    </div>
    <div class="field">
      <label class="field__label" for="imp-handle-${id}">${t('add.newPersonHandle')}</label>
      <input id="imp-handle-${id}" type="text" maxlength="31" autocomplete="off" data-new-handle>
    </div>
  </div>`;
}

/** @param {Element} row @param {string} selector */
function inputValue(row, selector) {
  return /** @type {HTMLInputElement|null} */ (row.querySelector(selector))?.value.trim() ?? '';
}

/** Opens a row's new-person fields while its select says "new". @param {Element} root */
export function bindPick(root) {
  on(root, '[data-speaker-select]', 'change', (_event, select) => {
    const row = select.closest('li');
    const fields = /** @type {HTMLElement|null} */ (row?.querySelector('[data-new-person]') ?? null);
    if (fields) fields.hidden = /** @type {HTMLSelectElement} */ (select).value !== NEW_PERSON;
  });
}

/**
 * What a row's select answers, creating the new person first when that
 * is the choice; null when nothing was chosen. A new person with no
 * name or handle rejects, as `createPerson` does on a bad handle.
 * @param {Element} row @param {string} selectSelector @param {CreatePerson} createPerson
 * @returns {Promise<Answer|null>}
 */
export async function answerOf(row, selectSelector, createPerson) {
  const value = /** @type {HTMLSelectElement|null} */ (row.querySelector(selectSelector))?.value ?? '';
  if (value.startsWith('person:')) return { person: Number(value.slice('person:'.length)) };
  if (value.startsWith('role:')) return { role: value.slice('role:'.length) };
  if (value === NOT_SPEAKER) return { plain: true };
  if (value !== NEW_PERSON) return null;
  const displayName = inputValue(row, '[data-new-name]');
  const igHandle = inputValue(row, '[data-new-handle]');
  if (displayName === '' || igHandle === '') throw new Error('a new person needs a name and a handle');
  const person = await createPerson({ displayName, igHandle });
  return { person: person.id };
}
