// @ts-check
/**
 * The import review page (Plan 3): owner only. Reads one job and its rows,
 * renders the table, and reloads after every action. Speaker mapping and
 * publish live in the next component (Task 10).
 */
import { html } from '../core/html.js';
import { mountPage } from '../core/dom.js';
import { getJson } from '../core/api.js';
import { getMe } from '../core/session.js';
import { site, t } from '../core/site.js';
import { mountLoadError } from './pageError.js';
import * as pageShell from '../components/pageShell.js';
import * as signIn from '../components/signIn.js';
import * as importRows from '../components/importRows.js';

const APP_SELECTOR = 'app';

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

/** @returns {Promise<void>} */
export async function start() {
  const root = document.getElementById(APP_SELECTOR);
  const jobId = jobIdFromPath();
  if (!root || jobId === null) return;
  document.title = site.name;
  let me;
  try { me = await getMe(); } catch { mountLoadError(root, { active: 'me' }); return; }
  if (!me.user?.isOwner) { mountSignIn(root); return; }

  /** @type {import('../components/importRows.js').RowsState} */
  const state = { jobId, job: { id: jobId, source: 'notion', status: 'queued', createdAt: '' }, counts: {}, rows: [], hasMore: false, state: '', q: '' };

  const paint = () => { mountPage(root, importRows.render(state)); bind(); };
  /** @param {{ more?: boolean }} [options] */
  const reload = async ({ more = false } = {}) => {
    const query = new URLSearchParams();
    if (state.state) query.set('state', state.state);
    if (state.q) query.set('q', state.q);
    query.set('offset', more ? String(state.rows.length) : '0');
    const page = await getJson(`/api/owner/imports/${jobId}/rows?${query.toString()}`);
    state.rows = more ? [...state.rows, ...page.rows] : page.rows;
    state.hasMore = page.hasMore;
    paint();
  };
  const bind = () => importRows.bind(root, { state, reload: onReload });

  /** Refresh counts and the job header too (after publish/skip). */
  const refreshAll = async () => {
    const view = await getJson(`/api/owner/imports/${jobId}`);
    state.job = view.job;
    state.counts = view.counts;
    await reload();
  };

  /** @param {{ more?: boolean }} [options] */
  const onReload = async (options = {}) => (options.more ? reload({ more: true }) : refreshAll());

  try {
    const view = await getJson(`/api/owner/imports/${jobId}`);
    state.job = view.job;
    state.counts = view.counts;
    state.rows = view.rows;
    state.hasMore = view.hasMore;
  } catch {
    mountNotFound(root);
    return;
  }
  paint();
}

if (typeof document !== 'undefined') start();
