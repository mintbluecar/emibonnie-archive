// @ts-check
/**
 * The import review page (Plan 3): owner only. Reads one job and its rows,
 * renders the table, the marker cards and the publish bar, and reloads
 * after every action.
 */
import { html } from '../core/html.js';
import { mountPage } from '../core/dom.js';
import { getJson, postJson } from '../core/api.js';
import { getMe } from '../core/session.js';
import { site, t } from '../core/site.js';
import { mountLoadError } from './pageError.js';
import * as pageShell from '../components/pageShell.js';
import * as signIn from '../components/signIn.js';
import * as importRows from '../components/importRows.js';
import * as importSpeakers from '../components/importSpeakers.js';

const APP_SELECTOR = 'app';

/**
 * Everything the page keeps between paints.
 * @typedef {{ root: Element, jobId: number,
 *   state: import('../components/importRows.js').RowsState,
 *   markers: import('../components/importSpeakers.js').MarkerGroup[],
 *   people: import('../components/importSpeakers.js').Person[],
 *   roles: string[],
 *   speakers: import('../components/importSpeakers.js').SpeakersState }} ReviewUi
 */

/** @returns {number|null} */
function jobIdFromPath() {
  const match = /^\/admin\/imports\/(\d+)\/?$/.exec(window.location.pathname);
  return match ? Number(match[1]) : null;
}

/** @param {Element} root */
function mountSignIn(root) {
  mountPage(root, pageShell.render({
    active: 'me', compact: true,
    content: html`<h1 class="c-me__title">${t('import.title')}</h1>
      ${signIn.render({ returnTo: window.location.pathname })}`,
  }));
}

/** @param {Element} root */
function mountNotFound(root) {
  mountPage(root, pageShell.render({
    active: 'me', compact: true,
    content: html`<p class="c-import__empty">${t('import.notFound')}</p>`,
  }));
}

/** @param {Element} root @param {number} jobId @returns {ReviewUi} */
function reviewUi(root, jobId) {
  return {
    root,
    jobId,
    state: { jobId, job: { id: jobId, source: 'notion', status: 'queued', createdAt: '' }, counts: {}, rows: [], hasMore: false, state: '', q: '' },
    markers: [],
    people: [],
    roles: [],
    speakers: { jobId, expanded: new Set(), remember: true },
  };
}

/** The rows page for the current filter and search. @param {ReviewUi} ui @param {{ more?: boolean }} options */
async function fetchRows(ui, { more = false } = {}) {
  const query = new URLSearchParams();
  if (ui.state.state) query.set('state', ui.state.state);
  if (ui.state.q) query.set('q', ui.state.q);
  query.set('offset', more ? String(ui.state.rows.length) : '0');
  const page = await getJson(`/api/owner/imports/${ui.jobId}/rows?${query.toString()}`);
  ui.state.rows = more ? [...ui.state.rows, ...page.rows] : page.rows;
  ui.state.hasMore = page.hasMore;
}

/** @param {ReviewUi} ui */
function paint(ui) {
  mountPage(ui.root, pageShell.render({
    active: 'me', wide: true,
    content: html`${importRows.render(ui.state)}${importSpeakers.render({
      markers: ui.markers,
      people: ui.people,
      roles: ui.roles,
      expanded: ui.speakers.expanded,
      remember: ui.speakers.remember,
    })}`,
  }));
  const onReload = (/** @type {{ more?: boolean }} */ options = {}) => refresh(ui, options);
  importRows.bind(ui.root, { state: ui.state, reload: onReload });
  importSpeakers.bind(ui.root, {
    state: ui.speakers,
    map: (body) => postJson(`/api/owner/imports/${ui.jobId}/map`, body),
    reload: () => refresh(ui),
  });
}

/** Refresh counts, the header and the marker table too, then repaint. @param {ReviewUi} ui @param {{ more?: boolean }} [options] */
async function refresh(ui, { more = false } = {}) {
  if (!more) {
    const view = await getJson(`/api/owner/imports/${ui.jobId}`);
    ui.state.job = view.job;
    ui.state.counts = view.counts;
    ui.markers.length = 0;
    ui.markers.push(...(view.markers ?? []));
  }
  await fetchRows(ui, { more });
  paint(ui);
}

/** @param {Element} root @param {number} jobId */
async function startReview(root, jobId) {
  const ui = reviewUi(root, jobId);
  let view;
  try {
    view = await getJson(`/api/owner/imports/${jobId}`);
  } catch {
    mountNotFound(root);
    return;
  }
  ui.state.job = view.job;
  ui.state.counts = view.counts;
  ui.state.rows = view.rows;
  ui.state.hasMore = view.hasMore;
  ui.markers.push(...(view.markers ?? []));
  const options = await getJson('/api/add/options').catch(() => ({ people: [], roles: [] }));
  ui.people = options.people ?? [];
  ui.roles = options.roles ?? [];
  paint(ui);
}

/** @returns {Promise<void>} */
export async function start() {
  const root = document.getElementById(APP_SELECTOR);
  const jobId = jobIdFromPath();
  if (!root || jobId === null) return;
  document.title = site.name;
  let me;
  try { me = await getMe(); } catch { mountLoadError(root, { active: 'me' }); return; }
  if (!me.user?.isOwner) { mountSignIn(root); return; }
  await startReview(root, jobId);
}

if (typeof document !== 'undefined') start();
