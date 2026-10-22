// @ts-check
/**
 * Scoped search's one piece of state (task-5-brief.md: "The URL is the
 * single source of truth. Scoped search is simply a link."). Pure: no
 * DOM, no network, no components -- the same discipline as
 * `public/js/core/*` (ruling 1), so this module is safe to import from
 * both `public/js/pages/search.js` and `public/js/components/filterSheet.js`
 * without ever reaching back into either.
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

/**
 * The `State` a search page URL's query string carries. Unknown or
 * malformed values are dropped rather than thrown on, so a hand-edited
 * or stale URL degrades to "no filter" instead of a broken page.
 * @param {URLSearchParams} params
 * @returns {State}
 */
export function parseState(params) {
  const peopleRaw = params.get('people');
  const typesRaw = params.get('types');
  const clientRaw = params.get('client');
  return {
    q: params.get('q') ?? '',
    people: peopleRaw ? peopleRaw.split(',').map(positiveInt).filter((n) => n !== undefined) : [],
    peopleMode: params.get('peopleMode') === 'all' ? 'all' : 'any',
    types: typesRaw ? typesRaw.split(',').filter(Boolean) : [],
    event: params.get('event') ?? undefined,
    account: params.get('account') ?? undefined,
    client: clientRaw ? positiveInt(clientRaw) : undefined,
    from: params.get('from') ?? undefined,
    to: params.get('to') ?? undefined,
  };
}

/**
 * `state` as a URL query string, with every empty/default field left out
 * (so the canonical URL for no filters is just `/search`, not
 * `/search?peopleMode=any&...`).
 * @param {State} state
 * @returns {URLSearchParams}
 */
export function toQuery(state) {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  if (state.people.length > 0) params.set('people', state.people.join(','));
  if (state.peopleMode === 'all') params.set('peopleMode', 'all');
  if (state.types.length > 0) params.set('types', state.types.join(','));
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

/** `true` when nothing is typed or filtered yet (the page's blank empty state: recent searches + quick chips). @param {State} state @returns {boolean} */
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
