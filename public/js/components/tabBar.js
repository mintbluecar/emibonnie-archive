// @ts-check
/**
 * The phone tab bar / web top nav: home · ＋ add · me (Task 10d: no
 * search tab -- search happens in place, and home is the search), drawn
 * as icons (owner, 2026-11-09); each link's name and tooltip are its
 * word, so a screen reader still says "Home", "Add", "Me". Same
 * markup for both; `src/styles/components/tabBar.css` swaps the layout at
 * the 860px breakpoint (see docs/.../1b plan, "Additional constraints" →
 * Layout breakpoint), so there is no JS branch here for "web" vs "phone".
 */
import { html } from '../core/html.js';
import { t } from '../core/site.js';
import { HOME_PATH, ADD_PATH, ME_PATH } from '../core/routes.js';

/** @typedef {'home'|'add'|'me'} TabKey */

/** Line icons, in the header's search icon's style (24px grid, round 2.2 strokes). @type {Record<TabKey, import('../core/html.js').SafeHtml>} */
const ICONS = {
  home: html`<path d="M3.5 10.5 12 3.5l8.5 7"/><path d="M5.5 9v11h4.5v-6h4v6h4.5V9"/>`,
  add: html`<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>`,
  me: html`<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5c0-4 3.4-6.5 7.5-6.5s7.5 2.5 7.5 6.5"/>`,
};

/** @type {{ key: TabKey, href: string }[]} */
const TABS = [
  { key: 'home', href: HOME_PATH },
  { key: 'add', href: ADD_PATH },
  { key: 'me', href: ME_PATH },
];

/** @param {TabKey} key @returns {string} */
function labelFor(key) {
  if (key === 'home') return t('nav.home');
  if (key === 'add') return t('nav.add');
  return t('nav.me');
}

/**
 * @param {{ active?: TabKey }} [props]
 * @returns {import('../core/html.js').SafeHtml}
 */
export function render(props = {}) {
  const { active } = props;
  return html`
    <nav class="c-tabbar" aria-label="${t('nav.home')}">
      ${TABS.map((tab) => {
        const isActive = tab.key === active;
        return html`
          <a
            class="c-tabbar__item"
            href="${tab.href}"
            aria-current="${isActive ? 'page' : 'false'}"
            aria-label="${labelFor(tab.key)}"
            title="${labelFor(tab.key)}"
          ><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[tab.key]}</svg></a>
        `;
      })}
    </nav>
  `;
}
