// @ts-check
/**
 * The speaker picker behind every marker dropdown and the line-fix sheet
 * (Plan 2a Task 13): known people first (with their IG handle), a search
 * box that filters them, "＋ add a new person" (POST /api/people through
 * the page's callback), then the generic roles. The owner's mockups order
 * it this way and the spec keeps that order.
 *
 * `bind()` only reports a choice; the caller owns storage, re-preview and
 * re-render. The one network call is the caller's `onNewPerson`.
 */
import { html } from '../core/html.js';
import { on } from '../core/dom.js';
import { t } from '../core/site.js';

/** @typedef {{ id: number, displayName: string, emoji: string, igHandle: string|null }} PersonOption */
/** @typedef {{ person: number }|{ role: string }} Speaker */
/** @typedef {{ people: PersonOption[], roles: string[] }} Options */

/**
 * @param {PersonOption} person
 * @param {Speaker|null} current
 * @returns {import('../core/html.js').SafeHtml}
 */
function personOption(person, current) {
  const on = current !== null && 'person' in current && current.person === person.id;
  const search = `${person.displayName} ${person.igHandle ?? ''}`.toLowerCase();
  return html`
    <button type="button" class="c-person-picker__option${on ? ' c-person-picker__option--on' : ''}"
      data-pick-person="${person.id}" data-search="${search}" aria-pressed="${on ? 'true' : 'false'}">
      <span class="c-person-picker__emoji" aria-hidden="true">${person.emoji}</span>
      <span class="c-person-picker__name">${person.displayName}</span>
      ${person.igHandle ? html`<small class="c-person-picker__handle">@${person.igHandle}</small>` : ''}
    </button>
  `;
}

/**
 * @param {{ options: Options, current?: Speaker|null, idPrefix: string }} props
 *   `idPrefix`: makes the search box's label unique when two pickers are
 *   on one page (a marker's and the line sheet's).
 * @returns {import('../core/html.js').SafeHtml}
 */
export function render({ options, current = null, idPrefix }) {
  const searchId = `${idPrefix}-search`;
  return html`
    <div class="c-person-picker">
      <p class="c-person-picker__group">${t('add.knownPeople')}</p>
      <div class="c-person-picker__list">
        ${options.people.map((person) => personOption(person, current))}
      </div>
      <label class="c-person-picker__search-label" for="${searchId}">${t('add.searchPeople')}</label>
      <input class="c-person-picker__search" id="${searchId}" type="search" autocomplete="off" data-picker-search
        placeholder="${t('add.searchPeople')}">
      <p class="c-person-picker__group">${t('add.notListed')}</p>
      <form class="c-person-picker__new" data-new-person>
        <p class="c-person-picker__new-title">${t('add.newPerson')}</p>
        <label class="c-person-picker__new-label" for="${idPrefix}-name">${t('add.newPersonName')}</label>
        <input class="c-person-picker__new-input" id="${idPrefix}-name" name="name" type="text" maxlength="30" required autocomplete="off" data-new-name>
        <label class="c-person-picker__new-label" for="${idPrefix}-handle">${t('add.newPersonHandle')}</label>
        <input class="c-person-picker__new-input" id="${idPrefix}-handle" name="handle" type="text" maxlength="31" required autocomplete="off" data-new-handle>
        <button class="c-person-picker__add" type="submit">${t('add.addPerson')}</button>
      </form>
      <p class="c-person-picker__group">${t('add.generic')}</p>
      <div class="c-person-picker__roles">
        ${options.roles.map((role) => {
          const onRole = current !== null && 'role' in current && current.role === role;
          return html`<button type="button" class="c-person-picker__option${onRole ? ' c-person-picker__option--on' : ''}"
            data-pick-role="${role}" aria-pressed="${onRole ? 'true' : 'false'}">${t(`add.role.${role}`)}</button>`;
        })}
      </div>
      <p class="c-person-picker__error" role="alert" data-new-error hidden>${t('add.personFailed')}</p>
    </div>
  `;
}

/**
 * Wires the search filter, the person/role buttons and the new-person
 * form. `onNewPerson` resolves to the created (or existing) person's id;
 * a rejection shows `add.personFailed` in place.
 * @param {Element} el
 * @param {{ onPick: (speaker: Speaker) => void, onNewPerson: (input: { displayName: string, igHandle: string }) => Promise<{ id: number }> }} ctx
 * @returns {void}
 */
export function bind(el, { onPick, onNewPerson }) {
  el.querySelector('[data-picker-search]')?.addEventListener('input', (event) => {
    const input = /** @type {HTMLInputElement} */ (event.target);
    const q = input.value.trim().toLowerCase();
    for (const option of el.querySelectorAll('[data-pick-person]')) {
      const hay = String(option.getAttribute('data-search') ?? '');
      /** @type {HTMLElement} */ (option).hidden = q.length > 0 && !hay.includes(q);
    }
  });
  on(el, '[data-pick-person]', 'click', (_e, target) => {
    onPick({ person: Number(target.getAttribute('data-pick-person')) });
  });
  on(el, '[data-pick-role]', 'click', (_e, target) => {
    const role = target.getAttribute('data-pick-role');
    if (role) onPick({ role });
  });
  on(el, '[data-new-person]', 'submit', async (event) => {
    event.preventDefault();
    const form = /** @type {HTMLFormElement} */ (event.target);
    const name = /** @type {HTMLInputElement} */ (form.querySelector('[data-new-name]'));
    const handle = /** @type {HTMLInputElement} */ (form.querySelector('[data-new-handle]'));
    const error = el.querySelector('[data-new-error]');
    if (error) /** @type {HTMLElement} */ (error).hidden = true;
    try {
      const person = await onNewPerson({ displayName: name.value.trim(), igHandle: handle.value.trim() });
      onPick({ person: person.id });
    } catch {
      if (error) /** @type {HTMLElement} */ (error).hidden = false;
    }
  });
}
