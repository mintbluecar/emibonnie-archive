// @ts-check
import { searchHref } from '../core/routes.js';

/**
 * Wires the shared header's search box and filter button to the search
 * page, for every page that has no live search of its own (spec: "the
 * search box goes to /search", "the filter icon goes to
 * /search?filters=1"). One shared place so home/event/item (and any
 * later page) wire it the same way, rather than each re-implementing it
 * (review round 1, I6: it previously only worked on the home page). The
 * search page keeps its own live box instead of calling this.
 * @param {Element} root
 * @returns {void}
 */
export function bind(root) {
  const searchBox = root.querySelector('.c-header__search-box');
  const filterBtn = root.querySelector('.c-header__filter-btn');
  searchBox?.addEventListener('focus', () => { window.location.href = searchHref(); });
  filterBtn?.addEventListener('click', () => { window.location.href = searchHref('filters=1'); });
}
