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
 * the nav to the bottom.
 *
 * Task 10b pins the bar (header.css). Only the `<header>` landmark holds
 * the bar; the search row follows it as its own `search` landmark.
 *
 * Task 10d: a page that searches in place (home, event, person,
 * translator: `components/inlineSearch.js`) passes `search` and gets the
 * row -- pinned under the bar on a phone, at the top of the content
 * column on desktop. Every other page (the item page, the static pages)
 * has no box, only the phone bar's search icon, which goes home.
 */
import { html } from '../core/html.js';
import { site, t } from '../core/site.js';
import { HOME_PATH } from '../core/routes.js';
import * as themeToggle from './themeToggle.js';

/** @returns {import('../core/html.js').SafeHtml} */
function searchIcon() {
  return html`
    <svg class="c-header__search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7"></circle>
      <path d="M21 21l-4.3-4.3"></path>
    </svg>
  `;
}

/** @typedef {{ placeholder: string, filterCount?: number }} SearchProps */

/** The filter button's name, as its tooltip too (owner rule: every icon-only control has a `title`). @param {number|undefined} n @returns {string} */
export function filterLabel(n) {
  return n ? t('search.filtersActive', { n }) : t('search.filters');
}

/** @param {SearchProps} props @returns {import('../core/html.js').SafeHtml} */
function searchRow({ placeholder, filterCount }) {
  return html`
    <div class="c-header__search" role="search">
      <span class="c-header__search-field">
        ${searchIcon()}
        <input class="c-header__search-box" type="search" placeholder="${placeholder}">
      </span>
      <button class="btn btn--secondary btn--icon c-header__filter-btn" type="button" title="${filterLabel(filterCount)}" aria-label="${filterLabel(filterCount)}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
          <path d="M4 6h16M7 12h10M10 18h4" />
        </svg>
        ${filterCount ? html`<span class="c-header__filter-count" aria-hidden="true">${filterCount}</span>` : ''}
      </button>
    </div>
  `;
}

/**
 * The phone bar's search icon, on a page with no search row: it goes
 * home, where the search is (Task 10c r, owner's decision; Task 10d).
 * @returns {import('../core/html.js').SafeHtml}
 */
function findLink() {
  return html`
    <a class="btn btn--quiet btn--icon c-header__icon c-header__find" href="${HOME_PATH}" title="${t('nav.search')}" aria-label="${t('nav.search')}">
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
    <p class="meta c-header__tagline c-header__tagline--${where}">
      ${site.tagline}
      <span class="badge c-header__badge">${t('badge.fanMade')}</span>
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

/**
 * What follows the bar: the phone tagline (not on a compact page), which
 * scrolls away, then the search row, which stays pinned under the bar.
 * @param {boolean} compact @param {SearchProps|undefined} search
 * @returns {import('../core/html.js').SafeHtml}
 */
function below(compact, search) {
  return html`
    ${compact ? '' : html`<div class="c-header__below">${tagline('below')}</div>`}
    ${search ? html`<div class="c-header__below c-header__below--live">${searchRow(search)}</div>` : ''}
  `;
}

/**
 * The pinned `<header>` (Task 10b, owner's "desktop full, phone slim"):
 * one bar, pinned by header.css at `--sticky-top`'s height. The tagline
 * and search row sit *after* it, so on a phone they scroll away; the
 * tagline is rendered in both places, and CSS shows exactly one of them
 * (the hidden one is `display: none`, so a screen reader hears it once).
 * `search` (Task 10d: a page that searches in place) adds the search
 * row, with the page's placeholder and active-filter count; the bar then
 * has no search icon, since the box is right there.
 * @param {{ compact?: boolean, search?: SearchProps, nav?: import('../core/html.js').SafeHtml }} [props]
 * @returns {import('../core/html.js').SafeHtml}
 */
export function render(props = {}) {
  const { compact = false, search, nav } = props;
  return html`
    <header class="c-header"${compact ? html` data-compact` : ''}>
      <div class="c-header__bar">
        <div class="c-header__inner">
          ${brand(compact)}
          <div class="c-header__tools">
            ${themeToggle.render()}
            ${search ? '' : findLink()}
          </div>
          ${nav ?? ''}
        </div>
      </div>
    </header>
    ${below(compact, search)}
  `;
}
