// @ts-check
/**
 * The top header: logo (when the site has one), wordmark (the accent part
 * in the brand gradient), tagline, the FAN-MADE badge, then a search box
 * (a line-icon magnifier inside it) and a filter-icon button. See the
 * design spec's "Visual design" and mockups/search-v2.html (`compact`
 * drops the tagline/badge row, for a page that already shows them
 * elsewhere).
 *
 * `nav` (the tab bar, from `pageShell`) renders inside the bar, after the
 * brand (Task 9b): on desktop (>=860px) header.css lays the two out as
 * one top bar -- brand left, links right, no search box -- as in
 * mockups/screens-v2.html's web screen; on a phone tabBar.css still fixes
 * the nav to the bottom. `liveSearch` marks the search page's header,
 * whose box is the page's own live search and so stays on desktop too
 * (and whose phone bar has no search icon: the box is right there).
 *
 * Task 10b pins the bar (header.css). Only the `<header>` landmark holds
 * the bar; the search row follows it as its own `search` landmark.
 */
import { html } from '../core/html.js';
import { site, t } from '../core/site.js';
import { SEARCH_PATH } from '../core/routes.js';

/** @returns {import('../core/html.js').SafeHtml} */
function searchIcon() {
  return html`
    <svg class="c-header__search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7"></circle>
      <path d="M21 21l-4.3-4.3"></path>
    </svg>
  `;
}

/** @param {number|undefined} filterCount @returns {import('../core/html.js').SafeHtml} */
function searchRow(filterCount) {
  return html`
    <div class="c-header__search" role="search">
      <span class="c-header__search-field">
        ${searchIcon()}
        <input class="c-header__search-box" type="search" placeholder="${t('search.placeholder')}">
      </span>
      <button class="c-header__filter-btn" type="button" aria-label="${filterCount ? t('search.filtersActive', { n: filterCount }) : t('search.filters')}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
          <path d="M4 6h16M7 12h10M10 18h4" />
        </svg>
        ${filterCount ? html`<span class="c-header__filter-count" aria-hidden="true">${filterCount}</span>` : ''}
      </button>
    </div>
  `;
}

/** The phone bar's search icon: a link to the search page (desktop has the nav's own "search" link instead). @returns {import('../core/html.js').SafeHtml} */
function findLink() {
  return html`
    <a class="c-header__find" href="${SEARCH_PATH}" aria-label="${t('nav.search')}">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7"></circle>
        <path d="M21 21l-4.3-4.3"></path>
      </svg>
    </a>
  `;
}

/** @param {'bar'|'below'} where @returns {import('../core/html.js').SafeHtml} */
function tagline(where) {
  return html`
    <p class="c-header__tagline c-header__tagline--${where}">
      ${site.tagline}
      <span class="c-header__badge">${t('badge.fanMade')}</span>
    </p>
  `;
}

/** Logo, wordmark, and (desktop, not compact) the tagline. @param {boolean} compact @returns {import('../core/html.js').SafeHtml} */
function brand(compact) {
  return html`
    <div class="c-header__brand">
      <div class="c-header__row">
        ${site.logo ? html`<img class="c-header__logo" src="${site.logo}" alt="" width="34" height="34">` : ''}
        <span class="c-header__wordmark">
          <span class="c-header__accent">${site.wordmark.accent}</span>${site.wordmark.rest}
        </span>
      </div>
      ${compact ? '' : tagline('bar')}
    </div>
  `;
}

/** @param {boolean} liveSearch @param {boolean} desktopSearch @returns {string} */
function belowClass(liveSearch, desktopSearch) {
  return `c-header__below${liveSearch ? ' c-header__below--live' : ''}${desktopSearch ? ' c-header__below--desktop' : ''}`;
}

/**
 * The pinned `<header>` (Task 10b, owner's "desktop full, phone slim"):
 * one bar, pinned by header.css at `--sticky-top`'s height. The tagline
 * and search row sit *after* it, so on a phone they scroll away; the
 * tagline is rendered in both places, and CSS shows exactly one of them
 * (the hidden one is `display: none`, so a screen reader hears it once).
 * `desktopSearch` (fix round 1, O1: the home page) keeps the search row
 * on desktop too, at the top of the content column under the bar -- the
 * bar itself stays clean. It still goes to /search (headerLinks.js).
 * @param {{ compact?: boolean, filterCount?: number, liveSearch?: boolean, desktopSearch?: boolean, nav?: import('../core/html.js').SafeHtml }} [props]
 * @returns {import('../core/html.js').SafeHtml}
 */
export function render(props = {}) {
  const { compact = false, filterCount, liveSearch = false, desktopSearch = false, nav } = props;
  return html`
    <header class="c-header${compact ? ' c-header--compact' : ''}${liveSearch ? ' c-header--live' : ''}">
      <div class="c-header__bar">
        <div class="c-header__inner">
          ${brand(compact)}
          ${liveSearch ? '' : findLink()}
          ${nav ?? ''}
        </div>
      </div>
    </header>
    <div class="${belowClass(liveSearch, desktopSearch)}">
      ${compact ? '' : tagline('below')}
      ${searchRow(filterCount)}
    </div>
  `;
}
