// @ts-check
/**
 * The in-place search's one piece of state (task-5-brief.md: "The URL is
 * the single source of truth"; Task 10d moved it from the old search
 * page onto home and the scoped pages). Pure: no DOM, no network, no
 * components -- the same discipline as `public/js/core/*` (ruling 1), so
 * this module is safe to import from both
 * `public/js/components/inlineSearch.js` and `filterSheet.js` without
 * ever reaching back into either. `searchScope.js` adds a scoped page's
 * own preset filter on top.
 *
 * Every function here is immutable: `withFilter`/`withoutFilter` return a
 * new `State`, never mutate the one they're given.
 */

/**
 * @typedef {{
 *   q: string, people: number[], peopleMode: 'any'|'all', types: string[],
 *   event: string|undefined, account: string|undefined, client: number|undefined,
 *   from: string|undefined, to: string|undefined,
 * }} State
 *   `types`: category names from `/api/filters`, plus the two placement
 *   chips `'shared story'` and `'posts'` (ruling 2). `client`: a `clients`
 *   row id (`clientId` on `/api/search`).
 */

/** @type {State} */
export const EMPTY_STATE = {
  q: '', people: [], peopleMode: 'any', types: [], event: undefined, account: undefined, client: undefined, from: undefined, to: undefined,
};

/** Fields that hold a list of values, rather than one scalar. */
const LIST_FIELDS = new Set(['people', 'types']);

/** The two type chips that aren't a category name (ruling 2). */
const PLACEMENT_BY_TYPE = { 'shared story': 'shared_story', posts: 'post' };

/** @param {string} value @returns {number|undefined} */
function positiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/** A plain `YYYY-MM-DD` that's also a real calendar date (mirrors `src/services/search.js`'s own `isDate`, which this layer can't import). */
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
/** @param {string} value @returns {boolean} */
function isValidDate(value) {
  return DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}
/** @param {string|null} value @returns {string|undefined} */
function dateOrUndefined(value) {
  return value && isValidDate(value) ? value : undefined;
}

/**
 * The `State` a search URL's query string carries. Unknown or
 * malformed values are dropped rather than thrown on, so a hand-edited
 * or stale URL degrades to "no filter" instead of a broken page --
 * including an invalid `from`/`to` (review round 1, I2). List fields
 * (`people`, `types`) are repeated params (`?people=1&people=2`, review
 * round 1, M3), read with `getAll`.
 * @param {URLSearchParams} params
 * @returns {State}
 */
export function parseState(params) {
  const clientRaw = params.get('client');
  return {
    q: params.get('q') ?? '',
    people: params.getAll('people').map(positiveInt).filter((n) => n !== undefined),
    peopleMode: params.get('peopleMode') === 'all' ? 'all' : 'any',
    types: params.getAll('types').filter(Boolean),
    event: params.get('event') ?? undefined,
    account: params.get('account') ?? undefined,
    client: clientRaw ? positiveInt(clientRaw) : undefined,
    from: dateOrUndefined(params.get('from')),
    to: dateOrUndefined(params.get('to')),
  };
}

/**
 * Drops any `types` entry that isn't a known category name (from
 * `options.categories`, `/api/filters`) or one of the two placement
 * chips -- so a stale or hand-edited URL's unknown type is neither
 * counted by `filterCount` nor shown as an active-filter chip (review
 * round 1, M3). Call once `options` is actually loaded.
 * @param {State} state @param {{ categories?: { id: number, name: string }[] }} options
 * @returns {State}
 */
export function sanitizeTypes(state, options) {
  const known = new Set([...(options.categories ?? []).map((c) => c.name), ...Object.keys(PLACEMENT_BY_TYPE)]);
  return { ...state, types: state.types.filter((type) => known.has(type)) };
}

/**
 * `state` as a URL query string, with every empty/default field left out
 * (so the canonical URL for no filters is just the page's path, not
 * `/?peopleMode=any&...`). List fields repeat the param (M3),
 * rather than comma-joining, so each value round-trips through
 * `parseState` untouched (a category name may itself contain a comma).
 * @param {State} state
 * @returns {URLSearchParams}
 */
export function toQuery(state) {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  for (const id of state.people) params.append('people', String(id));
  if (state.peopleMode === 'all') params.set('peopleMode', 'all');
  for (const type of state.types) params.append('types', type);
  if (state.event) params.set('event', state.event);
  if (state.account) params.set('account', state.account);
  if (state.client !== undefined) params.set('client', String(state.client));
  if (state.from) params.set('from', state.from);
  if (state.to) params.set('to', state.to);
  return params;
}

/**
 * How many filters are active -- never counts `q` (task-5-brief.md:
 * "filterCount(state) (doesn't count q)"). Each selected person and each
 * selected type counts on its own (so picking 2 people reads as "2
 * filters", not "1"); every set scalar filter counts once.
 * @param {Partial<State>} state
 * @returns {number}
 */
export function filterCount(state) {
  const scalars = ['event', 'account', 'client', 'from', 'to'];
  const listCount = (state.people?.length ?? 0) + (state.types?.length ?? 0);
  return listCount + scalars.filter((field) => state[/** @type {keyof State} */ (field)] !== undefined).length;
}

/**
 * `{ placements, categories }` for `state.types`: the two placement
 * chips map to `placements` values directly; any other type is a
 * category name, resolved to its id through `options.categories`
 * (`/api/filters`) -- a name with no matching category is dropped rather
 * than sent as garbage.
 * @param {string[]} types @param {{ categories?: { id: number, name: string }[] }} options
 * @returns {{ placements?: string, categories?: string }}
 */
function typeParams(types, options) {
  const placements = types.filter((t) => Object.hasOwn(PLACEMENT_BY_TYPE, t)).map((t) => PLACEMENT_BY_TYPE[/** @type {keyof typeof PLACEMENT_BY_TYPE} */ (t)]);
  const categoryIds = types
    .filter((t) => !Object.hasOwn(PLACEMENT_BY_TYPE, t))
    .map((name) => (options.categories ?? []).find((c) => c.name === name)?.id)
    .filter((id) => id !== undefined);
  return {
    ...(placements.length > 0 ? { placements: placements.join(',') } : {}),
    ...(categoryIds.length > 0 ? { categories: categoryIds.join(',') } : {}),
  };
}

/** @param {State} state @returns {Record<string, string>} */
function scalarParams(state) {
  /** @type {Record<string, string>} */
  const params = {};
  if (state.event) params.eventSlug = state.event;
  if (state.account) params.accountHandle = state.account;
  if (state.client !== undefined) params.clientId = String(state.client);
  if (state.from) params.from = state.from;
  if (state.to) params.to = state.to;
  return params;
}

/**
 * `state`'s 1:1 mapping onto `GET /api/search`'s own params (src/http/contracts.js,
 * src/routes/search.js). `options` is `/api/filters`' response, needed
 * only to resolve a category-name type to its id; omitted, a category
 * type is simply left out (safe, if less useful, default).
 * @param {State} state @param {{ categories?: { id: number, name: string }[] }} [options]
 * @returns {Record<string, string>}
 */
export function toApiParams(state, options = {}) {
  /** @type {Record<string, string>} */
  const params = { ...scalarParams(state), ...typeParams(state.types, options) };
  if (state.q) params.q = state.q;
  if (state.people.length > 0) params.people = state.people.join(',');
  if (state.peopleMode === 'all') params.peopleMode = 'all';
  return params;
}

/** `true` when nothing is typed or filtered (home then shows its event list; see `searchScope.showsList` for a scoped page). @param {State} state @returns {boolean} */
export function isBlank(state) {
  return state.q === '' && filterCount(state) === 0;
}

/**
 * Adds `value` to a list field (no duplicates), or sets a scalar field.
 * Always a new `State`; `state` itself is never modified.
 * @param {State} state @param {keyof State} field @param {unknown} value
 * @returns {State}
 */
export function withFilter(state, field, value) {
  if (LIST_FIELDS.has(field)) {
    const list = /** @type {unknown[]} */ (state[field]);
    return list.includes(value) ? state : { ...state, [field]: [...list, value] };
  }
  return { ...state, [field]: value };
}

/**
 * Removes `value` from a list field, or clears a scalar field (`value`
 * unused for a scalar). Always a new `State`.
 * @param {State} state @param {keyof State} field @param {unknown} [value]
 * @returns {State}
 */
export function withoutFilter(state, field, value) {
  if (LIST_FIELDS.has(field)) {
    const list = /** @type {unknown[]} */ (state[field]);
    return { ...state, [field]: list.filter((v) => v !== value) };
  }
  return { ...state, [field]: undefined };
}
