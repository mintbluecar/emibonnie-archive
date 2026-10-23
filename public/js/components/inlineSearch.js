// @ts-check
/**
 * The in-place search (Task 10d; moved here from the old search page,
 * `pages/search.js`): one controller for home and the event, person and
 * translator pages. The header's box and filter button, the active-filter
 * chips under it, the filter sheet, and the results that replace the
 * page's own list -- all on the page itself; nothing here navigates.
 *
 * A page calls `prepare()` (sync, before its first paint, so a `?q=`
 * link never flashes the list), places `inlineSearchView`'s
 * `filtersSlot`/`region` in its content and `headerProps` in its header,
 * then `bind()`. The URL is the single source of truth
 * (`state/searchState.js`, `state/searchScope.js`): every change replaces
 * it on the page's own path (never pushes, so "back" leaves the page
 * rather than undoing one keystroke). There is no autofocus: the box is
 * the visitor's to tap (spec, "Search happens in place").
 */
import { html } from '../core/html.js';
import { mount, on } from '../core/dom.js';
import { getJson } from '../core/api.js';
import { t } from '../core/site.js';
import { withQuery } from '../core/routes.js';
import * as resultCard from './resultCard.js';
import { toApiParams, filterCount, sanitizeTypes, withoutFilter } from '../state/searchState.js';
import { cleared, queryOf, showsList, stateFromQuery } from '../state/searchScope.js';
import { NO_OPTIONS, errorMarkup, filtersRow, placeholderOf, resultsBody } from './inlineSearchView.js';
import { openSheet, updateFilterBadge } from './inlineSearchSheet.js';

const DEBOUNCE_MS = 250;
const Q_MIN = 2;
const Q_MAX = 100;
const PAGE_SIZE = 20;

/** @typedef {import('./inlineSearchView.js').Ctx} Ctx */
/** @typedef {import('../state/searchState.js').State} State */

/** Code points, after NFC normalization (review round 1, I2 -- matches `src/services/search.js`'s own `queryOf`, which this layer can't import). @param {string} q @returns {number} */
function qLength(q) {
  return [...q.normalize('NFC')].length;
}

/** `q`, trimmed, or `undefined` when it's out of `/api/search`'s 2-100 range (review round 1, I2) -- not just too short. @param {string} value @returns {string|undefined} */
function validQ(value) {
  const q = value.trim();
  const len = qLength(q);
  if (len === 0) return '';
  return len >= Q_MIN && len <= Q_MAX ? q : undefined;
}

/**
 * The page's search, from its URL's query (`location.search`), before
 * anything is mounted. A `q` outside the 2-100 range is unreachable by
 * typing (`validQ`), so a hand-edited one is simply dropped.
 * @param {{ search: string, scope?: import('../state/searchScope.js').Scope|null, placeholder?: string }} input
 * @returns {Ctx}
 */
export function prepare({ search, scope = null, placeholder = t('search.placeholder') }) {
  const state = stateFromQuery(new URLSearchParams(search), scope);
  const len = qLength(state.q);
  const q = len > 0 && (len < Q_MIN || len > Q_MAX) ? '' : state.q;
  return {
    state: { ...state, q }, scope, placeholder, options: NO_OPTIONS, data: { count: 0, results: [] }, offset: 0, seq: 0, optionsReady: null,
  };
}

/** Shows the page's own list or the results area, never both. @param {Element} root @param {boolean} listShown */
function showList(root, listShown) {
  const list = /** @type {HTMLElement|null} */ (root.querySelector('.c-search__list'));
  const results = /** @type {HTMLElement|null} */ (root.querySelector('.c-search'));
  if (list) list.hidden = !listShown;
  if (results) results.hidden = listShown;
}

/** The chips row and the box's placeholder, after any state change. @param {Element} root @param {Ctx} ctx */
function renderChrome(root, ctx) {
  const slot = root.querySelector('.c-search__filters');
  if (slot) mount(slot, filtersRow(ctx));
  root.querySelector('.c-header__search-box')?.setAttribute('placeholder', placeholderOf(ctx));
  updateFilterBadge(root, filterCount(ctx.state));
}

/**
 * Re-fetches page 1 and re-renders `.c-search` (never replaced itself,
 * so the delegated listeners `bind()` wired once keep matching). `seq`
 * drops a response a newer commit/loadMore has overtaken, whichever
 * order they arrive in (review round 1, I1); a failure shows
 * `errorMarkup()` instead of a half-updated page (I2).
 * @param {Element} root @param {Ctx} ctx @returns {Promise<void>}
 */
async function refetchAndRender(root, ctx) {
  const mySeq = ++ctx.seq;
  const searchEl = root.querySelector('.c-search');
  try {
    await ctx.optionsReady;
    const data = await getJson('/api/search', { ...toApiParams(ctx.state, ctx.options), limit: PAGE_SIZE, offset: 0 });
    if (mySeq !== ctx.seq) return;
    ctx.data = data;
    ctx.offset = data.results.length;
    if (searchEl) {
      mount(searchEl, resultsBody(ctx));
      resultCard.bind(searchEl);
    }
  } catch {
    if (mySeq !== ctx.seq) return;
    if (searchEl) mount(searchEl, errorMarkup());
  }
}

/**
 * Applies `next`: the URL, the chips, then the list (no fetch: an
 * in-flight one is cancelled by bumping `seq`) or fresh results.
 * Exported for a page's own control that starts a search (the person
 * page's "with…" picker).
 * @param {Element} root @param {Ctx} ctx @param {State} next @returns {Promise<void>}
 */
export async function commit(root, ctx, next) {
  ctx.state = next;
  history.replaceState(null, '', withQuery(window.location.pathname, queryOf(next, ctx.scope)));
  renderChrome(root, ctx);
  const listShown = showsList(next, ctx.scope);
  showList(root, listShown);
  if (listShown) {
    ctx.seq += 1;
    return;
  }
  await refetchAndRender(root, ctx);
}

/**
 * Appends the next page (never re-renders what's already there), with
 * the same `seq` guard; a failure just re-enables the button (I2).
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

/** The chips row (remove one, clear all) and "more" -- delegated, bound once. @param {Element} root @param {Ctx} ctx */
function bindAreas(root, ctx) {
  const slot = root.querySelector('.c-search__filters');
  if (slot) {
    on(slot, '.c-search__active-chip', 'click', (_e, chip) => {
      const field = /** @type {keyof State} */ (chip.getAttribute('data-field'));
      const raw = chip.getAttribute('data-value') ?? '';
      // `people`'s values are ids (numbers); `types`' are names; a scalar field ignores the value.
      commit(root, ctx, withoutFilter(ctx.state, field, field === 'people' ? Number(raw) : raw));
    });
    on(slot, '.c-search__clear-all', 'click', () => commit(root, ctx, cleared(ctx.state, ctx.scope)));
  }
  const searchEl = root.querySelector('.c-search');
  if (searchEl) on(searchEl, '.c-search__more', 'click', (_e, button) => loadMore(searchEl, ctx, button));
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
function bindBox(root, ctx) {
  const box = /** @type {HTMLInputElement|null} */ (root.querySelector('.c-header__search-box'));
  if (box) box.value = ctx.state.q;
  const handleInput = debounced((value) => {
    const q = validQ(value);
    if (q === undefined || q === ctx.state.q) return;
    commit(root, ctx, { ...ctx.state, q });
  }, DEBOUNCE_MS);
  on(root, '.c-header__search-box', 'input', (_e, input) => handleInput(input.value));
}

/** `/api/filters` (people, events, … for the chips and the sheet); a failure leaves them empty -- the search itself still works. @param {Ctx} ctx */
async function loadOptions(ctx) {
  try {
    ctx.options = await getJson('/api/filters');
    ctx.state = sanitizeTypes(ctx.state, ctx.options);
  } catch {
    ctx.options = NO_OPTIONS;
  }
}

/**
 * Wires the box, the filter button, the chips and "more" (each once),
 * then loads `/api/filters` and, when the URL already holds a search,
 * its results. Resolves once that first load has settled.
 * @param {Element} root @param {Ctx} ctx @returns {Promise<void>}
 */
export async function bind(root, ctx) {
  bindBox(root, ctx);
  on(root, '.c-header__filter-btn', 'click', () => openSheet(root, ctx, (next) => commit(root, ctx, next)));
  bindAreas(root, ctx);
  const listShown = showsList(ctx.state, ctx.scope);
  showList(root, listShown);
  ctx.optionsReady = loadOptions(ctx);
  await ctx.optionsReady;
  renderChrome(root, ctx);
  if (!listShown) await refetchAndRender(root, ctx);
}
