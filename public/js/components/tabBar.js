// @ts-check
/**
 * The phone tab bar / web top nav: home · ＋ add · me (Task 10d: no
 * search tab -- search happens in place, and home is the search). Same
 * markup for both; `src/styles/components/tabBar.css` swaps the layout at
 * the 860px breakpoint (see docs/.../1b plan, "Additional constraints" →
 * Layout breakpoint), so there is no JS branch here for "web" vs "phone".
 */
import { html } from '../core/html.js';
import { t } from '../core/site.js';
import { HOME_PATH, ADD_PATH, ME_PATH } from '../core/routes.js';

/** @typedef {'home'|'add'|'me'} TabKey */

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
          >${tab.key === 'add' ? html`<span aria-hidden="true">＋</span> ` : ''}${labelFor(tab.key)}</a>
        `;
      })}
    </nav>
  `;
}
