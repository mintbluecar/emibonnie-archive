// @ts-check
/**
 * The owner's section of the me page (Plan 2b, until Plan 3's admin):
 * the approval switch, the waiting list (approve / reject), open reports
 * (hide / restore / dismiss), users (search, block / unblock) and the X
 * sign-in failure note. Every action posts, then the page refetches the
 * whole owner view so the lists always agree with the server.
 *
 * Every icon-only control carries both a `title` and an `aria-label`
 * from one copy key; the switch's label and the search input's label are
 * the only text controls here.
 */
import { html } from '../core/html.js';
import { on } from '../core/dom.js';
import { getJson, postJson } from '../core/api.js';
import { t } from '../core/site.js';
import * as previewCard from './previewCard.js';

/** @typedef {import('../../../src/http/contracts.js').OwnerView} OwnerView */
/** @typedef {import('../../../src/http/contracts.js').ReportVM} ReportVM */
/** @typedef {import('../../../src/http/contracts.js').OwnerUser} OwnerUser */
/** @typedef {{ approvalRequired: boolean, signInFailedAt: string|null, waiting: any[],
 *   reports: ReportVM[], users: OwnerUser[]|null, query: string }} OwnerState */

/**
 * @param {string} action @param {string} label @param {string} glyph
 * @param {Record<string, string>} [data]
 * @returns {import('../core/html.js').SafeHtml}
 */
function iconButton(action, label, glyph, data = {}) {
  return html`<button class="c-owner__icon" type="button" data-action="${action}"
    data-kind="${data['data-kind'] ?? ''}" data-source="${data['data-source'] ?? ''}"
    data-id="${data['data-id'] ?? ''}" data-user="${data['data-user'] ?? ''}"
    title="${label}" aria-label="${label}">${glyph}</button>`;
}

/** @param {ReportVM} report @returns {import('../core/html.js').SafeHtml} */
function reportRow(report) {
  const who = report.reporter === null
    ? t('owner.fan')
    : report.reporter.kind === 'handle' ? `@${report.reporter.handle}`
      : report.reporter.kind === 'name' ? report.reporter.name : t('owner.fan');
  return html`
    <li class="c-owner__row">
      <div class="c-owner__text">
        <p class="c-owner__reason">${report.reason}</p>
        <p class="c-owner__meta">
          ${t('owner.reportBy', { who })}
          ${report.target.url ? html` · <a class="c-owner__link" href="${report.target.url}">${report.target.label}</a>` : ''}
          ${report.target.hidden ? html` · <span class="c-owner__hidden">${t('owner.hidden')}</span>` : ''}
        </p>
      </div>
      <div class="c-owner__actions">
        ${report.target.hidden
          ? (report.target.restorable ? iconButton('restore-report', t('owner.restore'), '↺', { 'data-id': String(report.id) }) : '')
          : iconButton('hide-report', t('owner.hide'), '⤫', { 'data-id': String(report.id) })}
        ${iconButton('dismiss-report', t('owner.dismiss'), '✕', { 'data-id': String(report.id) })}
      </div>
    </li>
  `;
}

/** @param {OwnerUser} user @returns {import('../core/html.js').SafeHtml} */
function userRow(user) {
  const name = user.handle ? `@${user.handle}` : user.displayName ?? t('owner.fan');
  return html`
    <li class="c-owner__row">
      <span class="c-owner__text">${name}${user.blocked ? html` · <span class="c-owner__hidden">${t('owner.blocked')}</span>` : ''}</span>
      ${user.blocked
        ? iconButton('unblock', t('owner.unblock'), '↺', { 'data-user': user.id })
        : iconButton('block', t('owner.block'), '⤫', { 'data-user': user.id })}
    </li>
  `;
}

/** @param {OwnerState} owner @returns {import('../core/html.js').SafeHtml} */
function alertBlock(owner) {
  if (!owner.signInFailedAt) return html``;
  const at = new Date(owner.signInFailedAt);
  const time = Number.isNaN(at.getTime()) ? owner.signInFailedAt : at.toISOString().slice(0, 16).replace('T', ' ');
  return html`
    <p class="c-owner__alert">${t('owner.alert', { time })}
      ${iconButton('dismiss-alert', t('owner.alertDismiss'), '✕')}</p>
  `;
}

/** @param {OwnerState} owner @returns {import('../core/html.js').SafeHtml} */
function waitingBlock(owner) {
  const rows = owner.waiting.map((item) => html`
    <li class="c-owner__row">
      ${previewCard.render({ result: item, compact: true })}
      <div class="c-owner__actions">
        ${iconButton('approve', t('owner.approve'), '✓', { 'data-kind': item.kind, 'data-source': item.sourceId })}
        ${iconButton('reject', t('owner.reject'), '✕', { 'data-kind': item.kind, 'data-source': item.sourceId })}
      </div>
    </li>
  `);
  return html`
    <h3 class="c-owner__heading">${t('owner.waiting')}</h3>
    ${rows.length > 0 ? html`<ul class="c-owner__list">${rows}</ul>` : html`<p class="c-owner__empty">${t('owner.waitingEmpty')}</p>`}
  `;
}

/** @param {OwnerState} owner @returns {import('../core/html.js').SafeHtml} */
function reportsBlock(owner) {
  return html`
    <h3 class="c-owner__heading">${t('owner.reports')}</h3>
    ${owner.reports.length > 0 ? html`<ul class="c-owner__list">${owner.reports.map(reportRow)}</ul>`
      : html`<p class="c-owner__empty">${t('owner.reportsEmpty')}</p>`}
  `;
}

/** @param {OwnerState} owner @returns {import('../core/html.js').SafeHtml} */
function usersBlock(owner) {
  const results = owner.users ?? [];
  return html`
    <h3 class="c-owner__heading">${t('owner.users')}</h3>
    <form class="c-owner__search">
      <label class="c-owner__label" for="c-owner-users">${t('owner.usersSearch')}</label>
      <input class="c-owner__input" id="c-owner-users" type="search" value="${owner.query}" autocomplete="off">
    </form>
    ${owner.users !== null && results.length === 0 ? html`<p class="c-owner__empty">${t('owner.noUsers')}</p>` : ''}
    ${results.length > 0 ? html`<ul class="c-owner__list">${results.map(userRow)}</ul>` : ''}
  `;
}

/** @param {OwnerState} owner @returns {import('../core/html.js').SafeHtml} */
export function render(owner) {
  return html`
    <section class="c-owner">
      <h2 class="c-owner__title">${t('owner.title')}</h2>
      ${alertBlock(owner)}
      <label class="c-owner__switch">
        <input class="c-owner__checkbox" type="checkbox" data-action="approval" ${owner.approvalRequired ? 'checked' : ''}>
        <span>${t('owner.approval')}</span>
      </label>
      ${waitingBlock(owner)}
      ${reportsBlock(owner)}
      ${usersBlock(owner)}
      <p class="c-owner__status" role="status" data-owner-status></p>
    </section>
  `;
}

/**
 * @param {Element} root
 * @param {{ owner: OwnerState, reload: () => Promise<void>, rerender: () => void }} handlers
 * @returns {void}
 */
export function bind(root, { owner, reload, rerender }) {
  previewCard.bind(root);
  const fail = () => {
    const status = root.querySelector('[data-owner-status]');
    if (status) status.textContent = t('owner.failed');
  };
  /** @param {() => Promise<unknown>} action */
  const act = async (action) => {
    try { await action(); await reload(); } catch { fail(); }
  };

  on(root, '[data-action="approval"]', 'change', (_event, input) => {
    void act(() => postJson('/api/owner/approval', { required: Boolean(/** @type {HTMLInputElement} */ (input).checked) }));
  });
  on(root, '[data-action="approve"]', 'click', (_event, button) => {
    const body = { state: 'published' };
    void act(() => postJson(`/api/owner/items/${button.getAttribute('data-kind')}/${button.getAttribute('data-source')}/review`, body));
  });
  on(root, '[data-action="reject"]', 'click', (_event, button) => {
    const body = { state: 'rejected' };
    void act(() => postJson(`/api/owner/items/${button.getAttribute('data-kind')}/${button.getAttribute('data-source')}/review`, body));
  });
  on(root, '[data-action="hide-report"], [data-action="restore-report"], [data-action="dismiss-report"]', 'click', (_event, button) => {
    const verb = button.getAttribute('data-action') === 'hide-report' ? 'hide'
      : button.getAttribute('data-action') === 'restore-report' ? 'restore' : 'dismiss';
    void act(() => postJson(`/api/owner/reports/${button.getAttribute('data-id')}/${verb}`));
  });
  on(root, '[data-action="block"], [data-action="unblock"]', 'click', async (_event, button) => {
    const verb = button.getAttribute('data-action') === 'block' ? 'block' : 'unblock';
    try {
      await postJson(`/api/owner/users/${verb}`, { userId: button.getAttribute('data-user') });
      owner.users = (await getJson('/api/owner/users', { q: owner.query })).users;
      rerender();
    } catch {
      fail();
    }
  });
  on(root, '[data-action="dismiss-alert"]', 'click', () => {
    void act(() => postJson('/api/owner/sign-in-alert/dismiss'));
  });
  on(root, '.c-owner__search', 'submit', async (event, form) => {
    event.preventDefault();
    const input = /** @type {HTMLInputElement|null} */ (form.querySelector('.c-owner__input'));
    owner.query = input?.value ?? '';
    try {
      owner.users = (await getJson('/api/owner/users', { q: owner.query })).users;
      rerender();
    } catch {
      fail();
    }
  });
}
