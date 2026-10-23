// @ts-check
/**
 * Opening the filter sheet for the in-place search (`inlineSearch.js`;
 * split out to keep that file under the lint line limits). The same
 * sheet on every search page (`filterSheet.js`); on a scoped page the
 * page's own filter is already part of the state, so it shows as
 * selected there.
 */
import { mount } from '../core/dom.js';
import { getJson } from '../core/api.js';
import { filterLabel } from './header.js';
import * as filterSheet from './filterSheet.js';
import { toApiParams, filterCount } from '../state/searchState.js';

/** The filter button's count badge and label (also live while the sheet is open). @param {Element} root @param {number} n @returns {void} */
export function updateFilterBadge(root, n) {
  const btn = root.querySelector('.c-header__filter-btn');
  if (!btn) return;
  const label = filterLabel(n);
  btn.setAttribute('aria-label', label);
  btn.setAttribute('title', label);
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
 * Opens the sheet onto a *fresh* `.c-search__sheet` node every time: the
 * old one (and its `filterSheet.bind()` listeners) is swapped out first,
 * rather than re-bound in place, so closing without applying and
 * reopening never stacks a second set of listeners on the same node.
 *
 * Waits for `/api/filters` (the sheet's people, types, events, …), then
 * fetches the real match count fresh (review round 1, M1: the list view
 * made no search at all, so the last count would read "show 0").
 * @param {Element} root
 * @param {import('./inlineSearchView.js').Ctx} ctx
 * @param {(next: import('../state/searchState.js').State) => void} onChange
 * @returns {Promise<void>}
 */
export async function openSheet(root, ctx, onChange) {
  const opener = /** @type {any} */ (root.querySelector('.c-header__filter-btn'));
  await ctx.optionsReady;
  const old = root.querySelector('.c-search__sheet');
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
    state: ctx.state, options: ctx.options, opener, onChange,
    onTentativeChange: (next) => updateFilterBadge(root, filterCount(next)),
  });
  /** @type {any} */ (sheetContainer.querySelector('dialog'))?.showModal?.();
}
