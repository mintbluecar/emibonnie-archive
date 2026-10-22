// @ts-check
/**
 * `search.js`'s pure rendering half: `composeSearch`/`searchAreaMarkup`
 * turn a `Ctx` (state + `/api/filters` options + the latest
 * `/api/search` page + the recent-searches list) into markup, same
 * split as `item.js`/`itemFooter.js` (to keep each file under the lint
 * line limits) -- never touches the DOM or `localStorage` itself.
 * @typedef {{ state: import('../state/searchState.js').State, options: import('../../../src/http/contracts.js').FilterOptions,
 *   data: import('../../../src/http/contracts.js').SearchResponse, offset: number, recent: string[] }} Ctx
 */
import { html } from '../core/html.js';
import { t } from '../core/site.js';
import * as pageShell from '../components/pageShell.js';
import * as resultCard from '../components/resultCard.js';
import * as emptyState from '../components/emptyState.js';
import { EMPTY_STATE, toQuery, filterCount, isBlank } from '../state/searchState.js';

/** @param {number} id @param {import('../../../src/http/contracts.js').PersonChip[]} people @returns {string} */
function personLabel(id, people) {
  const p = people.find((x) => x.id === id);
  return p ? `${p.emoji} ${p.name}` : String(id);
}

/** @param {string} name @returns {string} */
function typeLabel(name) {
  if (name === 'shared story') return t('search.sharedStory');
  return name === 'posts' ? t('search.posts') : name;
}

/** @typedef {{ field: string, value: string, label: string }} ChipVM */

/** @param {import('../state/searchState.js').State} state @param {import('../../../src/http/contracts.js').FilterOptions} options @returns {ChipVM|null} */
function eventChip(state, options) {
  return state.event ? { field: 'event', value: '', label: options.events.find((e) => e.slug === state.event)?.name ?? state.event } : null;
}

/** @param {import('../state/searchState.js').State} state @param {import('../../../src/http/contracts.js').FilterOptions} options @returns {ChipVM|null} */
function clientChip(state, options) {
  if (state.client === undefined) return null;
  const clients = /** @type {any} */ (options).clients ?? [];
  const name = clients.find((/** @type {any} */ c) => c.id === state.client)?.name;
  return { field: 'client', value: '', label: name ?? String(state.client) };
}

/** @param {string} field @param {string} label @param {string|undefined} value @returns {ChipVM|null} */
function dateChip(field, label, value) {
  return value ? { field, value: '', label: `${label} ${value}` } : null;
}

/**
 * Every active filter as a removable chip (never `q`: that's the
 * header's own search box, not this row).
 * @param {import('../state/searchState.js').State} state @param {import('../../../src/http/contracts.js').FilterOptions} options
 * @returns {ChipVM[]}
 */
function activeFilters(state, options) {
  const peopleChips = state.people.map((id) => ({ field: 'people', value: String(id), label: personLabel(id, options.people) }));
  const typeChips = state.types.map((name) => ({ field: 'types', value: name, label: typeLabel(name) }));
  const scalars = [
    eventChip(state, options), state.account ? { field: 'account', value: '', label: `@${state.account}` } : null, clientChip(state, options),
    dateChip('from', t('search.fromLabel'), state.from), dateChip('to', t('search.toLabel'), state.to),
  ];
  return [...peopleChips, ...typeChips, .../** @type {ChipVM[]} */ (scalars.filter((c) => c !== null))];
}

/** @param {import('../state/searchState.js').State} state @param {import('../../../src/http/contracts.js').FilterOptions} options */
function activeFiltersRow(state, options) {
  const chips = activeFilters(state, options);
  if (chips.length === 0) return html``;
  return html`
    <div class="c-search__active-filters">
      ${chips.map((c) => html`<button type="button" class="c-search__active-chip" data-field="${c.field}" data-value="${c.value}" aria-label="${t('search.removeFilter', { label: c.label })}">${c.label} <span aria-hidden="true">✕</span></button>`)}
      <button type="button" class="c-search__clear-all">${t('search.clearAll')}</button>
    </div>
  `;
}

/** @param {import('../../../src/http/contracts.js').PersonChip[]} people */
function quickChips(people) {
  if (people.length === 0) return html``;
  return html`
    <p class="c-search__quick-label">${t('search.quickChips')}</p>
    <div class="c-search__quick-chips">
      ${people.map((p) => html`<a class="c-search__quick-chip" href="/search?${toQuery({ ...EMPTY_STATE, people: [p.id] }).toString()}">${p.emoji} ${p.name}</a>`)}
    </div>
  `;
}

/** @param {string[]} recent */
function recentSearchesBlock(recent) {
  if (recent.length === 0) return html``;
  return html`
    <p class="c-search__recent-label">${t('search.recentSearches')}</p>
    <div class="c-search__recent-chips">
      ${recent.map((q) => html`<a class="c-search__recent-chip" href="/search?${toQuery({ ...EMPTY_STATE, q }).toString()}">${q}</a>`)}
    </div>
  `;
}

/** @param {Ctx} ctx */
function bodyContent(ctx) {
  if (ctx.data.results.length === 0) {
    if (!isBlank(ctx.state)) return emptyState.render({ message: t('search.empty') });
    return html`<div class="c-search__blank">${recentSearchesBlock(ctx.recent)}${quickChips(ctx.options.people)}</div>`;
  }
  const hasMore = ctx.data.results.length < ctx.data.count;
  const results = ctx.data.results.map((r) => resultCard.render({ result: r, q: ctx.state.q }));
  return html`<div class="c-search__results">${results}</div>${hasMore ? html`<button type="button" class="c-search__more">${t('search.more')}</button>` : ''}`;
}

/** `.c-search`'s own content, re-rendered on every committed state change. @param {Ctx} ctx @returns {import('../core/html.js').SafeHtml} */
export function searchAreaMarkup(ctx) {
  return html`
    ${activeFiltersRow(ctx.state, ctx.options)}
    <div class="c-search__body">${bodyContent(ctx)}</div>
    <div class="c-search__sheet"></div>
  `;
}

/** The whole page, for its first mount only (`search.js`'s `start()`). @param {Ctx} ctx @returns {import('../core/html.js').SafeHtml} */
export function composeSearch(ctx) {
  const content = html`<div class="c-search">${searchAreaMarkup(ctx)}</div>`;
  return pageShell.render({ active: 'search', compact: true, headerProps: { filterCount: filterCount(ctx.state) }, content });
}
