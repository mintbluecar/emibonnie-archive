// @ts-check
/**
 * The translator ("account") page (task-6-brief.md "Translator page"):
 * the handle, an "open profile ↗" link (only when the matched kind
 * defines one -- review round 1, I3: never hardcoded here), totals
 * (plural-aware, M1), and the same grouped/paged entries/segmented
 * control the person page shows (`hubGroups.js`, `person.byEvent`/
 * `person.allNewest` -- shared copy, since both read "by event"/"all,
 * newest" either way), minus person's own "with…" option (there's no
 * second translator to combine with). An opted-out account's response
 * carries nothing else (`OptedOutAccountView`): the page shows only
 * `account.optedOut` and stops. `redirectTo` (an old or differently-cased
 * handle) replaces the page at the current one, same as the person page.
 * The page searches within itself (Task 10d, `components/inlineSearch.js`):
 * this translator is preset as a removable chip, and results replace the
 * entries in place. The opted-out page has no box.
 */
import { html } from '../core/html.js';
import { mount, mountPage, on } from '../core/dom.js';
import { getJson, ApiError } from '../core/api.js';
import { site, t, tCount } from '../core/site.js';
import * as chips from '../components/chips.js';
import * as emptyState from '../components/emptyState.js';
import * as pageShell from '../components/pageShell.js';
import * as inlineSearch from '../components/inlineSearch.js';
import { filtersSlot, headerProps, region } from '../components/inlineSearchView.js';
import { accountFromAccountPath, accountHref } from '../core/routes.js';
import { activeView, bindMore, bindSections, segmentedControl, selectSegment } from './hubGroups.js';
import { mountLoadError } from './pageError.js';

const APP_SELECTOR = 'app';
/** @typedef {import('../../../src/http/contracts.js').AccountView} AccountView */
/** @typedef {import('../../../src/http/contracts.js').OptedOutAccountView} OptedOutAccountView */

/** @param {string} profileUrl @returns {import('../core/html.js').SafeHtml} */
const openProfileLink = (profileUrl) => html`<a class="c-account__open-profile" href="${profileUrl}" rel="noopener">${t('account.openProfile')}</a>`;

/** @param {AccountView} data @returns {import('../core/html.js').SafeHtml} */
function headRow(data) {
  return html`
    <div class="c-account__head">
      <h1 class="heading heading--md" data-handle>@${data.account.handle}</h1>
      ${data.account.profileUrl ? openProfileLink(data.account.profileUrl) : ''}
      <p class="meta c-account__counts">${tCount('account.totals', data.counts.items)}</p>
    </div>
  `;
}

/**
 * This translator's in-place search (Task 10d), from the page URL's query.
 * @param {string} handle @param {string} [query]
 * @returns {import('../components/inlineSearchView.js').Ctx}
 */
export function accountSearch(handle, query = '') {
  const scope = /** @type {const} */ ({ field: 'account', value: handle, label: `@${handle}` });
  return inlineSearch.prepare({ search: query, scope, placeholder: t('search.placeholderAccount', { handle }) });
}

/** @param {AccountView} data @param {import('../components/inlineSearchView.js').Ctx} [search] @returns {import('../core/html.js').SafeHtml} */
export function composeAccount(data, search = accountSearch(data.account.handle)) {
  const list = html`
    ${segmentedControl('byEvent', false)}
    <div data-hub-content>${activeView('byEvent', data.sections, {})}</div>
  `;
  const content = html`
    ${filtersSlot(search)}
    ${headRow(data)}
    ${region(search, list)}
  `;
  return pageShell.render({ active: 'home', compact: true, headerProps: headerProps(search), content });
}

/** @returns {import('../core/html.js').SafeHtml} */
export function composeOptedOut() {
  return pageShell.render({ active: 'home', compact: true, content: emptyState.render({ message: t('account.optedOut'), icon: '🙈' }) });
}

/** @param {Element} root @param {AccountView} data @param {string} handle @returns {void} */
export function bind(root, data, handle) {
  chips.bind(root);
  bindSections(root, data.sections);
  const segEl = root.querySelector('.c-hub__seg');
  /** @type {import('./hubGroups.js').HubCtx} */
  const ctx = { seg: 'byEvent', seq: 0, offset: {} };
  if (segEl) {
    on(segEl, '[data-value]', 'click', (_e, chip) => {
      const value = chip.getAttribute('data-value');
      if (value !== 'byEvent' && value !== 'all') return;
      ctx.seg = value;
      selectSegment(segEl, value);
      const contentEl = root.querySelector('[data-hub-content]');
      if (contentEl) { mount(contentEl, activeView(ctx.seg, data.sections, {})); bindSections(contentEl, data.sections); }
    });
  }
  bindMore(root, `/api/account/${encodeURIComponent(handle)}`, data, ctx);
}

/** @param {Element} root @returns {void} */
function mountNotFound(root) {
  mountPage(root, pageShell.render({ active: 'home', compact: true, content: emptyState.render({ message: t('account.notFound') }) }));
}

/** @returns {Promise<void>} */
export async function start() {
  const root = document.getElementById(APP_SELECTOR);
  const handle = root && accountFromAccountPath(window.location.pathname);
  if (!root || !handle) return;
  // A synchronous default, so the page never has an empty <title> while the
  // account fetch below is in flight (axe's document-title rule; same pattern
  // as home.js/item.js) -- overwritten with the account's own handle once it loads.
  document.title = site.name;
  /** @type {AccountView|OptedOutAccountView} */
  let data;
  try {
    data = await getJson(`/api/account/${encodeURIComponent(handle)}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      mountNotFound(root);
      return;
    }
    mountLoadError(root, { active: 'home' });
    return;
  }
  if ('optedOut' in data.account) {
    document.title = `${t('account.optedOut')} · ${site.name}`;
    mountPage(root, composeOptedOut());
    return;
  }
  const view = /** @type {AccountView} */ (data);
  if (view.redirectTo && view.redirectTo !== handle) {
    window.location.replace(accountHref(view.redirectTo));
    return;
  }
  document.title = `@${view.account.handle} · ${site.name}`;
  const search = accountSearch(view.account.handle, window.location.search);
  mountPage(root, composeAccount(view, search));
  bind(root, view, handle);
  inlineSearch.bind(root, search);
}

if (typeof document !== 'undefined') start();
