// @ts-check
/**
 * The in-place search's pure rendering half (Task 10d; moved here from
 * the old search page's `searchView.js`): `inlineSearch.js` owns the DOM
 * and the network, this turns its `Ctx` into markup. A page places two
 * pieces: `filtersSlot` (the active-filter chips, right under the box)
 * and `region` (the results, in place of the page's own list, which it
 * wraps). Both are re-rendered by `inlineSearch.js` -- never by the page.
 *
 * @typedef {import('../state/searchState.js').State} State
 * @typedef {import('../state/searchScope.js').Scope} Scope
 * @typedef {import('../../../src/http/contracts.js').FilterOptions} FilterOptions
 * @typedef {{ state: State, scope: Scope|null, placeholder: string, options: FilterOptions,
 *   data: import('../../../src/http/contracts.js').SearchResponse, offset: number, seq: number,
 *   optionsReady: Promise<void>|null }} Ctx
 *   `placeholder`: the box's text while the page's own filter is on ("search this event…");
 *   `optionsReady`: `/api/filters`, once `inlineSearch.bind` has asked for it.
 */
import { html } from '../core/html.js';
import { t, tCount } from '../core/site.js';
import * as resultCard from './resultCard.js';
import * as emptyState from './emptyState.js';
import { filterCount } from '../state/searchState.js';
import { canClear, hasScope, viewOf } from '../state/searchScope.js';

/** @type {FilterOptions} */
export const NO_OPTIONS = { people: [], categories: [], clients: [], events: [], accounts: [] };

/** @param {number} id @param {import('../../../src/http/contracts.js').PersonChip[]} people @returns {string|null} */
function personLabel(id, people) {
  const p = people.find((x) => x.id === id);
  return p ? `${p.emoji} ${p.name}` : null;
}

/** @param {string} name @returns {string} */
function typeLabel(name) {
  if (name === 'shared story') return t('search.sharedStory');
  return name === 'posts' ? t('search.posts') : name;
}

/** @typedef {{ field: string, value: string, label: string }} ChipVM */

/** @param {State} state @param {FilterOptions} options @returns {ChipVM|null} */
function eventChip(state, options) {
  return state.event ? { field: 'event', value: state.event, label: options.events.find((e) => e.slug === state.event)?.name ?? state.event } : null;
}

/** @param {State} state @param {FilterOptions} options @returns {ChipVM|null} */
function clientChip(state, options) {
  if (state.client === undefined) return null;
  const name = options.clients.find((c) => c.id === state.client)?.name;
  return { field: 'client', value: '', label: name ?? String(state.client) };
}

/** @param {string} field @param {string} label @param {string|undefined} value @returns {ChipVM|null} */
function dateChip(field, label, value) {
  return value ? { field, value: '', label: `${label} ${value}` } : null;
}

/**
 * Every active filter as a removable chip (never `q`: that's the box).
 * The page's own filter reads its `scope.label` until `/api/filters`
 * has named it.
 * @param {State} state @param {FilterOptions} options @param {Scope|null} scope
 * @returns {ChipVM[]}
 */
function activeFilters(state, options, scope) {
  const scopeLabel = (/** @type {string} */ field, /** @type {string} */ value) => (scope && scope.field === field && String(scope.value) === value ? scope.label : value);
  const peopleChips = state.people.map((id) => ({ field: 'people', value: String(id), label: personLabel(id, options.people) ?? scopeLabel('people', String(id)) }));
  const typeChips = state.types.map((name) => ({ field: 'types', value: name, label: typeLabel(name) }));
  const event = eventChip(state, options);
  if (event && event.label === event.value) event.label = scopeLabel('event', event.value);
  const scalars = [
    event, state.account ? { field: 'account', value: state.account, label: `@${state.account}` } : null, clientChip(state, options),
    dateChip('from', t('search.fromLabel'), state.from), dateChip('to', t('search.toLabel'), state.to),
  ];
  return [...peopleChips, ...typeChips, .../** @type {ChipVM[]} */ (scalars.filter((c) => c !== null))];
}

/**
 * The active-filter chips row, plus "clear all" when there's more than
 * the page's own filter to clear -- or the page's own filter was removed,
 * so "clear all" alone brings it back. Empty otherwise.
 * @param {Ctx} ctx @returns {import('../core/html.js').SafeHtml}
 */
export function filtersRow(ctx) {
  const chips = activeFilters(ctx.state, ctx.options, ctx.scope);
  const clearable = canClear(ctx.state, ctx.scope);
  if (chips.length === 0 && !clearable) return html``;
  return html`
    <div class="c-search__active-filters">
      ${chips.map((c) => html`<button type="button" class="c-search__active-chip" data-field="${c.field}" data-value="${c.value}" title="${t('search.removeFilter', { label: c.label })}" aria-label="${t('search.removeFilter', { label: c.label })}">${c.label} <span aria-hidden="true">✕</span></button>`)}
      ${clearable ? html`<button type="button" class="c-search__clear-all">${t('search.clearAll')}</button>` : ''}
    </div>
  `;
}

/**
 * "N translations · newest first" above the results (Task 9b,
 * mockups/search-v2.html): every match, not just this page, and the
 * order they really come in -- src/repo/search.js ranks a text query's
 * results best match first, and lists a filters-only search newest first.
 * @param {Ctx} ctx
 */
function countLine(ctx) {
  return html`<p class="c-search__count">${countText(ctx)}</p>`;
}

/** @param {Ctx} ctx @returns {string} */
function countText(ctx) {
  const order = ctx.state.q ? t('search.bestFirst') : t('search.newestFirst');
  return t('search.countLine', { count: tCount('search.results', ctx.data.count), order });
}

/**
 * What the live region announces once results land (fix round 1, I2):
 * the count line, or "no results".
 * @param {Ctx} ctx @returns {string}
 */
export function statusText(ctx) {
  return ctx.data.results.length === 0 ? t('search.empty') : countText(ctx);
}

/**
 * A scoped page whose own filter was removed, with nothing typed or
 * added (fix round 1, M6): it now searches the whole archive, so it
 * says to type rather than showing the page's own list.
 * @returns {import('../core/html.js').SafeHtml}
 */
export function hintMarkup() {
  return html`<p class="c-search__hint">${t('search.typeToSearchAll')}</p>`;
}

/** The results, the count line and "more" -- or "no results". @param {Ctx} ctx @returns {import('../core/html.js').SafeHtml} */
export function resultsBody(ctx) {
  if (ctx.data.results.length === 0) return emptyState.render({ message: t('search.empty') });
  const hasMore = ctx.data.results.length < ctx.data.count;
  const results = ctx.data.results.map((r) => resultCard.render({ result: r, q: ctx.state.q }));
  return html`${countLine(ctx)}<div class="c-search__results">${results}</div>${hasMore ? html`<button type="button" class="c-search__more">${t('search.more')}</button>` : ''}`;
}

/**
 * The `.c-search` fallback when a `/api/search` (re)fetch fails (review
 * round 1, I2): the chips row (and "clear all") stays, so there's a way to retry.
 * @returns {import('../core/html.js').SafeHtml}
 */
export function errorMarkup() {
  return emptyState.render({ message: t('search.error') });
}

/** Where the chips go: right under the box, at the top of the content column. @param {Ctx} ctx @returns {import('../core/html.js').SafeHtml} */
export function filtersSlot(ctx) {
  return html`<div class="c-search__filters">${filtersRow(ctx)}</div>`;
}

/**
 * The results area and the page's own `list`, one of them shown: the
 * list until something is typed or filtered (`viewOf`), then the
 * results in its place. The filter sheet's container rides along, and
 * so does the one live region (fix round 1, I2): it sits outside
 * `.c-search`, which is re-mounted on every render, so a screen reader
 * hears each new count. The `hidden` attributes only avoid a flash on
 * first paint; `inlineSearch.bind` sets the real state.
 * @param {Ctx} ctx @param {import('../core/html.js').SafeHtml} list
 * @returns {import('../core/html.js').SafeHtml}
 */
export function region(ctx, list) {
  const listShown = viewOf(ctx.state, ctx.scope) === 'list';
  return html`
    <p class="c-search__status" role="status" aria-live="polite"></p>
    <div class="c-search"${listShown ? html` hidden` : ''}></div>
    <div class="c-search__list"${listShown ? '' : html` hidden`}>${list}</div>
    <div class="c-search__sheet"></div>
  `;
}

/** The box's text: the page's own ("search <wordmark accent>…") while its filter is on, else the archive-wide one. @param {Ctx} ctx @returns {string} */
export function placeholderOf(ctx) {
  return hasScope(ctx.state, ctx.scope) ? ctx.placeholder : t('search.placeholder');
}

/** What `pageShell`'s header needs for the search row. @param {Ctx} ctx */
export function headerProps(ctx) {
  return { search: { placeholder: placeholderOf(ctx), filterCount: filterCount(ctx.state) } };
}
