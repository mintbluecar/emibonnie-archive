// @ts-check
/**
 * The home page: the events timeline, grouped by month (spec: "Home:
 * events timeline"). `composeHome` is pure (exported for DOM-free tests
 * on a `HomeView` snapshot); `start()` is the only part that touches the
 * DOM or the network. No markup of its own beyond what's needed to
 * arrange the header/footer/eventCard components and the month labels.
 */
import { html } from '../core/html.js';
import { mount } from '../core/dom.js';
import { getJson } from '../core/api.js';
import { site, t } from '../core/site.js';
import { monthLabel } from '../core/format.js';
import * as header from '../components/header.js';
import * as footer from '../components/footer.js';
import * as tabBar from '../components/tabBar.js';
import * as eventCard from '../components/eventCard.js';
import * as emptyState from '../components/emptyState.js';

const APP_SELECTOR = 'app';

/**
 * @param {import('../../../src/http/contracts.js').HomeView['months'][number]} group
 * @returns {import('../core/html.js').SafeHtml}
 */
function monthGroup(group) {
  return html`
    <section class="c-home-month">
      <h2 class="c-home-month__label">${monthLabel(group.month)}</h2>
      <div class="stack">${group.events.map((event) => eventCard.render({ event }))}</div>
    </section>
  `;
}

/**
 * @param {import('../../../src/http/contracts.js').HomeView} data
 * @returns {import('../core/html.js').SafeHtml}
 */
export function composeHome(data) {
  return html`
    ${header.render()}
    ${tabBar.render({ active: 'home' })}
    <main class="container">
      ${data.months.length === 0 ? emptyState.render({ message: t('home.empty') }) : data.months.map(monthGroup)}
    </main>
    ${footer.render()}
  `;
}

/**
 * Sends the header's search box and filter button to the search page,
 * since home has no live search of its own (spec: "the search box goes
 * to /search", "the filter icon goes to /search?filters=1").
 * @param {Element} root
 * @returns {void}
 */
function wireHeaderNav(root) {
  const searchBox = root.querySelector('.c-header__search-box');
  const filterBtn = root.querySelector('.c-header__filter-btn');
  searchBox?.addEventListener('focus', () => { window.location.href = '/search/'; });
  filterBtn?.addEventListener('click', () => { window.location.href = '/search/?filters=1'; });
}

/** @returns {Promise<void>} */
export async function start() {
  const root = document.getElementById(APP_SELECTOR);
  if (!root) return;
  document.title = site.name;
  const data = await getJson('/api/home');
  mount(root, composeHome(data));
  wireHeaderNav(root);
}

if (typeof document !== 'undefined') start();
