// @ts-check
/**
 * The add page (Plan 2a Task 13): the three steps from the design --
 * paste a link, check the details, who's speaking -- as one small state
 * machine, with every ingest outcome on a screen that links onward.
 *
 * The page owns the state (the link, the preview, the choices, the line
 * fixes), the network calls and the debounced re-preview; `addView`
 * renders it and the components own their own DOM wiring. Nothing here
 * names a kind: the steps are generic, and `POST /api/add` decides what
 * is saved.
 */
import { mount, mountPage, on } from '../core/dom.js';
import { getJson, postJson, ApiError } from '../core/api.js';
import { getMe } from '../core/session.js';
import { site, t } from '../core/site.js';
import * as addLink from '../components/addLink.js';
import * as addDetails from '../components/addDetails.js';
import * as speakerStep from '../components/speakerStep.js';
import * as lineFixSheet from '../components/lineFixSheet.js';
import * as addView from '../components/addView.js';
import { bodyOf, choicesFromDraft, withField, withLineFix, REVEALS_INPUT } from '../state/addState.js';
import { ADD_PATH } from '../core/routes.js';
import { mountLoadError } from './pageError.js';

const APP_SELECTOR = 'app';
/** Every change waits this long before re-previewing, so typing never floods the API. */
const DEBOUNCE_MS = 300;

/** @typedef {import('../state/addState.js').Choices} Choices */
/** @typedef {import('../state/addState.js').LineFix} LineFix */
/** @typedef {import('../state/addState.js').Speaker} Speaker */
/**
 * @typedef {{ step: 'link'|'details'|'speakers', link: string, busy: boolean, error: boolean,
 *   notice: string|null, status: { result: any, itemHref: string|null }|null, preview: any|null,
 *   choices: Choices|null, chosen: Record<string, Speaker>, lineFixes: LineFix[],
 *   fix: any|null, open: string|null }} AddState
 * @typedef {{ root: Element, addingAs: string, isOwner: boolean, options: any,
 *   state: AddState, timer: any, seq: number, painted: boolean }} Ctx
 */

/** @type {Ctx|null} */
let ctx = null;

/** @returns {AddState} */
function newState() {
  return {
    step: 'link', link: '', busy: false, error: false, notice: null, status: null,
    preview: null, choices: null, chosen: {}, lineFixes: [], fix: null, open: null,
  };
}

/** @returns {Ctx} */
function current() {
  return /** @type {Ctx} */ (ctx);
}

/** @param {any} result @returns {string|null} */
function hrefOf(result) {
  return typeof result.url === 'string' ? result.url : null;
}

/** @returns {void} */
function paint() {
  const c = current();
  const markup = addView.render({ state: c.state, addingAs: c.addingAs, isOwner: c.isOwner, options: c.options });
  if (c.painted) mount(c.root, markup);
  else { mountPage(c.root, markup); c.painted = true; }
  bind(c.root);
}

/** @param {any} result @param {boolean} reset @returns {void} */
function applyPreview(result, reset) {
  const state = current().state;
  state.busy = false;
  state.preview = result;
  if (reset) state.choices = choicesFromDraft(result.draft);
}

/**
 * Re-runs the preview for whatever the form now says, so step 3's lines
 * follow every change. A stale response (an older request finishing last)
 * is dropped.
 * @returns {Promise<void>}
 */
async function refreshPreview() {
  const c = current();
  const state = c.state;
  if (!state.preview || !state.choices) return;
  const seq = ++c.seq;
  const body = bodyOf({ link: state.link, chosen: state.chosen, choices: state.choices, lineFixes: state.lineFixes });
  try {
    const result = await postJson('/api/add/preview', body);
    if (seq !== c.seq) return;
    if (result.status === 'ready') { state.preview = result; state.notice = null; }
    else state.notice = t('add.previewFailed');
  } catch {
    if (seq !== c.seq) return;
    state.notice = t('add.previewFailed');
  }
  paint();
}

/** @returns {void} */
function schedulePreview() {
  const c = current();
  clearTimeout(c.timer);
  c.timer = setTimeout(async () => { await refreshPreview(); }, DEBOUNCE_MS);
}

/** @param {string} url @returns {Promise<void>} */
async function submitLink(url) {
  const state = current().state;
  state.link = url;
  state.busy = true;
  state.error = false;
  paint();
  try {
    const result = await postJson('/api/add/preview', { url });
    if (result.status === 'ready') applyPreview(result, true);
    else state.status = { result, itemHref: hrefOf(result) };
  } catch {
    state.busy = false;
    state.error = true;
  }
  paint();
}

/**
 * A step-2 field changed. A select that reveals another input (a new event,
 * a new type/client) re-renders at once; everything else only re-previews.
 * @param {string} field @param {string|boolean} value
 * @returns {void}
 */
function changeField(field, value) {
  const state = current().state;
  state.choices = withField(/** @type {Choices} */ (state.choices), field, value);
  if (REVEALS_INPUT.includes(field)) paint();
  schedulePreview();
}

/** @param {string} marker @param {Speaker} speaker @returns {void} */
function pickMarker(marker, speaker) {
  const state = current().state;
  state.chosen[marker] = speaker;
  state.open = null;
  paint();
  schedulePreview();
}

/** @param {{ part: number, line: number }} at @returns {void} */
function openFix(at) {
  const state = current().state;
  const line = state.preview.lines.find((/** @type {any} */ l) => l.part === at.part && l.line === at.line);
  if (!line) return;
  state.fix = line;
  paint();
}

/** @param {LineFix} fix @returns {void} */
function applyFix(fix) {
  const state = current().state;
  state.lineFixes = withLineFix(state.lineFixes, fix);
  state.fix = null;
  paint();
  schedulePreview();
}

/** @returns {void} */
function closeFix() {
  const state = current().state;
  state.fix = null;
  paint();
}

/** @param {{ displayName: string, igHandle: string }} input @returns {Promise<{ id: number }>} */
async function addPerson(input) {
  const c = current();
  const person = await postJson('/api/people', input);
  c.options = await getJson('/api/add/options');
  return person;
}

/** @param {boolean} saving @returns {void} */
function markSaving(saving) {
  const button = /** @type {HTMLButtonElement|null} */ (current().root.querySelector('[data-action="save"]'));
  if (!button) return;
  button.disabled = saving;
  button.textContent = saving ? t('add.saving') : t('add.save');
}

/** @returns {Promise<void>} */
async function save() {
  const state = current().state;
  if (!state.choices) return;
  markSaving(true);
  const body = bodyOf({ link: state.link, chosen: state.chosen, choices: state.choices, lineFixes: state.lineFixes });
  try {
    const result = await postJson('/api/add', body);
    if (typeof result.url === 'string') { window.location.assign(result.url); return; }
    state.status = { result, itemHref: hrefOf(result) };
  } catch {
    state.notice = t('add.saveFailed');
    markSaving(false);
  }
  paint();
}

/** @param {Element} root @returns {void} */
function bind(root) {
  const el = root.querySelector('main') ?? root;
  const c = current();
  if (c.state.status) return;
  if (!c.state.preview) {
    addLink.bind(el, { onSubmit: submitLink });
    return;
  }
  const next = () => { c.state.step = 'speakers'; paint(); };
  addDetails.bind(el, { onChange: changeField, onNext: next, onSave: save });
  if (c.state.step !== 'speakers') return;
  speakerStep.bind(el, { onPick: pickMarker, onLine: openFix, onNewPerson: addPerson });
  if (c.state.fix) {
    lineFixSheet.bind(el, { line: c.state.fix, onFix: applyFix, onCancel: closeFix, onNewPerson: addPerson });
  }
}

/** @param {Element} root @returns {void} */
function bindName(root) {
  const el = root.querySelector('main') ?? root;
  on(el, '.c-name-form', 'submit', async (event, form) => {
    event.preventDefault();
    const input = /** @type {HTMLInputElement|null} */ (form.querySelector('.c-name-form__input'));
    const value = input?.value ?? '';
    try {
      await postJson('/api/me/name', { name: value });
      window.location.reload();
    } catch (err) {
      const reason = err instanceof ApiError && err.body?.message ? String(err.body.message) : 'unknown';
      mountPage(root, addView.nameScreen({ value, reason }));
      bindName(root);
    }
  });
}

/** @returns {Promise<void>} */
export async function start() {
  const root = document.getElementById(APP_SELECTOR);
  if (!root) return;
  document.title = site.name;
  let me;
  try {
    me = await getMe();
  } catch {
    mountLoadError(root, { active: 'add' });
    return;
  }
  document.title = `${t('add.title')} · ${site.name}`;
  if (!me.user) { mountPage(root, addView.signedOut(ADD_PATH)); return; }
  if (me.user.needsName) { mountPage(root, addView.nameScreen()); bindName(root); return; }
  let options;
  try {
    options = await getJson('/api/add/options');
  } catch {
    mountLoadError(root, { active: 'add' });
    return;
  }
  const user = me.user;
  ctx = {
    root, options, painted: false, timer: null, seq: 0, state: newState(),
    addingAs: user.handle ? `@${user.handle}` : user.displayName ?? '',
    isOwner: user.isOwner === true,
  };
  paint();
}

if (typeof document !== 'undefined') start();
