// @ts-check
/**
 * The edit page (Plan 2a Task 13): the add flow's steps 2 and 3 for an
 * entry that is already archived -- the same components, filled from
 * `GET /api/item/:kind/:sourceId/edit` and saved with `POST …/edit`.
 *
 * It cannot create an event (the edit API takes an existing `eventId`
 * only), so a new-event title is not offered here, and it shows no media
 * preview (the edit response has none). The owner alone sees the edit
 * history, each entry with a revert icon button; saving reloads this page
 * in place rather than navigating away. `editView` renders it.
 */
import { html } from '../core/html.js';
import { mount, mountPage, on } from '../core/dom.js';
import { getJson, postJson, ApiError } from '../core/api.js';
import { getMe } from '../core/session.js';
import { site, t } from '../core/site.js';
import * as pageShell from '../components/pageShell.js';
import * as emptyState from '../components/emptyState.js';
import * as signIn from '../components/signIn.js';
import * as addDetails from '../components/addDetails.js';
import * as speakerStep from '../components/speakerStep.js';
import * as lineFixSheet from '../components/lineFixSheet.js';
import * as editView from '../components/editView.js';
import { choicesFromFields, withField, withLineFix, REVEALS_INPUT } from '../state/addState.js';
import { saveEntry, publishEntry, revertEntry, reloadEntry } from './editActions.js';
import { EDIT_PATH_PREFIX } from '../core/routes.js';
import { mountLoadError } from './pageError.js';

const APP_SELECTOR = 'app';

/** @typedef {import('../components/editView.js').EditData} EditData */
/** @typedef {import('../state/addState.js').LineFix} LineFix */
/** @typedef {import('../state/addState.js').Speaker} Speaker */
/** @typedef {import('../components/editView.js').EditState & { root: Element, api: string,
 *   reviewApi: string, data: EditData, painted: boolean }} Ctx */

/** @type {Ctx|null} */
let ctx = null;

/** @returns {Ctx} */
function current() {
  return /** @type {Ctx} */ (ctx);
}

/** @param {string} pathname @returns {{ kind: string, sourceId: string }|null} */
function targetFromPath(pathname) {
  if (!pathname.startsWith(EDIT_PATH_PREFIX)) return null;
  const rest = pathname.slice(EDIT_PATH_PREFIX.length).split('/').filter(Boolean);
  if (rest.length !== 2) return null;
  return { kind: decodeURIComponent(rest[0]), sourceId: decodeURIComponent(rest[1]) };
}

/** @param {{ kind: string, sourceId: string }} target @returns {string} */
function apiOf(target) {
  return `/api/item/${encodeURIComponent(target.kind)}/${encodeURIComponent(target.sourceId)}`;
}

/** @param {string} message @returns {import('../core/html.js').SafeHtml} */
function composeMessage(message) {
  return pageShell.render({ active: 'me', compact: true, content: emptyState.render({ message }) });
}

/** @returns {import('../core/html.js').SafeHtml} */
function composeSignedOut() {
  return pageShell.render({
    active: 'me', compact: true,
    content: html`
      <h1 class="c-me__title">${t('edit.title')}</h1>
      ${signIn.render({ returnTo: window.location.pathname })}
    `,
  });
}

/** @returns {void} */
function paint() {
  const c = current();
  const markup = editView.render(c);
  if (c.painted) mount(c.root, markup);
  else { mountPage(c.root, markup); c.painted = true; }
  bind(c.root);
}

/** @param {any} data @param {any} options @returns {void} */
function adopt(data, options) {
  const c = current();
  c.data = data;
  c.options = options;
  c.choices = choicesFromFields(data.fields);
  c.chosen = {};
  c.lineFixes = [...(data.fields.lineFixes ?? [])];
  c.fix = null;
  c.open = null;
  c.busy = false;
}

/** Re-fetches the edit screen after a save, revert or publish. @param {{ saved: boolean, published?: boolean }} opts */
function reload(opts) {
  return reloadEntry(current(), { adopt, paint }, opts);
}

/** @param {string} marker @param {Speaker} speaker @returns {void} */
function pickMarker(marker, speaker) {
  const c = current();
  c.chosen[marker] = speaker;
  c.open = null;
  paint();
}

/** @param {{ part: number, line: number }} at @returns {void} */
function openFix(at) {
  const c = current();
  const line = c.data.lines.find((/** @type {any} */ l) => l.part === at.part && l.line === at.line);
  if (!line) return;
  c.fix = line;
  paint();
}

/** @param {LineFix} fix @returns {void} */
function applyFix(fix) {
  const c = current();
  c.lineFixes = withLineFix(c.lineFixes, fix);
  c.fix = null;
  paint();
}

/** @returns {Promise<{ id: number }>} */
async function addPerson(/** @type {{ displayName: string, igHandle: string }} */ input) {
  const c = current();
  const person = await postJson('/api/people', input);
  c.options = await getJson('/api/add/options');
  return person;
}

/** @param {Element} root @returns {void} */
function bind(root) {
  const c = current();
  const el = root.querySelector('main') ?? root;
  addDetails.bind(el, {
    onChange: (field, value) => {
      c.choices = withField(c.choices, field, value);
      if (REVEALS_INPUT.includes(field)) paint();
    },
  });
  speakerStep.bind(el, { onPick: pickMarker, onLine: openFix, onNewPerson: addPerson });
  if (c.fix) {
    lineFixSheet.bind(el, {
      line: c.fix, onFix: applyFix,
      onCancel: () => { c.fix = null; paint(); }, onNewPerson: addPerson,
    });
  }
  const ui = { paint, reload };
  on(el, '[data-action="save"]', 'click', () => { void saveEntry(current(), ui); });
  on(el, '[data-action="save-publish"]', 'click', () => { void publishEntry(current(), ui); });
  on(el, '[data-action="revert"]', 'click', (_event, target) => {
    void revertEntry(current(), Number(target.getAttribute('data-edit')), ui);
  });
}

/** @returns {Promise<void>} */
export async function start() {
  const root = document.getElementById(APP_SELECTOR);
  if (!root) return;
  document.title = site.name;
  const target = targetFromPath(window.location.pathname);
  if (!target) { mountPage(root, composeMessage(t('edit.notFound'))); return; }
  let me;
  try {
    me = await getMe();
  } catch {
    mountLoadError(root, { active: 'me' });
    return;
  }
  if (!me.user) { mountPage(root, composeSignedOut()); return; }
  const api = apiOf(target);
  document.title = `${t('edit.title')} · ${site.name}`;
  let data;
  let options;
  try {
    [data, options] = await Promise.all([getJson(`${api}/edit`), getJson('/api/add/options')]);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) { mountPage(root, composeMessage(t('edit.notFound'))); return; }
    mountLoadError(root, { active: 'me' });
    return;
  }
  ctx = {
    root, api, options, data, choices: choicesFromFields(data.fields), chosen: {}, lineFixes: [],
    fix: null, open: null, busy: false, notice: null, saved: false, published: false, painted: false,
    reviewApi: `/api/owner/items/${encodeURIComponent(target.kind)}/${encodeURIComponent(target.sourceId)}/review`,
  };
  adopt(data, options);
  paint();
}

if (typeof document !== 'undefined') start();
