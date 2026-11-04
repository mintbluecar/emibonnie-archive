// @ts-check
/**
 * The owner's events list (event editing, spec screen ①, `/admin/events`):
 * a search box, one row per event (tick, date, name, entry count, people,
 * a "hidden" badge, and the Edit and Tweets links), "merge N events…"
 * once two or more rows are ticked, and paging by `offset` (50 a page,
 * `GET /api/owner/events`).
 *
 * The page rules (CONTRIBUTING.md, Page): `composeAdminEvents` is pure;
 * the first paint is `mountPage`; the initial load is wrapped -- a 401,
 * 403 or 404 shows the page's own not-found state, as does a signed-in
 * non-owner (a signed-out visitor is offered sign-in, as on the import
 * review page), anything else `mountLoadError`. Every refetch (search,
 * paging) goes through `load`, whose sequence check drops a response a
 * newer request overtook, and repaints only the results, so the search
 * box keeps its focus. Ticks reset whenever the search or page changes.
 */
import { html } from '../core/html.js';
import { mount, mountPage, on } from '../core/dom.js';
import { getJson, ApiError } from '../core/api.js';
import { getMe } from '../core/session.js';
import { debounced } from '../core/debounce.js';
import { site, t, tCount } from '../core/site.js';
import { ADMIN_EVENTS_PATH, adminEventEditHref, adminEventEntriesHref, adminEventMergeHref } from '../core/routes.js';
import * as pageShell from '../components/pageShell.js';
import * as emptyState from '../components/emptyState.js';
import * as signIn from '../components/signIn.js';
import { mountLoadError } from './pageError.js';

const APP_SELECTOR = 'app';
const API_PATH = '/api/owner/events';
/** `GET /api/owner/events`'s page size. */
const PAGE_SIZE = 50;
/** The same pause as the in-place search (`components/inlineSearch.js`). */
const DEBOUNCE_MS = 250;
/** The statuses the API answers a viewer who isn't the owner with. */
const REFUSED = new Set([401, 403, 404]);

/** @typedef {import('../../../src/http/contracts.js').AdminEventList} AdminEventList */
/** @typedef {import('../../../src/http/contracts.js').AdminEventRow} AdminEventRow */
/** @typedef {import('../core/html.js').SafeHtml} SafeHtml */
/** @typedef {{ user: null | { isOwner: boolean } }} Me */
/** @typedef {{ me: Me, q: string, offset: number, ticked: Set<number>, seq: number }} AdminEventsState */

/** @param {Me} me @returns {AdminEventsState} */
export function newState(me) {
  return { me, q: '', offset: 0, ticked: new Set(), seq: 0 };
}

const columns = () => ({
  tick: t('adminEvents.col.tick'), date: t('adminEvents.col.date'), name: t('adminEvents.col.name'),
  entries: t('adminEvents.col.entries'), people: t('adminEvents.col.people'), actions: t('adminEvents.col.actions'),
});

/** @param {AdminEventRow} event @param {boolean} ticked @param {ReturnType<typeof columns>} col @returns {SafeHtml} */
function eventRow(event, ticked, col) {
  return html`
    <tr data-event="${event.id}">
      <td data-label="${col.tick}"><label class="check check--bare">
        <input type="checkbox" data-action="tick" value="${event.id}" aria-label="${t('adminEvents.tick', { name: event.name })}" ${ticked ? 'checked' : ''}>
      </label></td>
      <td class="meta" data-label="${col.date}">${event.occurredOn}</td>
      <td data-label="${col.name}"><span class="c-admin-events__name">${event.name}</span>${event.hidden ? html` <span class="badge badge--danger">${t('adminEvents.hidden')}</span>` : ''}</td>
      <td class="table__num" data-label="${col.entries}">${event.entryCount}</td>
      <td class="meta" data-label="${col.people}">${event.people.length > 0 ? event.people.join(', ') : '—'}</td>
      <td class="table__actions" data-label="${col.actions}"><div class="cluster cluster--2">
        <a class="btn btn--secondary btn--sm" href="${adminEventEditHref(event.id)}">${t('adminEvents.edit')}</a>
        <a class="btn btn--secondary btn--sm" href="${adminEventEntriesHref(event.id)}">${t('adminEvents.tweets')}</a>
      </div></td>
    </tr>
  `;
}

/** @param {AdminEventRow[]} events @param {Set<number>} ticked @returns {SafeHtml} */
function table(events, ticked) {
  const col = columns();
  return html`
    <table class="table table--stack table--raised">
      <thead><tr>
        <th scope="col">${col.tick}</th><th scope="col">${col.date}</th><th scope="col">${col.name}</th>
        <th class="table__num" scope="col">${col.entries}</th><th scope="col">${col.people}</th>
        <th class="table__actions" scope="col">${col.actions}</th>
      </tr></thead>
      <tbody>${events.map((event) => eventRow(event, ticked.has(event.id), col))}</tbody>
    </table>
  `;
}

/** "Merge N events…": a link once two or more are ticked, a disabled button before. @param {Set<number>} ticked @returns {SafeHtml} */
function mergeControl(ticked) {
  if (ticked.size >= 2) {
    return html`<a class="btn btn--primary" data-admin-events-merge href="${adminEventMergeHref([...ticked])}">${t('adminEvents.merge', { n: ticked.size })}</a>`;
  }
  return html`<button class="btn btn--primary" type="button" data-admin-events-merge disabled>${t('adminEvents.mergeNone')}</button>
    <span class="meta">${t('adminEvents.mergeHint')}</span>`;
}

/** @param {number} offset @param {string} label @returns {SafeHtml} */
const pageButton = (offset, label) => html`<button class="btn btn--secondary btn--sm" type="button" data-action="page" data-offset="${offset}">${label}</button>`;

/** Newer / older, by `offset`, with where this page sits. @param {number} total @param {number} offset @returns {SafeHtml} */
function pager(total, offset) {
  if (total <= PAGE_SIZE) return html``;
  const range = t('adminEvents.range', { from: offset + 1, to: Math.min(offset + PAGE_SIZE, total), total });
  return html`
    <div class="cluster cluster--2">
      ${offset > 0 ? pageButton(Math.max(0, offset - PAGE_SIZE), t('adminEvents.newer')) : ''}
      <span class="meta">${range}</span>
      ${offset + PAGE_SIZE < total ? pageButton(offset + PAGE_SIZE, t('adminEvents.older')) : ''}
    </div>
  `;
}

/** The part a search or a page change repaints. @param {AdminEventList} data @param {AdminEventsState} state @returns {SafeHtml} */
export function composeResults(data, state) {
  if (data.events.length === 0) return html`<p class="meta">${t('adminEvents.empty')}</p>`;
  return html`
    <p class="meta">${tCount('adminEvents.matches', data.total)} · <span data-admin-events-ticked>${t('adminEvents.ticked', { n: state.ticked.size })}</span></p>
    ${table(data.events, state.ticked)}
    <div class="cluster cluster--2" data-admin-events-merge-slot>${mergeControl(state.ticked)}</div>
    ${pager(data.total, state.offset)}
  `;
}

/** @param {AdminEventList} data @param {AdminEventsState} state @returns {SafeHtml} */
function listContent(data, state) {
  return html`
    <section class="c-admin-events stack stack--3">
      <h1 class="heading heading--lg">${t('adminEvents.title')}</h1>
      <form class="field" role="search" data-admin-events-search>
        <label class="field__label" for="c-admin-events-q">${t('adminEvents.search')}</label>
        <input id="c-admin-events-q" type="search" value="${state.q}" autocomplete="off">
      </form>
      <div class="stack stack--3" data-admin-events-results>${composeResults(data, state)}</div>
      <p class="meta" role="status" data-admin-events-status></p>
    </section>
  `;
}

/**
 * The whole page: the list for the owner; sign-in for a signed-out
 * visitor; the not-found state for anyone else, or when the API refused
 * (`data` is `null`).
 * @param {AdminEventList|null} data @param {AdminEventsState} state
 * @returns {import('../core/html.js').ShellHtml}
 */
export function composeAdminEvents(data, state) {
  if (!state.me.user) {
    const content = html`<h1 class="heading heading--lg">${t('adminEvents.title')}</h1>${signIn.render({ returnTo: ADMIN_EVENTS_PATH })}`;
    return pageShell.render({ active: 'me', compact: true, content });
  }
  if (!state.me.user.isOwner || !data) {
    return pageShell.render({ active: 'me', compact: true, content: emptyState.render({ message: t('adminEvents.notFound') }) });
  }
  return pageShell.render({ active: 'me', content: listContent(data, state) });
}

/**
 * Fetches the current search and page and paints it, unless a later
 * `load` started meanwhile (`state.seq`). The first call paints the
 * whole page; later ones only the results. A failure is the caller's.
 * @param {Element} root @param {AdminEventsState} state @returns {Promise<void>}
 */
export async function load(root, state) {
  state.seq += 1;
  const mine = state.seq;
  /** @type {AdminEventList} */
  const data = await getJson(API_PATH, { q: state.q || undefined, offset: state.offset });
  if (mine !== state.seq) return;
  const results = root.querySelector('[data-admin-events-results]');
  if (results) mount(results, composeResults(data, state));
  else mountPage(root, composeAdminEvents(data, state));
}

/** A tick changed: the count and the merge control follow, nothing else repaints. @param {Element} root @param {AdminEventsState} state @param {HTMLInputElement} box */
function onTick(root, state, box) {
  if (box.checked) state.ticked.add(Number(box.value)); else state.ticked.delete(Number(box.value));
  const count = root.querySelector('[data-admin-events-ticked]');
  if (count) count.textContent = t('adminEvents.ticked', { n: state.ticked.size });
  const slot = root.querySelector('[data-admin-events-merge-slot]');
  if (slot) mount(slot, mergeControl(state.ticked));
}

/** Search, ticks and paging, delegated on `root` once. @param {Element} root @param {AdminEventsState} state @returns {void} */
export function bind(root, state) {
  /** @param {string} text */
  const say = (text) => { const el = root.querySelector('[data-admin-events-status]'); if (el) el.textContent = text; };
  /** A new search or page: ticks reset, then refetch. @param {{ q?: string, offset: number }} next */
  const go = (next) => {
    Object.assign(state, next);
    state.ticked.clear();
    say('');
    void load(root, state).catch(() => say(t('adminEvents.failed')));
  };
  const search = (/** @type {string} */ value) => { if (value.trim() !== state.q) go({ q: value.trim(), offset: 0 }); };
  const searchSoon = debounced(search, DEBOUNCE_MS);
  on(root, '#c-admin-events-q', 'input', (_event, input) => searchSoon(/** @type {HTMLInputElement} */ (input).value));
  on(root, '[data-admin-events-search]', 'submit', (event, form) => {
    event.preventDefault();
    search(/** @type {HTMLInputElement|null} */ (form.querySelector('#c-admin-events-q'))?.value ?? '');
  });
  on(root, '[data-action="page"]', 'click', (_event, button) => go({ offset: Number(button.getAttribute('data-offset')) || 0 }));
  on(root, '[data-action="tick"]', 'change', (_event, input) => onTick(root, state, /** @type {HTMLInputElement} */ (input)));
}

/** @returns {Promise<void>} */
export async function start() {
  const root = document.getElementById(APP_SELECTOR);
  if (!root) return;
  document.title = `${t('adminEvents.title')} · ${site.name}`;
  let me;
  try { me = await getMe(); } catch { mountLoadError(root, { active: 'me' }); return; }
  const state = newState(me);
  if (!me.user?.isOwner) { mountPage(root, composeAdminEvents(null, state)); return; }
  try {
    await load(root, state);
  } catch (err) {
    if (err instanceof ApiError && REFUSED.has(err.status)) mountPage(root, composeAdminEvents(null, state));
    else mountLoadError(root, { active: 'me' });
    return;
  }
  bind(root, state);
}

if (typeof document !== 'undefined') start();
