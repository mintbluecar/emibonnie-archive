// @ts-check
/**
 * The tweets in an event (event editing, spec screen ③,
 * `/admin/events/entries?id=5`), opened from an events-list row's
 * "tweets": the event's name (with the hidden badge when it is hidden),
 * tweet count and date range; its entries
 * grouped by day, each with a tick box, people, snippet and review state;
 * and "move N ticked to:" -- a search over the other events (never this
 * one, never a hidden one: moving tweets there would hide them) and
 * "＋ new event", a link to the edit page's create mode
 * (`adminEventSplitHref`), which writes nothing until it saves. **Move**
 * moves in place (`POST /api/owner/events/:id/move`), then reloads the
 * entries and clears the ticks; a refusal is shown and the ticks stay.
 *
 * The page rules (CONTRIBUTING.md, Page): `composeAdminEventEntries` is
 * pure; a signed-out visitor is offered sign-in; a non-owner, a 401/403/404
 * or a missing or unreadable `?id` get the not-found state; anything else
 * `mountLoadError`. The entries reload and the target search each have
 * their own sequence check, and repaint only their own slots, so the
 * search box keeps its focus.
 */
import { html } from '../core/html.js';
import { mount, mountPage, on } from '../core/dom.js';
import { getJson, postJson, ApiError } from '../core/api.js';
import { getMe } from '../core/session.js';
import { debounced } from '../core/debounce.js';
import { dayLabel } from '../core/format.js';
import { site, t, tCount } from '../core/site.js';
import { ADMIN_EVENTS_PATH, adminEventEntriesHref, adminEventSplitHref } from '../core/routes.js';
import { idOf } from '../state/eventFormState.js';
import * as pageShell from '../components/pageShell.js';
import * as emptyState from '../components/emptyState.js';
import * as signIn from '../components/signIn.js';
import { mountLoadError } from './pageError.js';

const API_PATH = '/api/owner/events';
/** The same pause as the events list's search. */
const DEBOUNCE_MS = 250;
/** The statuses the API answers a viewer who isn't the owner, or an unknown event, with. */
const REFUSED = new Set([401, 403, 404]);
const BADGE = { pending: 'badge badge--accent', published: 'badge', rejected: 'badge badge--danger' };

/**
 * @typedef {import('../../../src/http/contracts.js').AdminEventEntries} AdminEventEntries
 * @typedef {import('../../../src/http/contracts.js').AdminEventRow} AdminEventRow
 * @typedef {AdminEventEntries['entries'][number]} Entry
 * @typedef {import('../core/html.js').SafeHtml} SafeHtml
 * @typedef {{ user: null | { isOwner: boolean } }} Me
 * @typedef {{ me: Me, id: number|null, ticked: Set<number>, q: string,
 *   targets: AdminEventRow[]|null, targetId: number|null, loadSeq: number, searchSeq: number, busy: boolean }} EntriesState
 */

/** The event id in the page's query (`?id=5`), or null. @param {string} search `location.search` @returns {number|null} */
export const entriesIdOf = (search) => idOf(new URLSearchParams(search).get('id'));

/** @param {Me} me @param {number|null} id @returns {EntriesState} */
export function newState(me, id) {
  return { me, id, ticked: new Set(), q: '', targets: null, targetId: null, loadSeq: 0, searchSeq: 0, busy: false };
}

/** The events a search found that tweets can move to. @param {AdminEventRow[]} events @param {number|null} currentId */
export const targetsOf = (events, currentId) => events.filter((e) => e.id !== currentId && !e.hidden);

/** The ticked ids, lowest first, so a link reads the same whatever order they were ticked in. @param {EntriesState} state @returns {number[]} */
const tickedIds = (state) => [...state.ticked].sort((a, b) => a - b);

/** @param {AdminEventEntries} data @returns {SafeHtml} */
function head(data) {
  const days = data.entries.map((e) => e.occurredOn);
  const range = days.length === 0 ? '' : days[0] === days[days.length - 1] ? dayLabel(days[0])
    : t('adminEventEntries.range', { from: dayLabel(days[0]), to: dayLabel(days[days.length - 1]) });
  const hidden = data.event.hidden ? html` <span class="badge badge--danger">${t('adminEventEntries.hidden')}</span>` : '';
  return html`<h1 class="heading heading--lg">${data.event.name}${hidden}</h1>
    <p class="meta">${tCount('adminEventEntries.tweets', data.entries.length)}${range ? ` · ${range}` : ''}</p>`;
}

const columns = () => ({
  tick: t('adminEventEntries.col.tick'), people: t('adminEventEntries.col.people'),
  tweet: t('adminEventEntries.col.tweet'), state: t('adminEventEntries.col.state'),
});

/** @param {Entry} entry @param {boolean} ticked @param {ReturnType<typeof columns>} col @returns {SafeHtml} */
const entryRow = (entry, ticked, col) => html`
  <tr data-entry="${entry.itemId}">
    <td data-label="${col.tick}"><label class="check check--bare">
      <input type="checkbox" data-action="tick" value="${entry.itemId}" aria-label="${t('adminEventEntries.tick', { id: entry.sourceId ?? entry.itemId })}" ${ticked ? 'checked' : ''}>
    </label></td>
    <td class="meta" data-label="${col.people}">${entry.people.length > 0 ? entry.people.join(', ') : '—'}</td>
    <td data-label="${col.tweet}">${entry.snippet || '—'}</td>
    <td data-label="${col.state}"><span class="${BADGE[entry.reviewState]}">${t(`adminEventEntries.state.${entry.reviewState}`)}</span></td>
  </tr>`;

/** One day's entries under its date. @param {string} day @param {Entry[]} entries @param {Set<number>} ticked @returns {SafeHtml} */
function dayGroup(day, entries, ticked) {
  const col = columns();
  return html`
    <section data-day="${day}">
      <h2 class="label label--section">${dayLabel(day)}</h2>
      <table class="table table--stack table--raised">
        <thead><tr><th scope="col">${col.tick}</th><th scope="col">${col.people}</th><th scope="col">${col.tweet}</th><th scope="col">${col.state}</th></tr></thead>
        <tbody>${entries.map((entry) => entryRow(entry, ticked.has(entry.itemId), col))}</tbody>
      </table>
    </section>`;
}

/** The entries grouped by day (they come ordered by date). @param {AdminEventEntries} data @param {Set<number>} ticked @returns {SafeHtml} */
export function composeList(data, ticked) {
  if (data.entries.length === 0) return html`<p class="meta">${t('adminEventEntries.empty')}</p>`;
  /** @type {Map<string, Entry[]>} */
  const days = new Map();
  for (const entry of data.entries) days.set(entry.occurredOn, [...(days.get(entry.occurredOn) ?? []), entry]);
  return html`${[...days].map(([day, entries]) => dayGroup(day, entries, ticked))}`;
}

/** @param {EntriesState} state @returns {string} */
const movingText = (state) => (state.ticked.size > 0 ? tCount('adminEventEntries.moveHeading', state.ticked.size) : t('adminEventEntries.moveNone'));

/** The search's matches as one choice each. @param {EntriesState} state @returns {SafeHtml} */
export function composeTargets(state) {
  if (!state.targets) return html`<p class="meta">${t('adminEventEntries.searchHint')}</p>`;
  if (state.targets.length === 0) return html`<p class="meta">${t('adminEventEntries.noTargets')}</p>`;
  const choice = (/** @type {AdminEventRow} */ e) => html`<label class="check"><input type="radio" name="target" data-action="target" value="${e.id}"${e.id === state.targetId ? ' checked' : ''}>
    ${t('adminEventEntries.target', { date: e.occurredOn, name: e.name, tweets: tCount('adminEventEntries.tweets', e.entryCount) })}</label>`;
  return html`<div class="stack stack--1" role="radiogroup" aria-label="${t('adminEventEntries.targets')}">${state.targets.map(choice)}</div>`;
}

/** Move (a target and a tick needed) and "＋ new event" (a tick needed). @param {EntriesState} state @returns {SafeHtml} */
function actions(state) {
  const canMove = state.ticked.size > 0 && state.targetId !== null && !state.busy;
  const newEvent = state.ticked.size > 0 && state.id !== null
    ? html`<a class="btn btn--secondary" data-event-entries-new href="${adminEventSplitHref(state.id, tickedIds(state))}">${t('adminEventEntries.newEvent')}</a>`
    : html`<button class="btn btn--secondary" type="button" data-event-entries-new disabled>${t('adminEventEntries.newEvent')}</button>`;
  return html`<button class="btn btn--primary" type="button" data-action="move"${canMove ? '' : ' disabled'}>${t('adminEventEntries.move')}</button>${newEvent}`;
}

/** @param {AdminEventEntries} data @param {EntriesState} state @returns {SafeHtml} */
const entriesContent = (data, state) => html`
  <section class="c-event-entries stack stack--4">
    <a class="meta tap-link" href="${ADMIN_EVENTS_PATH}">${t('adminEventEntries.back')}</a>
    <div class="stack stack--1" data-event-entries-head>${head(data)}</div>
    <div class="stack stack--4" data-event-entries-list>${composeList(data, state.ticked)}</div>
    <div class="card stack stack--3">
      <h2 class="heading heading--sm" data-event-entries-ticked>${movingText(state)}</h2>
      <form class="field" role="search" data-event-entries-search>
        <label class="field__label" for="c-event-entries-q">${t('adminEventEntries.search')}</label>
        <input id="c-event-entries-q" type="search" value="${state.q}" autocomplete="off">
      </form>
      <div data-event-entries-targets>${composeTargets(state)}</div>
      <div class="cluster cluster--2" data-event-entries-actions>${actions(state)}</div>
    </div>
    <div role="status" data-event-entries-status></div>
  </section>`;

/**
 * The whole page: the entries for the owner; sign-in for a signed-out
 * visitor; the not-found state for anyone else, or when there is no
 * event to show (`data` is `null`).
 * @param {AdminEventEntries|null} data @param {EntriesState} state
 * @returns {import('../core/html.js').ShellHtml}
 */
export function composeAdminEventEntries(data, state) {
  if (!state.me.user) {
    const returnTo = state.id === null ? ADMIN_EVENTS_PATH : adminEventEntriesHref(state.id);
    const content = html`<h1 class="heading heading--lg">${t('adminEventEntries.title')}</h1>${signIn.render({ returnTo })}`;
    return pageShell.render({ active: 'me', compact: true, content });
  }
  if (!state.me.user.isOwner || !data || state.id === null) {
    return pageShell.render({ active: 'me', compact: true, content: emptyState.render({ message: t('adminEventEntries.notFound') }) });
  }
  return pageShell.render({ active: 'me', content: entriesContent(data, state) });
}

/** @param {Element} root @param {string} selector @param {SafeHtml} markup */
function paint(root, selector, markup) {
  const slot = root.querySelector(selector);
  if (slot) mount(slot, markup);
}

/** The count heading and the buttons follow the ticks and the target. @param {Element} root @param {EntriesState} state */
function repaintControls(root, state) {
  const heading = root.querySelector('[data-event-entries-ticked]');
  if (heading) heading.textContent = movingText(state);
  paint(root, '[data-event-entries-actions]', actions(state));
}

/**
 * Fetches the entries and paints them, unless a later `loadEntries`
 * started meanwhile. The first call paints the whole page; later ones the
 * header, the list and the controls. A failure is the caller's.
 * @param {Element} root @param {EntriesState} state @returns {Promise<void>}
 */
export async function loadEntries(root, state) {
  const mine = ++state.loadSeq;
  /** @type {AdminEventEntries} */
  const data = await getJson(`${API_PATH}/${state.id}/entries`);
  if (mine !== state.loadSeq) return;
  if (!root.querySelector('[data-event-entries-list]')) { mountPage(root, composeAdminEventEntries(data, state)); return; }
  paint(root, '[data-event-entries-head]', head(data));
  paint(root, '[data-event-entries-list]', composeList(data, state.ticked));
  repaintControls(root, state);
}

/**
 * Searches events for `state.q` and offers the matches, unless a later
 * search started meanwhile. A new search drops the picked target.
 * @param {Element} root @param {EntriesState} state @returns {Promise<void>}
 */
export async function searchTargets(root, state) {
  const mine = ++state.searchSeq;
  const found = state.q ? targetsOf((await getJson(API_PATH, { q: state.q })).events, state.id) : null;
  if (mine !== state.searchSeq) return;
  state.targets = found;
  state.targetId = null;
  paint(root, '[data-event-entries-targets]', composeTargets(state));
  repaintControls(root, state);
}

/** @param {Element} root @param {'moved'|'merged'|'invalid'|'failed'} kind @param {string} text */
function say(root, kind, text) {
  paint(root, '[data-event-entries-status]', html`<p class="notice ${kind === 'moved' ? 'notice--info' : 'notice--error'}" data-notice="${kind}">${text}</p>`);
}

/** @param {Element} root @param {unknown} err */
function sayFailure(root, err) {
  if (err instanceof ApiError && err.status === 409) say(root, 'merged', t('adminEventEntries.merged'));
  else if (err instanceof ApiError && err.status === 400 && err.body?.message) say(root, 'invalid', t('adminEventEntries.invalid', { reason: err.body.message }));
  else say(root, 'failed', t('adminEventEntries.failed'));
}

/**
 * Moves the ticked entries to the picked event, then clears the ticks and
 * reloads; a refusal is shown and the ticks stay. Never throws.
 * @param {Element} root @param {EntriesState} state @returns {Promise<void>}
 */
export async function move(root, state) {
  const target = state.targets?.find((e) => e.id === state.targetId);
  if (!target || state.ticked.size === 0 || state.busy) return;
  state.busy = true;
  repaintControls(root, state);
  try {
    const { moved } = await postJson(`${API_PATH}/${state.id}/move`, { itemIds: tickedIds(state), toEventId: target.id });
    state.ticked.clear();
    say(root, 'moved', tCount('adminEventEntries.moved', moved, { name: target.name }));
    await loadEntries(root, state).catch(() => say(root, 'failed', tCount('adminEventEntries.reloadFailed', moved)));
  } catch (err) {
    sayFailure(root, err);
  } finally {
    state.busy = false;
    repaintControls(root, state);
  }
}

/** A tick changed. @param {Element} root @param {EntriesState} state @param {HTMLInputElement} box */
function onTick(root, state, box) {
  const id = Number(box.getAttribute('value'));
  if (box.checked) state.ticked.add(id); else state.ticked.delete(id);
  repaintControls(root, state);
}

/** Ticks, the target search and pick, and move, delegated on `root` once. @param {Element} root @param {EntriesState} state */
export function bind(root, state) {
  const search = (/** @type {string} */ value) => {
    if (value.trim() === state.q) return;
    state.q = value.trim();
    void searchTargets(root, state).catch(() => say(root, 'failed', t('adminEventEntries.searchFailed')));
  };
  const searchSoon = debounced(search, DEBOUNCE_MS);
  on(root, '#c-event-entries-q', 'input', (_e, input) => searchSoon(/** @type {HTMLInputElement} */ (input).value));
  on(root, '[data-event-entries-search]', 'submit', (e, form) => {
    e.preventDefault();
    search(/** @type {HTMLInputElement|null} */ (form.querySelector('#c-event-entries-q'))?.value ?? '');
  });
  on(root, '[data-action="tick"]', 'change', (_e, box) => onTick(root, state, /** @type {HTMLInputElement} */ (box)));
  on(root, '[data-action="target"]', 'change', (_e, radio) => { state.targetId = Number(radio.getAttribute('value')); repaintControls(root, state); });
  on(root, '[data-action="move"]', 'click', () => { void move(root, state); });
}

/** @returns {Promise<void>} */
export async function start() {
  const root = document.getElementById('app');
  if (!root) return;
  document.title = `${t('adminEventEntries.title')} · ${site.name}`;
  let me;
  try { me = await getMe(); } catch { mountLoadError(root, { active: 'me' }); return; }
  const state = newState(me, entriesIdOf(window.location.search));
  if (!me.user?.isOwner || state.id === null) { mountPage(root, composeAdminEventEntries(null, state)); return; }
  try {
    await loadEntries(root, state);
  } catch (err) {
    if (err instanceof ApiError && REFUSED.has(err.status)) mountPage(root, composeAdminEventEntries(null, state));
    else mountLoadError(root, { active: 'me' });
    return;
  }
  bind(root, state);
}

if (typeof document !== 'undefined') start();
