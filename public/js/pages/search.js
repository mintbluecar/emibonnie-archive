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
import { mount, mountPage, on } from '../core/dom.js';
import { getJson } from '../core/api.js';
import { site, t } from '../core/site.js';
import * as resultCard from '../components/resultCard.js';
import * as filterSheet from '../components/filterSheet.js';
import {
  EMPTY_STATE, parseState, toQuery, toApiParams, filterCount, isBlank, sanitizeTypes, withoutFilter,
} from '../state/searchState.js';
import { searchHref } from '../core/routes.js';
import { shouldAutofocus } from '../state/searchFocus.js';
import {
  composeSearch, searchAreaMarkup, errorMarkup, errorPage,
} from './searchView.js';

const APP_SELECTOR = 'app';
const DEBOUNCE_MS = 250;
const Q_MIN = 2;
const Q_MAX = 100;
const PAGE_SIZE = 20;
const RECENT_KEY = 'fa:recentSearches';
const RECENT_MAX = 8;

/** @typedef {import('./searchView.js').Ctx & { seq: number }} Ctx */

/** Code points, after NFC normalization (review round 1, I2 -- matches `src/services/search.js`'s own `queryOf`, which this layer can't import). @param {string} q @returns {number} */
function qLength(q) {
  return [...q.normalize('NFC')].length;
}

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
 * One `/api/search` fetch for `ctx.state`'s page 1, or `{ count: 0,
 * results: [] }` without a network call for the blank state (ruling 3).
 * @param {Ctx} ctx @returns {Promise<import('../../../src/http/contracts.js').SearchResponse>}
 */
function fetchPage1(ctx) {
  return isBlank(ctx.state) ? Promise.resolve({ count: 0, results: [] }) : getJson('/api/search', { ...toApiParams(ctx.state, ctx.options), limit: PAGE_SIZE, offset: 0 });
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
 *
 * `ctx.seq` guards against a stale response: if a newer commit/loadMore
 * started after this one, this fetch's result is discarded, whichever
 * order the two responses actually arrive in (review round 1, I1).
 * Any fetch failure renders `errorMarkup()` in `.c-search__body` instead
 * of leaving the page half-updated or throwing unhandled (I2).
 * @param {Element} root @param {Ctx} ctx @returns {Promise<void>}
 */
async function refetchAndRender(root, ctx) {
  const mySeq = ++ctx.seq;
  const searchEl = root.querySelector('.c-search');
  try {
    const data = await fetchPage1(ctx);
    if (mySeq !== ctx.seq) return;
    ctx.data = data;
    ctx.offset = data.results.length;
    if (ctx.state.q) recordRecent(ctx.state.q);
    ctx.recent = loadRecent();
    if (searchEl) {
      mount(searchEl, searchAreaMarkup(ctx));
      resultCard.bind(searchEl);
    }
  } catch {
    if (mySeq !== ctx.seq) return;
    if (searchEl) mount(searchEl, searchAreaMarkup(ctx, errorMarkup()));
  }
}

/** @param {Element} root @param {Ctx} ctx @param {import('../state/searchState.js').State} next @returns {Promise<void>} */
async function commit(root, ctx, next) {
  ctx.state = next;
  const qs = toQuery(next).toString();
  history.replaceState(null, '', searchHref(qs));
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
 *
 * Fetches the real match count fresh every open (review round 1, M1):
 * `ctx.data.count` is 0 for the blank state (no fetch was ever made for
 * it), which would otherwise show a misleading "show 0" until the first
 * chip is toggled.
 * @param {Element} root @param {Ctx} ctx @returns {Promise<void>}
 */
async function openSheet(root, ctx) {
  const old = root.querySelector('.c-search__sheet');
  const opener = /** @type {any} */ (root.querySelector('.c-header__filter-btn'));
  if (!old) return;
  /** @type {number} */
  let count = ctx.data.count;
  try {
    ({ count } = await getJson('/api/search', { ...toApiParams(ctx.state, ctx.options), limit: 0 }));
  } catch {
    // best-effort: fall back to the last known count rather than blocking the sheet from opening
  }
  const sheetContainer = document.createElement('div');
  sheetContainer.className = 'c-search__sheet';
  old.replaceWith(sheetContainer);
  mount(sheetContainer, filterSheet.render({ state: ctx.state, options: ctx.options, count }));
  filterSheet.bind(sheetContainer, {
    state: ctx.state, options: ctx.options, opener, onChange: (next) => commit(root, ctx, next),
    onTentativeChange: (next) => updateFilterBadge(root, filterCount(next)),
  });
  /** @type {any} */ (sheetContainer.querySelector('dialog'))?.showModal?.();
}

/**
 * Appends the next page (never re-renders what's already on the page).
 * `ctx.seq` guards the same way `refetchAndRender` does (I1): a loadMore
 * superseded by a newer commit or another loadMore is discarded. A
 * failure just re-enables the button so the user can retry (I2) --
 * pagination failing isn't worth replacing the whole results list with
 * an error state.
 * @param {Element} searchEl @param {Ctx} ctx @param {HTMLButtonElement} button @returns {Promise<void>}
 */
async function loadMore(searchEl, ctx, button) {
  const mySeq = ++ctx.seq;
  button.disabled = true;
  try {
    const page = await getJson('/api/search', { ...toApiParams(ctx.state, ctx.options), limit: PAGE_SIZE, offset: ctx.offset });
    if (mySeq !== ctx.seq) return;
    const container = searchEl.querySelector('.c-search__results');
    if (container) {
      const scratch = document.createElement('div');
      mount(scratch, html`${page.results.map((/** @type {any} */ r) => resultCard.render({ result: r, q: ctx.state.q }))}`);
      resultCard.bind(scratch);
      while (scratch.firstChild) container.appendChild(scratch.firstChild);
    }
    ctx.offset += page.results.length;
    if (ctx.offset >= ctx.data.count) button.remove(); else button.disabled = false;
  } catch {
    if (mySeq !== ctx.seq) return;
    button.disabled = false;
  }
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

/** `q`, trimmed, or `undefined` when it's out of `/api/search`'s 2-100 range (review round 1, I2) -- not just too short. @param {string} value @returns {string|undefined} */
function validQ(value) {
  const q = value.trim();
  const len = qLength(q);
  if (len === 0) return '';
  return len >= Q_MIN && len <= Q_MAX ? q : undefined;
}

/** @param {Element} root @param {Ctx} ctx @returns {void} */
function bindSearchBox(root, ctx) {
  const handleInput = debounced((value) => {
    const q = validQ(value);
    if (q === undefined || q === ctx.state.q) return;
    commit(root, ctx, { ...ctx.state, q });
  }, DEBOUNCE_MS);
  on(root, '.c-header__search-box', 'input', (_e, input) => handleInput(input.value));
}

/** A touch device: a coarse pointer, or no hover (Task 10b fix round 1, O3). @returns {boolean} */
function isCoarsePointer() {
  if (typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(pointer: coarse)').matches || window.matchMedia('(hover: none)').matches;
}

/** @param {Element} root @param {Ctx} ctx @returns {void} */
export function bind(root, ctx) {
  const searchBox = /** @type {HTMLInputElement|null} */ (root.querySelector('.c-header__search-box'));
  if (searchBox) {
    searchBox.value = ctx.state.q;
    if (shouldAutofocus({ state: ctx.state, urlSearch: window.location?.search ?? '', coarsePointer: isCoarsePointer() })) searchBox.focus?.();
  }
  bindSearchBox(root, ctx);
  on(root, '.c-header__filter-btn', 'click', () => openSheet(root, ctx));
  const searchEl = root.querySelector('.c-search');
  if (searchEl) {
    bindSearchArea(root, searchEl, ctx);
    resultCard.bind(searchEl);
  }
}

/**
 * A `q` outside `/api/search`'s 2-100 range is unreachable through
 * normal typing (`validQ`, above); a hand-edited URL is simply treated
 * as having none (review round 1, I2 widens this past the old 1-char-only check).
 * @param {import('../state/searchState.js').State} state @returns {import('../state/searchState.js').State}
 */
function sanitizeInitialState(state) {
  const len = qLength(state.q);
  return len > 0 && (len < Q_MIN || len > Q_MAX) ? { ...state, q: '' } : state;
}

/**
 * Wrapped in try/catch (review round 1, I2): any unexpected failure
 * (`/api/filters` or the first `/api/search`) renders the whole-page
 * `errorPage()` fallback rather than leaving `#app` empty or throwing
 * unhandled, the same "catch, render emptyState with a copy key" shape
 * as `event.js`'s `start()` (`event.js:294`).
 * @returns {Promise<void>}
 */
export async function start() {
  const root = document.getElementById(APP_SELECTOR);
  if (!root) return;
  // A synchronous default, so the page never has an empty <title> while the
  // filters/results fetches below are in flight (axe's document-title rule;
  // same pattern as home.js/item.js).
  document.title = `${t('nav.search')} · ${site.name}`;
  try {
    const url = new URL(window.location.href);
    const options = await getJson('/api/filters');
    const state = sanitizeTypes(sanitizeInitialState(parseState(url.searchParams)), options);
    /** @type {Ctx} */
    const ctx = {
      state, options, data: { count: 0, results: [] }, offset: 0, recent: loadRecent(), seq: 0,
    };
    ctx.data = await fetchPage1(ctx);
    ctx.offset = ctx.data.results.length;
    if (state.q) recordRecent(state.q);
    ctx.recent = loadRecent();
    mountPage(root, composeSearch(ctx));
    bind(root, ctx);
    if (url.searchParams.get('filters') === '1') openSheet(root, ctx);
  } catch {
    mountPage(root, errorPage());
  }
}

if (typeof document !== 'undefined') start();
