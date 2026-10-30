// @ts-check
/**
 * The import review page's table (Plan 3): job header, state filter chips,
 * a search box, and every row with only the actions that make sense for
 * its state. The page owns fetching; this component renders and calls back.
 */
import { html } from '../core/html.js';
import { on } from '../core/dom.js';
import { postJson } from '../core/api.js';
import { t } from '../core/site.js';

/** Every state, in the order the chips show them. */
export const STATES = Object.freeze(['fetched', 'needs_speakers', 'check', 'attached', 'published', 'skipped', 'failed']);

/**
 * @typedef {{ id: number, state: string, translator: any, event: any, preview: any,
 *   itemId: number|null, error: string|null, sourceUrl: string, externalId: string,
 *   text: string, entryUrl: string|null, editUrl: string|null }} ImportRow
 * @typedef {{ jobId: number, job: any, counts: Record<string, number>, rows: ImportRow[],
 *   hasMore: boolean, state: string, q: string }} RowsState
 */

/**
 * @param {string} action @param {string} label @param {string} glyph @param {number} rowId
 */
function iconButton(action, label, glyph, rowId) {
  return html`<button class="btn btn--secondary btn--sm btn--icon" type="button" data-action="${action}" data-row="${rowId}"
    title="${label}" aria-label="${label}">${glyph}</button>`;
}

/** @param {ImportRow} row */
function actionsOf(row) {
  const open = row.entryUrl ? html`<a class="btn btn--secondary btn--sm" href="${row.entryUrl}">${t('import.row.open')}</a>` : '';
  const edit = row.editUrl ? html`<a class="btn btn--secondary btn--sm" href="${row.editUrl}">${t('import.row.edit')}</a>` : '';
  const tweet = row.sourceUrl ? html`<a class="btn btn--secondary btn--sm" href="${row.sourceUrl}" target="_blank" rel="noopener noreferrer">${t('import.row.tweet')}</a>` : '';
  if (row.state === 'published') return html`${open}${edit}${tweet}`;
  if (row.state === 'failed') return html`${tweet}${iconButton('retry', t('import.row.retry'), '↻', row.id)}${iconButton('skip', t('import.row.skip'), '✕', row.id)}`;
  if (row.state === 'check') return html`${open}${edit}${tweet}${iconButton('skip', t('import.row.skip'), '✕', row.id)}${iconButton('archive', t('import.row.archive'), '✓', row.id)}`;
  if (row.state === 'attached') return html`${open}${edit}${tweet}${iconButton('skip', t('import.row.skip'), '✕', row.id)}`;
  if (row.state === 'skipped') return html`${tweet}`;
  return html`${open}${edit}${tweet}${iconButton('skip', t('import.row.skip'), '✕', row.id)}`;
}

/** @param {RowsState} state */
function chips(state) {
  const total = Object.values(state.counts).reduce((sum, count) => sum + count, 0);
  const chip = (/** @type {string} */ value, /** @type {string} */ label, /** @type {number} */ count) => html`
    <button class="chip${state.state === value ? ' chip--on' : ''}" type="button"
      data-action="filter" data-state="${value}" aria-pressed="${String(state.state === value)}">${label} <span class="chip__count">${count}</span></button>
  `;
  return html`
    <div class="cluster cluster--2">
      ${chip('', t('import.state.queued') === 'queued' ? 'all' : 'all', total)}
      ${STATES.map((value) => chip(value, t(`import.state.${value}`), state.counts[value] ?? 0))}
    </div>
  `;
}

/**
 * Every row as a table: a card per row on a phone, each cell under its
 * column's name (its data-label).
 * @param {ImportRow[]} rows
 */
function table(rows) {
  const col = {
    state: t('import.col.state'), translator: t('import.col.translator'), text: t('import.col.text'),
    event: t('import.col.event'), actions: t('import.col.actions'),
  };
  return html`
    <div class="c-import__rows">
      <table class="table table--stack">
        <thead>
          <tr>
            <th scope="col">${col.state}</th>
            <th scope="col">${col.translator}</th>
            <th scope="col">${col.text}</th>
            <th scope="col">${col.event}</th>
            <th class="table__actions" scope="col">${col.actions}</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => html`
            <tr>
              <td class="c-import__state c-import__state--${row.state}" data-label="${col.state}">${t(`import.state.${row.state}`)}</td>
              <td class="meta" data-label="${col.translator}">${row.translator?.handle ? `@${row.translator.handle}` : '—'}</td>
              <td data-label="${col.text}"><span class="c-import__text">${row.text || row.error || row.externalId}</span></td>
              <td class="meta" data-label="${col.event}">${row.event?.name ?? '—'}</td>
              <td class="table__actions" data-label="${col.actions}"><div class="cluster cluster--2">${actionsOf(row)}</div></td>
            </tr>
          `)}
        </tbody>
      </table>
    </div>
  `;
}

/** @param {RowsState} state */
export function render(state) {
  const { job, rows } = state;
  const list = rows.length > 0 ? table(rows) : html`<p class="meta">${t('import.empty')}</p>`;
  return html`
    <section class="c-import stack stack--3">
      <header class="stack stack--1">
        <h1 class="heading heading--lg">${t('import.title')} ${job.id}</h1>
        <p class="meta">${t(`import.source.${job.source}`)} · ${t(`import.status.${job.status}`)} · ${job.createdAt.slice(0, 10)}</p>
      </header>
      ${chips(state)}
      <form class="field" data-import-search>
        <label class="field__label" for="c-import-q">${t('import.search')}</label>
        <input id="c-import-q" type="search" value="${state.q}" autocomplete="off">
      </form>
      ${list}
      ${state.hasMore ? html`<div class="cluster"><button class="btn btn--secondary" type="button" data-action="more">${t('import.more')}</button></div>` : ''}
      <p class="meta" role="status" data-import-status></p>
    </section>
  `;
}

/**
 * @param {Element} root
 * @param {{ state: RowsState, reload: (options?: { more?: boolean }) => Promise<void> }} handlers
 */
export function bind(root, { state, reload }) {
  const fail = () => {
    const status = root.querySelector('[data-import-status]');
    if (status) status.textContent = t('import.failed');
  };
  on(root, '[data-action="filter"]', 'click', (_event, button) => {
    state.state = button.getAttribute('data-state') ?? '';
    void reload().catch(fail);
  });
  on(root, '[data-import-search]', 'submit', (event, form) => {
    event.preventDefault();
    const input = /** @type {HTMLInputElement|null} */ (form.querySelector('input[type="search"]'));
    state.q = input?.value.trim() ?? '';
    void reload().catch(fail);
  });
  on(root, '[data-action="more"]', 'click', () => {
    // The page appends the next page; the button is a plain trigger.
    void reload({ more: true }).catch(fail);
  });
  /** @param {string} action @param {string|null} rowId */
  const act = async (action, rowId) => {
    try {
      if (action === 'retry') await postJson(`/api/owner/imports/${state.jobId}/retry`);
      else await postJson(`/api/owner/imports/${state.jobId}/rows/${rowId}/${action}`);
      await reload();
    } catch {
      fail();
    }
  };
  on(root, '[data-action="skip"]', 'click', (_event, button) => act('skip', button.getAttribute('data-row')));
  on(root, '[data-action="archive"]', 'click', (_event, button) => act('archive', button.getAttribute('data-row')));
  on(root, '[data-action="retry"]', 'click', () => act('retry', null));
}
