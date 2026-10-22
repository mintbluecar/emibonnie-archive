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
 */
import { html } from '../core/html.js';
import { mount, on } from '../core/dom.js';
import { getJson, ApiError } from '../core/api.js';
import { site, t, tCount } from '../core/site.js';
import * as chips from '../components/chips.js';
import * as emptyState from '../components/emptyState.js';
import * as pageShell from '../components/pageShell.js';
import * as headerLinks from '../components/headerLinks.js';
import { accountFromAccountPath, accountHref } from '../core/routes.js';
import { activeView, bindMore, bindSections, segmentedControl } from './hubGroups.js';
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
      <h1 class="c-account__handle">@${data.account.handle}</h1>
      ${data.account.profileUrl ? openProfileLink(data.account.profileUrl) : ''}
      <p class="c-hub__counts">${tCount('account.totals', data.counts.items)}</p>
    </div>
  `;
}

/** @param {AccountView} data @returns {import('../core/html.js').SafeHtml} */
export function composeAccount(data) {
  const content = html`
    ${headRow(data)}
    ${segmentedControl('byEvent', false)}
    <div class="c-hub__content">${activeView('byEvent', data.sections, {})}</div>
  `;
  return pageShell.render({ active: 'home', compact: true, content });
}

/** @returns {import('../core/html.js').SafeHtml} */
export function composeOptedOut() {
  return pageShell.render({ active: 'home', compact: true, content: emptyState.render({ message: t('account.optedOut'), icon: '🙈' }) });
}

/** @param {Element} root @param {AccountView} data @param {string} handle @returns {void} */
export function bind(root, data, handle) {
  headerLinks.bind(root);
  chips.bind(root);
  bindSections(root, data.sections);
  const segEl = root.querySelector('.c-hub__seg');
  /** @type {import('./hubGroups.js').HubCtx} */
  const ctx = { seg: 'byEvent', seq: 0, offset: {} };
  if (segEl) {
    on(segEl, '.c-chips__chip', 'click', (_e, chip) => {
      const value = chip.getAttribute('data-value');
      if (value !== 'byEvent' && value !== 'all') return;
      ctx.seg = value;
      for (const c of segEl.querySelectorAll('.c-chips__chip')) {
        const isOn = c.getAttribute('data-value') === value;
        c.classList.toggle('c-chips__chip--on', isOn);
        c.setAttribute('aria-pressed', String(isOn));
      }
      const contentEl = root.querySelector('.c-hub__content');
      if (contentEl) { mount(contentEl, activeView(ctx.seg, data.sections, {})); bindSections(contentEl, data.sections); }
    });
  }
  bindMore(root, `/api/account/${encodeURIComponent(handle)}`, data, ctx);
}

/** @param {Element} root @returns {void} */
function mountNotFound(root) {
  mount(root, pageShell.render({ active: 'home', compact: true, content: emptyState.render({ message: t('account.notFound') }) }));
}

/** @returns {Promise<void>} */
export async function start() {
  const root = document.getElementById(APP_SELECTOR);
  const handle = root && accountFromAccountPath(window.location.pathname);
  if (!root || !handle) return;
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
    mount(root, composeOptedOut());
    headerLinks.bind(root);
    return;
  }
  const view = /** @type {AccountView} */ (data);
  if (view.redirectTo && view.redirectTo !== handle) {
    window.location.replace(accountHref(view.redirectTo));
    return;
  }
  document.title = `@${view.account.handle} · ${site.name}`;
  mount(root, composeAccount(view));
  bind(root, view, handle);
}

if (typeof document !== 'undefined') start();
