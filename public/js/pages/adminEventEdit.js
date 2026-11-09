// @ts-check
/**
 * The owner's edit event page (event editing, spec screen ②,
 * `/admin/events/edit`): one page in three modes, read from the query by
 * `modeOf` (`state/eventFormState.js`).
 *
 * - edit (`?id=3`): the event's fields; save stays here with a notice.
 * - merge (`?merge=3,7`): a strip of the events with the kept one chosen
 *   (changing it re-seeds the title, date, live and address from it and
 *   keeps the combined tags), what the merge moves, and "merge and
 *   save", which opens the kept event's edit page. An event that 404s
 *   (merged or gone) is named and the merge can't be sent. A hidden
 *   event carries the hidden badge, and the move notice says when the
 *   merge hides the moved tweets or shows a hidden event's.
 * - create (`?from=5&items=11,12`): "new event for N tweets" (the
 *   source event's hidden badge when it is hidden), and
 *   "create and move N tweets", which opens the new event's edit page;
 *   cancel goes back to the entries with nothing written.
 *
 * The fields themselves are `components/eventForm.js`. The page rules
 * (CONTRIBUTING.md, Page): `composeAdminEventEdit` is pure; a signed-out
 * visitor is offered sign-in; a non-owner, a 401/403/404, an unreadable
 * query or a merge of fewer than two ids get the not-found state (a merge
 * whose listed events all 404 names each one instead);
 * anything else `mountLoadError`.
 */
import { html } from '../core/html.js';
import { mount, mountPage, on } from '../core/dom.js';
import { getJson, postJson, ApiError } from '../core/api.js';
import { getMe } from '../core/session.js';
import { site, t, tCount } from '../core/site.js';
import { ADMIN_EVENTS_PATH, adminEventEditHref, adminEventEntriesHref } from '../core/routes.js';
import { bodyOf, defaultKeepId, initialFields, modeOf, moveSummary, reseeded } from '../state/eventFormState.js';
import * as eventForm from '../components/eventForm.js';
import * as pageShell from '../components/pageShell.js';
import * as emptyState from '../components/emptyState.js';
import * as signIn from '../components/signIn.js';
import { mountLoadError } from './pageError.js';

const API_PATH = '/api/owner/events';
/** The statuses the API answers a viewer who isn't the owner, or an unknown event, with. */
const REFUSED = new Set([401, 403, 404]);

/**
 * @typedef {import('../state/eventFormState.js').Mode} Mode
 * @typedef {import('../../../src/http/contracts.js').AdminEventDetail} AdminEventDetail
 * @typedef {import('../../../src/http/contracts.js').EventEntry} EventEntry
 * @typedef {{ events: AdminEventDetail[], missing: number[], entries?: EventEntry[] }} View
 * @typedef {{ user: null | { isOwner: boolean } }} Me
 * @typedef {{ me: Me, mode: Mode|null, events: AdminEventDetail[], missing: number[], keepId: number,
 *   store: import('../components/eventForm.js').FormStore|null, busy: boolean, go: (href: string) => void }} PageState
 * @typedef {import('../core/html.js').SafeHtml} SafeHtml
 */

/** @param {AdminEventDetail} event */
const addressOf = (event) => ({ locked: event.addressLocked, slug: event.slug });

/** @param {Mode} mode @param {AdminEventDetail[]} events */
function hintsOf(mode, events) {
  if (mode.mode === 'create') return { date: t('adminEventEdit.dateCreate') };
  if (mode.mode === 'merge') return { tags: t('adminEventEdit.tagsMerge', { n: events.length }) };
  return {};
}

/**
 * The page's state: `view` is what `fetchView` loaded, `null` when there
 * is nothing to edit (then `store` is `null` and the page is not found).
 * @param {Me} me @param {Mode|null} mode @param {View|null} view @returns {PageState}
 */
export function pageState(me, mode, view) {
  const events = view?.events ?? [];
  const go = (/** @type {string} */ href) => window.location.assign(href);
  const missing = view?.missing ?? [];
  if (!mode || events.length === 0) return { me, mode, events, missing, keepId: 0, store: null, busy: false, go };
  const keepId = mode.mode === 'merge' ? defaultKeepId(events) : events[0].id;
  const kept = /** @type {AdminEventDetail} */ (events.find((e) => e.id === keepId));
  const store = {
    fields: initialFields(mode, events, view?.entries), options: events[0].options,
    address: mode.mode === 'create' ? { locked: false, slug: '' } : addressOf(kept), hints: hintsOf(mode, events),
  };
  return { me, mode, events, missing, keepId, store, busy: false, go };
}

/**
 * What the merge moves, one line each: the count; then, when the kept
 * event is hidden, that the moved tweets will be hidden with it; or, when
 * it is visible and a merged-away one is hidden, that those tweets go
 * public.
 * @param {PageState} state @returns {SafeHtml}
 */
function moveNotice(state) {
  const { tweets, events } = moveSummary(state.events, state.keepId);
  const lines = [`${tCount('adminEventEdit.moveTweets', tweets, { events: tCount('adminEventEdit.events', events) })}. ${tCount('adminEventEdit.mergeHidden', events)}`];
  const keptHidden = state.events.some((e) => e.id === state.keepId && e.hidden);
  const hiddenMerged = state.events.filter((e) => e.id !== state.keepId && e.hidden).length;
  if (keptHidden) lines.push(t('adminEventEdit.hiddenKept'));
  else if (hiddenMerged > 0) lines.push(tCount('adminEventEdit.hiddenShown', hiddenMerged));
  return html`${lines.map((line) => html`<p class="notice notice--accent">${line}</p>`)}`;
}

/** @param {{ hidden: boolean }} event @returns {SafeHtml} */
const hiddenBadge = (event) => (event.hidden ? html` <span class="badge badge--danger">${t('adminEventEdit.hidden')}</span>` : html``);

/** @param {PageState} state @returns {SafeHtml} */
function mergeStrip(state) {
  const total = state.events.reduce((sum, e) => sum + e.entryCount, 0);
  const choice = (/** @type {AdminEventDetail} */ e) => html`<label class="check"><input type="radio" name="keep" data-event-keep value="${e.id}"${e.id === state.keepId ? ' checked' : ''}>
    ${t('adminEventEdit.keepOption', { id: e.id, date: e.occurredOn, tweets: tCount('adminEventEdit.tweets', e.entryCount) })}${hiddenBadge(e)}</label>`;
  return html`
    <div class="card stack stack--2">
      <h2 class="heading heading--sm">${t('adminEventEdit.mergeHeading', { n: state.events.length + state.missing.length, tweets: tCount('adminEventEdit.tweets', total) })}</h2>
      ${state.events.length > 0 ? html`<div class="cluster cluster--3" role="radiogroup" aria-labelledby="c-event-edit-keep">
        <span class="meta" id="c-event-edit-keep">${t('adminEventEdit.keep')}</span>${state.events.map(choice)}
      </div>` : ''}
      ${state.missing.map((id) => html`<p class="notice notice--error" role="alert">${t('adminEventEdit.mergeMissing', { id })}</p>`)}
    </div>`;
}

/** @param {PageState} state @param {Extract<Mode, { mode: 'create' }>} mode @returns {SafeHtml} */
const createStrip = (state, mode) => html`
  <div class="card stack stack--1">
    <h2 class="heading heading--sm">${t('adminEventEdit.createHeading', { tweets: tCount('adminEventEdit.tweets', mode.itemIds.length) })}</h2>
    <p class="meta">${t('adminEventEdit.createFrom', { name: state.events[0].name })}${hiddenBadge(state.events[0])}</p>
  </div>`;

/** The mode's strip, submit label and cancel link. @param {PageState} state @param {Mode} mode */
function modeParts(state, mode) {
  if (mode.mode === 'merge') return { strip: mergeStrip(state), submit: t('adminEventEdit.mergeSave'), cancel: ADMIN_EVENTS_PATH };
  if (mode.mode === 'create') {
    return { strip: createStrip(state, mode), submit: tCount('adminEventEdit.createSave', mode.itemIds.length), cancel: adminEventEntriesHref(mode.fromId) };
  }
  return { strip: html``, submit: t('adminEventEdit.save'), cancel: ADMIN_EVENTS_PATH };
}

/** @param {PageState} state @param {Mode} mode @param {import('../components/eventForm.js').FormStore} store @returns {SafeHtml} */
function editContent(state, mode, store) {
  const { strip, submit, cancel } = modeParts(state, mode);
  return html`
    <section class="c-event-edit stack stack--4">
      <h1 class="heading heading--lg">${t(`adminEventEdit.title.${mode.mode}`)}</h1>
      ${strip}
      <form class="stack stack--4" data-event-edit-form>
        <div data-event-form-slot>${eventForm.render(store)}</div>
        ${mode.mode === 'merge' ? html`<div class="stack stack--2" data-event-move-notice>${moveNotice(state)}</div>` : ''}
        <div class="cluster cluster--2">
          <button class="btn btn--primary" type="submit"${state.missing.length > 0 ? ' disabled' : ''}>${submit}</button>
          <a class="btn btn--quiet" href="${cancel}">${t('adminEventEdit.cancel')}</a>
        </div>
      </form>
      <div role="status" data-event-edit-status></div>
    </section>`;
}

/**
 * A merge where none of the listed events loaded: the strip names each
 * one, there is no form to send, and cancel goes back to the list.
 * @param {PageState} state @returns {SafeHtml}
 */
const nothingToMerge = (state) => html`
  <section class="c-event-edit stack stack--4">
    <h1 class="heading heading--lg">${t('adminEventEdit.title.merge')}</h1>
    ${mergeStrip(state)}
    <div class="cluster cluster--2"><a class="btn btn--secondary" href="${ADMIN_EVENTS_PATH}">${t('adminEventEdit.cancel')}</a></div>
  </section>`;

/** The whole page. @param {PageState} state @returns {import('../core/html.js').ShellHtml} */
export function composeAdminEventEdit(state) {
  if (!state.me.user) {
    const content = html`<h1 class="heading heading--lg">${t('adminEventEdit.title.edit')}</h1>${signIn.render({ returnTo: ADMIN_EVENTS_PATH })}`;
    return pageShell.render({ active: 'me', compact: true, content });
  }
  if (state.me.user.isOwner && state.mode?.mode === 'merge' && !state.store && state.missing.length > 0) {
    return pageShell.render({ active: 'me', content: nothingToMerge(state) });
  }
  if (!state.me.user.isOwner || !state.mode || !state.store) {
    return pageShell.render({ active: 'me', compact: true, content: emptyState.render({ message: t('adminEventEdit.notFound') }) });
  }
  return pageShell.render({ active: 'me', content: editContent(state, state.mode, state.store) });
}

/** @param {number} id @returns {Promise<AdminEventDetail|null>} null for a 404 (merged or gone) */
async function eventOrNull(id) {
  try { return await getJson(`${API_PATH}/${id}`); } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

/** What a mode needs: its events (and, to create, the source event's entries). @param {Mode} mode @returns {Promise<View>} */
export async function fetchView(mode) {
  if (mode.mode === 'edit') return { events: [await getJson(`${API_PATH}/${mode.id}`)], missing: [] };
  if (mode.mode === 'merge') {
    const found = await Promise.all(mode.ids.map(eventOrNull));
    return { events: /** @type {AdminEventDetail[]} */ (found.filter(Boolean)), missing: mode.ids.filter((_id, i) => !found[i]) };
  }
  const [event, list] = await Promise.all([getJson(`${API_PATH}/${mode.fromId}`), getJson(`${API_PATH}/${mode.fromId}/entries`)]);
  return { events: [event], missing: [], entries: list.entries };
}

/** @param {PageState} state @param {Mode} mode @returns {[string, unknown]} the mode's POST path and body */
function request(state, mode) {
  const fields = bodyOf(/** @type {any} */ (state.store).fields);
  if (mode.mode === 'edit') return [`${API_PATH}/${mode.id}`, fields];
  if (mode.mode === 'merge') {
    return [`${API_PATH}/merge`, { keepId: state.keepId, mergeIds: state.events.map((e) => e.id).filter((id) => id !== state.keepId), fields }];
  }
  return [`${API_PATH}/${mode.fromId}/split`, { itemIds: mode.itemIds, fields }];
}

/** @param {Element} root @param {'saved'|'merged'|'invalid'|'failed'} kind @param {string} text */
function say(root, kind, text) {
  const slot = root.querySelector('[data-event-edit-status]');
  const look = kind === 'saved' ? 'notice--info' : 'notice--error';
  if (slot) mount(slot, html`<p class="notice ${look}" data-notice="${kind}">${text}</p>`);
}

/** @param {Element} root @param {unknown} err */
function sayFailure(root, err) {
  if (err instanceof ApiError && err.status === 409) say(root, 'merged', t('adminEventEdit.merged'));
  else if (err instanceof ApiError && err.status === 400 && err.body?.message) say(root, 'invalid', t('adminEventEdit.invalid', { reason: err.body.message }));
  else say(root, 'failed', t('adminEventEdit.failed'));
}

/**
 * Sends the mode's POST. Edit stays with a saved notice; merge and create
 * open the kept or new event's edit page. A failure is shown, not thrown.
 * @param {Element} root @param {PageState} state @returns {Promise<void>}
 */
export async function save(root, state) {
  const mode = state.mode;
  if (!mode || !state.store || state.busy) return;
  state.busy = true;
  const button = root.querySelector('[data-event-edit-form] [type="submit"]');
  button?.setAttribute('aria-busy', 'true');
  try {
    const result = await postJson(...request(state, mode));
    if (mode.mode === 'edit') {
      state.store.address = { ...state.store.address, slug: result.slug };
      say(root, 'saved', t('adminEventEdit.saved'));
    } else state.go(adminEventEditHref(mode.mode === 'merge' ? state.keepId : result.eventId));
  } catch (err) {
    sayFailure(root, err);
  } finally {
    state.busy = false;
    button?.removeAttribute('aria-busy');
  }
}

/** A merge's kept event changed. @param {Element} root @param {PageState} state @param {number} keepId */
function keep(root, state, keepId) {
  const kept = state.events.find((e) => e.id === keepId);
  if (!kept || !state.store) return;
  state.keepId = keepId;
  state.store.fields = reseeded(state.store.fields, kept);
  state.store.address = addressOf(kept);
  const form = root.querySelector('[data-event-form-slot]');
  if (form) mount(form, eventForm.render(state.store));
  const notice = root.querySelector('[data-event-move-notice]');
  if (notice) mount(notice, moveNotice(state));
}

/** The form, the kept-event radios and the submit, delegated on `root` once. @param {Element} root @param {PageState} state */
export function bind(root, state) {
  if (!state.store) return;
  eventForm.bind(root, state.store);
  on(root, '[data-event-keep]', 'change', (_e, radio) => keep(root, state, Number(radio.getAttribute('value'))));
  on(root, '[data-event-edit-form]', 'submit', (e) => { e.preventDefault(); void save(root, state); });
}

/** @returns {Promise<void>} */
export async function start() {
  const root = document.getElementById('app');
  if (!root) return;
  const mode = modeOf(window.location.search);
  document.title = `${t(`adminEventEdit.title.${mode?.mode ?? 'edit'}`)} · ${site.name}`;
  let me;
  try { me = await getMe(); } catch { mountLoadError(root, { active: 'me' }); return; }
  const view = me.user?.isOwner && mode ? await loadView(root, mode) : null;
  if (view === undefined) return;
  const state = pageState(me, mode, view);
  mountPage(root, composeAdminEventEdit(state));
  bind(root, state);
}

/**
 * `fetchView`, or `null` when the API refused (the not-found state);
 * `undefined` once any other failure has shown the load error.
 * @param {Element} root @param {Mode} mode @returns {Promise<View|null|undefined>}
 */
async function loadView(root, mode) {
  try { return await fetchView(mode); } catch (err) {
    if (err instanceof ApiError && REFUSED.has(err.status)) return null;
    mountLoadError(root, { active: 'me' });
    return undefined;
  }
}

if (typeof document !== 'undefined') start();
