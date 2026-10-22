// @ts-check
/**
 * The search page (task-5-brief.md): a debounced search box (reusing the
 * header's own, rather than a second one), active-filter chips with
 * "clear all", the filter sheet, paginated result cards, and -- when
 * there's nothing typed or filtered yet -- recent searches plus quick
 * chips to other people's scoped searches (`searchView.js`, split out
 * to keep this file under the lint line limits, same as `item.js`/
 * `itemFooter.js`). The URL is the single source of truth
 * (`public/js/state/searchState.js`): every change replaces it (never
 * pushes, so "back" leaves the page rather than undoing one keystroke)
 * and refetches page 1.
 */
import { html } from '../core/html.js';
import { mount, on } from '../core/dom.js';
import { getJson } from '../core/api.js';
import { site, t } from '../core/site.js';
import * as resultCard from '../components/resultCard.js';
import * as filterSheet from '../components/filterSheet.js';
import {
  EMPTY_STATE, parseState, toQuery, toApiParams, filterCount, isBlank, withoutFilter,
} from '../state/searchState.js';
import { composeSearch, searchAreaMarkup } from './searchView.js';

const APP_SELECTOR = 'app';
const DEBOUNCE_MS = 250;
const Q_MIN = 2;
const PAGE_SIZE = 20;
const RECENT_KEY = 'fa:recentSearches';
const RECENT_MAX = 8;

/** @typedef {import('./searchView.js').Ctx} Ctx */

/** Every `localStorage` access goes through here, behind try/catch (ruling 4). @returns {string[]} */
function loadRecent() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(list) ? list.filter((v) => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/** @param {string} q @returns {void} */
function recordRecent(q) {
  try {
    const next = [q, ...loadRecent().filter((v) => v !== q)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // private mode / blocked storage: recent searches just won't persist
  }
}

/** @param {Element} root @param {number} n @returns {void} */
function updateFilterBadge(root, n) {
  const btn = root.querySelector('.c-header__filter-btn');
  if (!btn) return;
  btn.setAttribute('aria-label', n > 0 ? t('search.filtersActive', { n }) : t('search.filters'));
  let badge = btn.querySelector('.c-header__filter-count');
  if (n > 0) {
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'c-header__filter-count';
      badge.setAttribute('aria-hidden', 'true');
      btn.appendChild(badge);
    }
    badge.textContent = String(n);
  } else {
    badge?.remove();
  }
}

/**
 * Re-fetches page 1 for `ctx.state` and re-renders `.c-search`'s content
 * -- what every result-producing state change does (ruling 3). Records
 * the search only once its results have actually loaded (ruling 4).
 * `.c-search` itself is never replaced (`mount()` here only replaces its
 * children), so `bindSearchArea`'s delegated listeners, wired once in
 * `bind()`, keep matching freshly rendered children without being
 * re-attached here -- re-attaching on every re-render would stack a
 * duplicate listener per commit (chips.bind's `applyColours`, by
 * contrast, carries no listeners, so the kind UI's own repeated re-bind
 * elsewhere in this codebase has no such risk).
 * @param {Element} root @param {Ctx} ctx @returns {Promise<void>}
 */
async function refetchAndRender(root, ctx) {
  ctx.data = isBlank(ctx.state) ? { count: 0, results: [] } : await getJson('/api/search', { ...toApiParams(ctx.state, ctx.options), limit: PAGE_SIZE, offset: 0 });
  ctx.offset = ctx.data.results.length;
  if (ctx.state.q) recordRecent(ctx.state.q);
  ctx.recent = loadRecent();
  const searchEl = root.querySelector('.c-search');
  if (searchEl) mount(searchEl, searchAreaMarkup(ctx));
}

/** @param {Element} root @param {Ctx} ctx @param {import('../state/searchState.js').State} next @returns {Promise<void>} */
async function commit(root, ctx, next) {
  ctx.state = next;
  const qs = toQuery(next).toString();
  history.replaceState(null, '', qs ? `/search?${qs}` : '/search');
  updateFilterBadge(root, filterCount(next));
  await refetchAndRender(root, ctx);
}

/**
 * Opens the filter sheet onto a *fresh* `.c-search__sheet` node every
 * time: the old one (and its `filterSheet.bind()` listeners) is swapped
 * out first, rather than re-bound in place, so closing without applying
 * (Escape/cancel never calls `commit()`, so `.c-search` itself is never
 * re-mounted) and reopening doesn't stack a second set of listeners on
 * the same persisting node (the same risk `refetchAndRender` avoids by
 * binding `.c-search`'s own delegated listeners only once).
 * @param {Element} root @param {Ctx} ctx @returns {void}
 */
function openSheet(root, ctx) {
  const old = root.querySelector('.c-search__sheet');
  const opener = /** @type {any} */ (root.querySelector('.c-header__filter-btn'));
  if (!old) return;
  const sheetContainer = document.createElement('div');
  sheetContainer.className = 'c-search__sheet';
  old.replaceWith(sheetContainer);
  mount(sheetContainer, filterSheet.render({ state: ctx.state, options: ctx.options, count: ctx.data.count }));
  filterSheet.bind(sheetContainer, {
    state: ctx.state, options: ctx.options, opener, onChange: (next) => commit(root, ctx, next),
    onTentativeChange: (next) => updateFilterBadge(root, filterCount(next)),
  });
  /** @type {any} */ (sheetContainer.querySelector('dialog'))?.showModal();
}

/** @param {Element} searchEl @param {Ctx} ctx @param {HTMLButtonElement} button @returns {Promise<void>} */
async function loadMore(searchEl, ctx, button) {
  button.disabled = true;
  const page = await getJson('/api/search', { ...toApiParams(ctx.state, ctx.options), limit: PAGE_SIZE, offset: ctx.offset });
  const container = searchEl.querySelector('.c-search__results');
  if (container) {
    const scratch = document.createElement('div');
    mount(scratch, html`${page.results.map((/** @type {any} */ r) => resultCard.render({ result: r, q: ctx.state.q }))}`);
    while (scratch.firstChild) container.appendChild(scratch.firstChild);
  }
  ctx.offset += page.results.length;
  if (ctx.offset >= ctx.data.count) button.remove(); else button.disabled = false;
}

/** @param {Element} root @param {Element} searchEl @param {Ctx} ctx @returns {void} */
function bindSearchArea(root, searchEl, ctx) {
  on(searchEl, '.c-search__active-chip', 'click', (_e, chip) => {
    const field = /** @type {keyof import('../state/searchState.js').State} */ (chip.getAttribute('data-field'));
    const raw = chip.getAttribute('data-value') ?? '';
    // `people`'s own values are ids (numbers); `types`' are names (strings, e.g. "live");
    // a scalar field (event/account/client/from/to) ignores the value and just clears.
    commit(root, ctx, withoutFilter(ctx.state, field, field === 'people' ? Number(raw) : raw));
  });
  on(searchEl, '.c-search__clear-all', 'click', () => commit(root, ctx, { ...EMPTY_STATE, q: ctx.state.q }));
  on(searchEl, '.c-search__more', 'click', (_e, button) => loadMore(searchEl, ctx, button));
}

/** @param {(value: string) => void} fn @param {number} ms @returns {(value: string) => void} */
function debounced(fn, ms) {
  /** @type {ReturnType<typeof setTimeout>|undefined} */
  let timer;
  return (value) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(value), ms);
  };
}

/** @param {Element} root @param {Ctx} ctx @returns {void} */
function bindSearchBox(root, ctx) {
  const handleInput = debounced((value) => {
    const q = value.trim();
    if ((q.length > 0 && q.length < Q_MIN) || q === ctx.state.q) return;
    commit(root, ctx, { ...ctx.state, q });
  }, DEBOUNCE_MS);
  on(root, '.c-header__search-box', 'input', (_e, input) => handleInput(input.value));
}

/** @param {Element} root @param {Ctx} ctx @returns {void} */
export function bind(root, ctx) {
  const searchBox = /** @type {HTMLInputElement|null} */ (root.querySelector('.c-header__search-box'));
  if (searchBox) {
    searchBox.value = ctx.state.q;
    searchBox.focus();
  }
  bindSearchBox(root, ctx);
  on(root, '.c-header__filter-btn', 'click', () => openSheet(root, ctx));
  const searchEl = root.querySelector('.c-search');
  if (searchEl) bindSearchArea(root, searchEl, ctx);
}

/**
 * A 1-character `q` is invalid on `/api/search` (2-100) and unreachable
 * through normal typing (ruling: min 2 chars); a hand-edited URL is
 * simply treated as having none.
 * @param {import('../state/searchState.js').State} state @returns {import('../state/searchState.js').State}
 */
function sanitizeInitialState(state) {
  return state.q.length === 1 ? { ...state, q: '' } : state;
}

/** @returns {Promise<void>} */
export async function start() {
  const root = document.getElementById(APP_SELECTOR);
  if (!root) return;
  const url = new URL(window.location.href);
  const state = sanitizeInitialState(parseState(url.searchParams));
  const options = await getJson('/api/filters');
  const data = isBlank(state) ? { count: 0, results: [] } : await getJson('/api/search', { ...toApiParams(state, options), limit: PAGE_SIZE, offset: 0 });
  if (state.q) recordRecent(state.q);
  document.title = `${t('nav.search')} · ${site.name}`;
  /** @type {Ctx} */
  const ctx = { state, options, data, offset: data.results.length, recent: loadRecent() };
  mount(root, composeSearch(ctx));
  bind(root, ctx);
  if (url.searchParams.get('filters') === '1') openSheet(root, ctx);
}

if (typeof document !== 'undefined') start();
