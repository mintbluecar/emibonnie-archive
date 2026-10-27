// @ts-check
/**
 * The add and edit forms' one piece of pure data (Plan 2a Task 13):
 * turning the two pages' choices into the request bodies Tasks 9 and 10
 * take, and applying a line fix immutably. No DOM, no network, no
 * components -- both pages and their tests share these rules, so the edit
 * page can never disagree with the add page about what "the same steps 2
 * and 3" send.
 */

/** The select value that means "type a new one" (owner only). */
export const NEW = '__new';

/**
 * @typedef {{ marker: string, count: number }} Marker
 * @typedef {{ person: number }|{ role: string }} Speaker
 * @typedef {{ part: number, line: number, as: 'plain' }
 *   | { part: number, line: number, as: 'speech', speaker: Speaker }} LineFix
 * @typedef {{
 *   placement: string, eventMode: string, eventName: string,
 *   categoryPick: string, categoryNew: string,
 *   clientPick: string, clientNew: string, subbed: boolean,
 * }} Choices
 *   `eventMode`: `'match'` (the preview's matched event), `'new'` (a new
 *   event, titled by `eventName`), or `'event:<id>'` (an existing one from
 *   the picker). `categoryPick`/`clientPick`: a list value, `''` for none,
 *   or `NEW` while a new name is being typed into `categoryNew`/`clientNew`.
 * @typedef {{ link: string, chosen: Record<string, Speaker>, choices: Choices, lineFixes: LineFix[] }} Form
 */

/**
 * Step 2's defaults from a ready preview's draft.
 * @param {any} draft
 * @returns {Choices}
 */
export function choicesFromDraft(draft) {
  return {
    placement: draft.common.placement,
    eventMode: draft.common.eventId === null || draft.common.eventId === undefined ? 'new' : 'match',
    eventName: draft.common.proposal?.name ?? '',
    categoryPick: draft.common.categoryName ?? '',
    categoryNew: '',
    clientPick: draft.common.clientName ?? '',
    clientNew: '',
    subbed: draft.subbed === true,
  };
}

/**
 * The edit page's step 2 defaults. The saved item's event is an explicit
 * `event:<id>` (there is no match to fall back on), and a saved item
 * cannot create an event from here: `POST …/edit` takes an existing
 * `eventId` only.
 * @param {{placement: string, eventId: number|null, categoryName: string|null, clientName: string|null, subbed: boolean}} fields
 * @returns {Choices}
 */
export function choicesFromFields(fields) {
  return {
    placement: fields.placement,
    eventMode: fields.eventId === null ? '' : `event:${fields.eventId}`,
    eventName: '',
    categoryPick: fields.categoryName ?? '',
    categoryNew: '',
    clientPick: fields.clientName ?? '',
    clientNew: '',
    subbed: fields.subbed === true,
  };
}

/** @param {Choices} choices @param {'category'|'client'} which @returns {string|null} */
function lookupOf(choices, which) {
  const pick = which === 'category' ? choices.categoryPick : choices.clientPick;
  const typed = which === 'category' ? choices.categoryNew : choices.clientNew;
  const name = pick === NEW ? typed.trim() : pick;
  return name.length > 0 ? name : null;
}

/** @param {Choices} choices @returns {number|null} */
export function eventIdOf(choices) {
  return choices.eventMode.startsWith('event:') ? Number(choices.eventMode.slice('event:'.length)) : null;
}

/**
 * `overrides` for a preview or add (Task 8's `DraftOverrides`). A
 * placement other than `event` never carries an event, so switching to
 * post cannot leave a stale `eventId` behind.
 * @param {Choices} choices
 * @returns {Record<string, unknown>}
 */
export function overridesOf(choices) {
  /** @type {Record<string, unknown>} */
  const overrides = { placement: choices.placement };
  if (choices.placement === 'event') {
    const eventId = eventIdOf(choices);
    if (eventId !== null) overrides.eventId = eventId;
    else if (choices.eventMode === 'new') {
      overrides.newEvent = true;
      const name = choices.eventName.trim();
      if (name.length > 0) overrides.eventName = name;
    }
  }
  const categoryName = lookupOf(choices, 'category');
  if (categoryName) overrides.categoryName = categoryName;
  const clientName = lookupOf(choices, 'client');
  if (clientName) overrides.clientName = clientName;
  return overrides;
}

/**
 * `POST /api/add`'s body (and `POST /api/add/preview`'s, which ignores
 * `subbed`-only additions by re-drafting the same way).
 * @param {Form} form
 * @returns {{ url: string, chosen: Record<string, Speaker>, overrides: Record<string, unknown>, lineFixes: LineFix[], subbed: boolean }}
 */
export function bodyOf(form) {
  return {
    url: form.link, chosen: form.chosen, overrides: overridesOf(form.choices),
    lineFixes: form.lineFixes, subbed: form.choices.subbed,
  };
}

/** @param {LineFix} fix @returns {string} */
function fixKey(fix) {
  return `${fix.part}:${fix.line}`;
}

/**
 * `fixes` with `fix` replacing any fix for the same line (a line has one
 * answer, never two). New fixes go last; order otherwise stays as it was.
 * @param {LineFix[]} fixes @param {LineFix} fix
 * @returns {LineFix[]}
 */
export function withLineFix(fixes, fix) {
  return [...fixes.filter((existing) => fixKey(existing) !== fixKey(fix)), fix];
}

/** The components' `data-field` names, mapped to the `Choices` key each one sets. */
const FIELD_KEYS = Object.freeze({
  placement: 'placement', event: 'eventMode', eventName: 'eventName',
  category: 'categoryPick', client: 'clientPick', categoryNew: 'categoryNew', clientNew: 'clientNew',
});

/**
 * `choices` with one raw form field applied, as a new object. Both the add
 * and the edit page take their fields straight from the components'
 * `data-field` names, so neither can disagree about what a field sets.
 * @param {Choices} choices @param {string} field @param {string|boolean} value
 * @returns {Choices}
 */
export function withField(choices, field, value) {
  if (field === 'subbed') return { ...choices, subbed: value === true };
  if (!Object.hasOwn(FIELD_KEYS, field)) return choices;
  return { ...choices, [FIELD_KEYS[/** @type {keyof typeof FIELD_KEYS} */ (field)]]: String(value) };
}

/**
 * The fields whose change reveals another input (a new-event title, a new
 * type/client name), so the page must re-render at once, not just re-preview.
 */
export const REVEALS_INPUT = Object.freeze(['placement', 'event', 'category', 'client']);

/**
 * The falsy-safe replacement for `Array.prototype.find` on fixes,
 * keyed by part and line.
 * @param {LineFix[]} fixes @param {number} part @param {number} line
 * @returns {LineFix|undefined}
 */
export function fixOf(fixes, part, line) {
  return fixes.find((fix) => fix.part === part && fix.line === line);
}

/**
 * `POST …/edit`'s `{ changes }`: only the fields the visitor actually
 * changed, so the server's "nothing to change" refusal means what it says.
 * @param {any} fields the saved `EditableFields`
 * @param {{ choices: Choices, chosen: Record<string, Speaker>, lineFixes: LineFix[] }} form
 * @returns {Record<string, unknown>}
 */
export function changesOf(fields, { choices, chosen, lineFixes }) {
  /** @type {Record<string, unknown>} */
  const changes = {};
  if (choices.placement !== fields.placement) changes.placement = choices.placement;
  const eventId = eventIdOf(choices);
  if (choices.placement === 'event' && eventId !== null && eventId !== fields.eventId) changes.eventId = eventId;
  const categoryName = lookupOf(choices, 'category');
  if (categoryName !== fields.categoryName) changes.categoryName = categoryName;
  const clientName = lookupOf(choices, 'client');
  if (clientName !== fields.clientName) changes.clientName = clientName;
  if (choices.subbed !== fields.subbed) changes.subbed = choices.subbed;
  const speakers = { ...fields.speakers, ...chosen };
  if (JSON.stringify(speakers) !== JSON.stringify(fields.speakers)) changes.speakers = speakers;
  if (JSON.stringify(lineFixes) !== JSON.stringify(fields.lineFixes)) changes.lineFixes = lineFixes;
  return changes;
}
