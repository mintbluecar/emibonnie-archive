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
import { importHref } from '../core/routes.js';
import * as previewCard from './previewCard.js';

/** @typedef {import('../../../src/http/contracts.js').OwnerView} OwnerView */
/** @typedef {import('../../../src/http/contracts.js').ReportVM} ReportVM */
/** @typedef {import('../../../src/http/contracts.js').OwnerUser} OwnerUser */
/** @typedef {{ approvalRequired: boolean, signInFailedAt: string|null, waiting: any[],
 *   reports: ReportVM[], users: OwnerUser[]|null, query: string, imports: any[] }} OwnerState */

/**
 * @param {string} action @param {string} label @param {string} glyph
 * @param {Record<string, string>} [data]
 * @returns {import('../core/html.js').SafeHtml}
 */
function iconButton(action, label, glyph, data = {}) {
  return html`<button class="btn btn--secondary btn--sm btn--icon" type="button" data-action="${action}"
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
    <tr>
      <td>
        <p class="c-owner__reason">${report.reason}</p>
        <p class="meta">
          ${t('owner.reportBy', { who })}
          ${report.target.url ? html` · <a class="c-owner__link" href="${report.target.url}">${report.target.label}</a>` : ''}
          ${report.target.hidden ? html` <span class="badge badge--danger">${t('owner.hidden')}</span>` : ''}
        </p>
      </td>
      <td class="table__actions">
        <div class="cluster cluster--1 c-owner__actions">
          ${report.target.hidden
            ? (report.target.restorable ? iconButton('restore-report', t('owner.restore'), '↺', { 'data-id': String(report.id) }) : '')
            : iconButton('hide-report', t('owner.hide'), '⤫', { 'data-id': String(report.id) })}
          ${iconButton('dismiss-report', t('owner.dismiss'), '✕', { 'data-id': String(report.id) })}
        </div>
      </td>
    </tr>
  `;
}

/** @param {OwnerUser} user @returns {import('../core/html.js').SafeHtml} */
function userRow(user) {
  const name = user.handle ? `@${user.handle}` : user.displayName ?? t('owner.fan');
  return html`
    <tr>
      <td>${name}${user.blocked ? html` <span class="badge badge--danger">${t('owner.blocked')}</span>` : ''}</td>
      <td class="table__actions">
        <div class="cluster cluster--1 c-owner__actions">
          ${user.blocked
            ? iconButton('unblock', t('owner.unblock'), '↺', { 'data-user': user.id })
            : iconButton('block', t('owner.block'), '⤫', { 'data-user': user.id })}
        </div>
      </td>
    </tr>
  `;
}

/**
 * A two-column owner table: what (reports or users) and the actions.
 * @param {string} what the first column's heading
 * @param {import('../core/html.js').SafeHtml[]} rows
 * @returns {import('../core/html.js').SafeHtml}
 */
function ownerTable(what, rows) {
  return html`
    <table class="table c-owner__table">
      <thead>
        <tr><th scope="col">${what}</th><th class="table__actions" scope="col">${t('owner.col.actions')}</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

/** @param {OwnerState} owner @returns {import('../core/html.js').SafeHtml} */
function alertBlock(owner) {
  if (!owner.signInFailedAt) return html``;
  const at = new Date(owner.signInFailedAt);
  const time = Number.isNaN(at.getTime()) ? owner.signInFailedAt : at.toISOString().slice(0, 16).replace('T', ' ');
  return html`
    <p class="notice notice--error c-owner__alert">${t('owner.alert', { time })}
      ${iconButton('dismiss-alert', t('owner.alertDismiss'), '✕')}</p>
  `;
}

/** @param {OwnerState} owner @returns {import('../core/html.js').SafeHtml} */
function waitingBlock(owner) {
  const rows = owner.waiting.map((item) => html`
    <li class="c-owner__row">
      ${previewCard.render({ result: item, compact: true })}
      <div class="cluster cluster--1 c-owner__actions">
        ${iconButton('approve', t('owner.approve'), '✓', { 'data-kind': item.kind, 'data-source': item.sourceId })}
        ${iconButton('reject', t('owner.reject'), '✕', { 'data-kind': item.kind, 'data-source': item.sourceId })}
      </div>
    </li>
  `);
  return html`
    <h3 class="label c-owner__heading">${t('owner.waiting')}</h3>
    ${rows.length > 0 ? html`<ul class="c-owner__list">${rows}</ul>` : html`<p class="meta">${t('owner.waitingEmpty')}</p>`}
  `;
}

/** The five most recent import jobs (Plan 3), each a link to its review page. @param {OwnerState} owner */
function importsBlock(owner) {
  if (owner.imports.length === 0) return html``;
  const rows = owner.imports.map((job) => {
    const total = Object.values(job.counts ?? {}).reduce((/** @type {number} */ sum, /** @type {any} */ n) => sum + n, 0);
    return html`
      <li class="c-owner__row">
        <span class="c-owner__text">
          <a class="c-owner__link" href="${importHref(job.id)}">${t('import.title')} ${job.id}</a>
          · ${t(`import.source.${job.source}`)} · ${t(`import.status.${job.status}`)}
          · ${t('import.rows', { n: total })} · ${t('import.state.published')} ${job.counts?.published ?? 0}
        </span>
      </li>
    `;
  });
  return html`
    <h3 class="label c-owner__heading">${t('owner.imports')}</h3>
    <ul class="c-owner__list">${rows}</ul>
  `;
}

/** @param {OwnerState} owner @returns {import('../core/html.js').SafeHtml} */
function reportsBlock(owner) {
  return html`
    <h3 class="label c-owner__heading">${t('owner.reports')}</h3>
    ${owner.reports.length > 0 ? ownerTable(t('owner.col.report'), owner.reports.map(reportRow))
      : html`<p class="meta">${t('owner.reportsEmpty')}</p>`}
  `;
}

/** @param {OwnerState} owner @returns {import('../core/html.js').SafeHtml} */
function usersBlock(owner) {
  const results = owner.users ?? [];
  return html`
    <h3 class="label c-owner__heading">${t('owner.users')}</h3>
    <form class="field" data-owner-search>
      <label class="field__label" for="c-owner-users">${t('owner.usersSearch')}</label>
      <input id="c-owner-users" type="search" value="${owner.query}" autocomplete="off" data-owner-query>
    </form>
    ${owner.users !== null && results.length === 0 ? html`<p class="meta c-owner__after-search">${t('owner.noUsers')}</p>` : ''}
    ${results.length > 0 ? html`<div class="c-owner__after-search">${ownerTable(t('owner.col.user'), results.map(userRow))}</div>` : ''}
  `;
}

/** @param {OwnerState} owner @returns {import('../core/html.js').SafeHtml} */
export function render(owner) {
  return html`
    <section class="card c-owner">
      <h2 class="heading heading--md c-owner__title">${t('owner.title')}</h2>
      ${alertBlock(owner)}
      <label class="check c-owner__switch">
        <input type="checkbox" data-action="approval" ${owner.approvalRequired ? 'checked' : ''}>
        <span>${t('owner.approval')}</span>
      </label>
      ${waitingBlock(owner)}
      ${importsBlock(owner)}
      ${reportsBlock(owner)}
      ${usersBlock(owner)}
      <p class="notice notice--error c-owner__status" role="status" data-owner-status></p>
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
  on(root, '[data-owner-search]', 'submit', async (event, form) => {
    event.preventDefault();
    const input = /** @type {HTMLInputElement|null} */ (form.querySelector('[data-owner-query]'));
    owner.query = input?.value ?? '';
    try {
      owner.users = (await getJson('/api/owner/users', { q: owner.query })).users;
      rerender();
    } catch {
      fail();
    }
  });
}
