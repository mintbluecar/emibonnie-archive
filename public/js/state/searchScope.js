// @ts-check
/**
 * A scoped page's in-place search (Task 10d): the event, person and
 * translator pages search *within* themselves, so their own filter
 * (`event`, one of `people`, or `account`) is preset, shown as a
 * removable chip, and removing it searches the whole archive -- still
 * on that page. Pure, like `searchState.js`: no DOM, no network.
 *
 * The page's own URL carries the search (`/e/x?q=hi`), so a reload or a
 * shared link shows the same state. The preset filter is implied by the
 * page's path and left out of the query; once the visitor removes it,
 * `scope=all` says so, so a reload doesn't quietly bring it back.
 */
import { EMPTY_STATE, filterCount, parseState, toQuery } from './searchState.js';

/**
 * @typedef {{ field: 'event'|'people'|'account', value: string|number, label: string }} Scope
 *   `value`: the event slug, the person's id, or the translator handle.
 *   `label`: the chip's text until `/api/filters` has loaded.
 * @typedef {import('./searchState.js').State} State
 */

/** The query param (and value) that marks a removed preset filter. */
export const SCOPE_PARAM = 'scope';
const SCOPE_OFF = 'all';

/** @param {State} state @param {Scope|null} scope @returns {boolean} */
export function hasScope(state, scope) {
  if (!scope) return false;
  if (scope.field === 'people') return state.people.includes(Number(scope.value));
  return state[scope.field] === scope.value;
}

/** `state` with the page's own filter added (a no-op when it's there, or there's no scope). @param {State} state @param {Scope|null} scope @returns {State} */
export function withScope(state, scope) {
  if (!scope || hasScope(state, scope)) return state;
  if (scope.field === 'people') return { ...state, people: [Number(scope.value), ...state.people] };
  return { ...state, [scope.field]: String(scope.value) };
}

/** `state` without the page's own filter. @param {State} state @param {Scope|null} scope @returns {State} */
export function withoutScope(state, scope) {
  if (!scope || !hasScope(state, scope)) return state;
  if (scope.field === 'people') return { ...state, people: state.people.filter((id) => id !== Number(scope.value)) };
  return { ...state, [scope.field]: undefined };
}

/** What the page starts from: nothing typed, only its own filter. @param {Scope|null} scope @returns {State} */
export function presetState(scope) {
  return withScope(EMPTY_STATE, scope);
}

/**
 * The state a page URL's query carries. The preset filter comes back
 * unless `scope=all` says it was removed, or the query names a different
 * event/translator itself (a hand-edited link).
 * @param {URLSearchParams} params @param {Scope|null} scope
 * @returns {State}
 */
export function stateFromQuery(params, scope) {
  const state = parseState(params);
  if (!scope || params.get(SCOPE_PARAM) === SCOPE_OFF) return state;
  if (scope.field !== 'people' && state[scope.field] !== undefined) return state;
  return withScope(state, scope);
}

/**
 * `state` as the page's own query string: the preset filter left out
 * (the path implies it), `scope=all` when it was removed. The page's
 * starting state is an empty query, so its URL is just the path.
 * @param {State} state @param {Scope|null} scope
 * @returns {URLSearchParams}
 */
export function queryOf(state, scope) {
  const params = toQuery(withoutScope(state, scope));
  if (scope && !hasScope(state, scope)) params.set(SCOPE_PARAM, SCOPE_OFF);
  return params;
}

/**
 * What the page shows for `state`: its own `'list'` (nothing typed, no
 * filter beyond the page's own -- home: no filter at all), `'results'`,
 * or, on a scoped page whose own filter was removed with nothing typed
 * or added, a `'hint'` to type (fix round 1, M6: the page now searches
 * the whole archive, so its own list would be the wrong thing to show).
 * @param {State} state @param {Scope|null} scope
 * @returns {'list'|'hint'|'results'}
 */
export function viewOf(state, scope) {
  if (state.q !== '' || filterCount(withoutScope(state, scope)) > 0) return 'results';
  return scope && !hasScope(state, scope) ? 'hint' : 'list';
}

/** Whether the page shows its own list (`viewOf` is `'list'`). @param {State} state @param {Scope|null} scope @returns {boolean} */
export function showsList(state, scope) {
  return viewOf(state, scope) === 'list';
}

/**
 * Whether "clear all" has anything to clear: a filter beyond the page's
 * own, or the page's own one removed.
 * @param {State} state @param {Scope|null} scope
 * @returns {boolean}
 */
export function canClear(state, scope) {
  return filterCount(withoutScope(state, scope)) > 0 || (scope !== null && !hasScope(state, scope));
}

/** "clear all": back to the page's own filter, keeping what's typed. @param {State} state @param {Scope|null} scope @returns {State} */
export function cleared(state, scope) {
  return { ...presetState(scope), q: state.q };
}
