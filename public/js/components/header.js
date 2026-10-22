// @ts-check
/**
 * The top header: logo (when the site has one), wordmark (the accent part
 * in the brand gradient), tagline, the FAN-MADE badge, then a search box
 * and a filter-icon button. See the design spec's "Visual design" and
 * mockups/search-v2.html (`compact` drops the tagline/badge row, for a
 * page that already shows them elsewhere).
 */
import { html } from '../core/html.js';
import { site, t } from '../core/site.js';

/**
 * @param {{ compact?: boolean }} [props]
 * @returns {import('../core/html.js').SafeHtml}
 */
export function render(props = {}) {
  const { compact = false } = props;
  return html`
    <header class="c-header${compact ? ' c-header--compact' : ''}">
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
      <div class="c-header__search">
        <input class="c-header__search-box" type="search" placeholder="${t('search.placeholder')}">
        <button class="c-header__filter-btn" type="button" aria-label="${t('search.filters')}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
            <path d="M4 6h16M7 12h10M10 18h4" />
          </svg>
        </button>
      </div>
    </header>
  `;
}
