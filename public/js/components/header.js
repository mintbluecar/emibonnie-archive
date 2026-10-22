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
 * whose box is the page's own live search and so stays on desktop too.
 */
import { html } from '../core/html.js';
import { site, t } from '../core/site.js';

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
    <div class="c-header__search">
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

/**
 * @param {{ compact?: boolean, filterCount?: number, liveSearch?: boolean, nav?: import('../core/html.js').SafeHtml }} [props]
 * @returns {import('../core/html.js').SafeHtml}
 */
export function render(props = {}) {
  const { compact = false, filterCount, liveSearch = false, nav } = props;
  return html`
    <header class="c-header${compact ? ' c-header--compact' : ''}${liveSearch ? ' c-header--live' : ''}">
      <div class="c-header__bar">
        <div class="c-header__inner">
          <div class="c-header__brand">
            <div class="c-header__row">
              ${site.logo ? html`<img class="c-header__logo" src="${site.logo}" alt="" width="34" height="34">` : ''}
              <span class="c-header__wordmark">
                <span class="c-header__accent">${site.wordmark.accent}</span>${site.wordmark.rest}
              </span>
            </div>
            ${compact ? '' : html`
              <p class="c-header__tagline">
                ${site.tagline}
                <span class="c-header__badge">${t('badge.fanMade')}</span>
              </p>
            `}
          </div>
          ${nav ?? ''}
        </div>
      </div>
      ${searchRow(filterCount)}
    </header>
  `;
}
