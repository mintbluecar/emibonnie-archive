// @ts-check
/**
 * The home page: the events timeline, grouped by month (spec: "Home:
 * events timeline") -- and the search (Task 10d: "Home is the search").
 * The timeline shows until something is typed or filtered, then the
 * results replace it in place (`components/inlineSearch.js`), and
 * clearing brings it back. `composeHome` is pure (exported for DOM-free
 * tests on a `HomeView` snapshot); `start()` is the only part that
 * touches the DOM or the network.
 */
import { html } from '../core/html.js';
import { mountPage } from '../core/dom.js';
import { getJson } from '../core/api.js';
import { site, t } from '../core/site.js';
import { monthLabel } from '../core/format.js';
import * as pageShell from '../components/pageShell.js';
import * as eventCard from '../components/eventCard.js';
import { EAGER_COUNT } from '../components/thumb.js';
import * as emptyState from '../components/emptyState.js';
import * as inlineSearch from '../components/inlineSearch.js';
import { filtersSlot, headerProps, region } from '../components/inlineSearchView.js';

const APP_SELECTOR = 'app';

/**
 * @param {import('../../../src/http/contracts.js').HomeView['months'][number]} group
 * @param {number} before how many events the months above it hold (the first `EAGER_COUNT` overall load their picture eagerly)
 * @returns {import('../core/html.js').SafeHtml}
 */
function monthGroup(group, before) {
  return html`
    <section>
      <h2 class="label label--section c-home-month__label">${monthLabel(group.month)}</h2>
      <div class="c-home-month__grid">${group.events.map((event, i) => eventCard.render({ event, eager: before + i < EAGER_COUNT }))}</div>
    </section>
  `;
}

/** @param {import('../../../src/http/contracts.js').HomeView['months']} months @returns {import('../core/html.js').SafeHtml} */
function monthGroups(months) {
  let before = 0;
  return html`${months.map((group) => {
    const markup = monthGroup(group, before);
    before += group.events.length;
    return markup;
  })}`;
}

/**
 * @param {import('../../../src/http/contracts.js').HomeView} data
 * @param {import('../components/inlineSearchView.js').Ctx} [search] the page's search (`inlineSearch.prepare`); none typed by default
 * @returns {import('../core/html.js').SafeHtml}
 */
export function composeHome(data, search = inlineSearch.prepare({ search: '' })) {
  const list = data.months.length === 0 ? emptyState.render({ message: t('home.empty') }) : monthGroups(data.months);
  return pageShell.render({ active: 'home', headerProps: headerProps(search), content: html`${filtersSlot(search)}${region(search, list)}` });
}

/** @returns {Promise<void>} */
export async function start() {
  const root = document.getElementById(APP_SELECTOR);
  if (!root) return;
  document.title = site.name;
  const search = inlineSearch.prepare({ search: window.location.search });
  const data = await getJson('/api/home');
  mountPage(root, composeHome(data, search));
  inlineSearch.bind(root, search);
}

if (typeof document !== 'undefined') start();
