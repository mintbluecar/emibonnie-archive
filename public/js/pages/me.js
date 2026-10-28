// @ts-check
/**
 * The me page (Plan 2a Task 12; Plan 2b adds the translator's section).
 * Signed out, it is the sign-in screen. Signed in, it is "added by me" --
 * every entry the visitor submitted, in any review state, with an edit
 * link -- plus the Google name form when one is still needed, sign out /
 * sign out everywhere, and delete my account behind a typed confirmation.
 *
 * A recognised translator also gets the ✓ badge, "my translations" (the
 * `meTranslations` component: welcome, multi-select remove, restore and
 * opt out), and can switch between the two lists. The owner section is
 * Task 13.
 */
import { html } from '../core/html.js';
import { mountPage, on } from '../core/dom.js';
import { getJson, postJson, ApiError } from '../core/api.js';
import { getMe } from '../core/session.js';
import { site, t } from '../core/site.js';
import * as pageShell from '../components/pageShell.js';
import * as previewCard from '../components/previewCard.js';
import * as signIn from '../components/signIn.js';
import * as nameForm from '../components/nameForm.js';
import * as meTranslations from '../components/meTranslations.js';
import * as meSections from '../components/meSections.js';
import { HOME_PATH, ME_PATH } from '../core/routes.js';
import { mountLoadError } from './pageError.js';

const APP_SELECTOR = 'app';
/** @typedef {import('../../../src/http/contracts.js').AddedPreview} AddedPreview */
/** @typedef {import('../../../src/http/contracts.js').TranslatorPreview} TranslatorPreview */
/** @typedef {import('../../../src/http/contracts.js').TranslatorTotals} TranslatorTotals */
/**
 * @typedef {{
 *   via: 'x'|'google', handle: string|null, displayName: string|null,
 *   isOwner: boolean, isTranslator: boolean, needsName: boolean,
 *   showTranslatorWelcome: boolean, isOptedOut: boolean,
 * }} MeUser
 * @typedef {{ items: TranslatorPreview[], hasMore: boolean, totals: TranslatorTotals }} Translations
 * @typedef {{ user: MeUser, added: AddedPreview[], hasMore: boolean, translations: Translations,
 *   tab: 'translations'|'added', selected: Set<string>, welcome: boolean, optedOut: boolean,
 *   name?: { value?: string, reason?: string } }} MeState
 */

/** @returns {import('../core/html.js').SafeHtml} */
function signOutIcon() {
  return html`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M10 4H6v16h4"></path><path d="M14 8l4 4-4 4"></path><path d="M8 12h10"></path>
  </svg>`;
}

/** @returns {import('../core/html.js').SafeHtml} */
function signOutAllIcon() {
  return html`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M10 4H6v16h4"></path><path d="M14 8l4 4-4 4"></path><path d="M8 12h10"></path><path d="M17 5l3-2M17 19l3 2"></path>
  </svg>`;
}

/** @returns {import('../core/html.js').SafeHtml} */
export function composeSignedOut({ failed = false } = {}) {
  return pageShell.render({
    active: 'me',
    compact: true,
    content: html`
      <h1 class="c-me__title">${t('me.title')}</h1>
      ${signIn.render({ returnTo: ME_PATH, failed })}
    `,
  });
}

/** @param {MeUser} user @returns {string} */
function whoOf(user) {
  if (user.handle) return `@${user.handle}`;
  return user.displayName ?? t('me.googleUser');
}

/** @returns {import('../core/html.js').SafeHtml} */
function deleteDialog() {
  return html`
    <dialog class="c-me__dialog" aria-labelledby="c-me-delete-title">
      <h2 class="c-me__dialog-title" id="c-me-delete-title">${t('me.deleteTitle')}</h2>
      <p class="c-me__dialog-body">${t('me.deleteBody')}</p>
      <label class="c-me__dialog-label" for="c-me-delete-input">${t('me.deleteConfirmLabel')}</label>
      <input class="c-me__delete-input" id="c-me-delete-input" type="text" autocomplete="off">
      <div class="c-me__dialog-actions">
        <button class="c-me__cancel" type="button" data-action="cancel-delete">${t('me.cancel')}</button>
        <button class="c-me__confirm" type="button" data-action="confirm-delete" disabled>${t('me.deleteConfirm')}</button>
      </div>
    </dialog>
  `;
}

/** The component's own state, carved out of the page's. @param {MeState} state @returns {import('../components/meTranslations.js').TranslationsState} */
function translatorStateOf(state) {
  return {
    handle: state.user.handle, items: state.translations.items, hasMore: state.translations.hasMore,
    totals: state.translations.totals, selected: state.selected, optedOut: state.optedOut,
    welcome: state.welcome, error: '',
  };
}

/** @param {MeState} state @returns {import('../core/html.js').SafeHtml} */
function panelsOf(state) {
  if (state.user.needsName) return html``;
  if (!state.user.isTranslator) return meSections.added(state);
  const panel = state.tab === 'translations' ? meSections.translations(translatorStateOf(state)) : meSections.added(state);
  return html`${meSections.tabs(state)}${panel}`;
}

/**
 * @param {MeState} state
 * @returns {import('../core/html.js').SafeHtml}
 */
export function composeSignedIn(state) {
  const { user, name } = state;
  const nameStep = (name || user.needsName) ? nameForm.render(name ?? {}) : '';
  const badge = user.isTranslator ? html` <span class="c-me__badge">${t('me.translatorBadge')}</span>` : '';
  return pageShell.render({
    active: 'me',
    compact: true,
    content: html`
      <h1 class="c-me__title">${t('me.title')}</h1>
      <div class="c-me__head">
        <p class="c-me__who">${whoOf(user)}${badge}</p>
        <div class="c-me__controls">
          <button class="c-me__icon" type="button" data-action="signout"
            title="${t('me.signOut')}" aria-label="${t('me.signOut')}">${signOutIcon()}</button>
          <button class="c-me__icon" type="button" data-action="signout-all"
            title="${t('me.signOutAll')}" aria-label="${t('me.signOutAll')}">${signOutAllIcon()}</button>
        </div>
      </div>
      ${panelsOf(state)}
      ${nameStep}
      <section class="c-me__danger">
        <button class="c-me__delete" type="button" data-action="open-delete">${t('me.deleteAccount')}</button>
      </section>
      ${deleteDialog()}
    `,
  });
}

/**
 * The translator tabs and, on that tab, the component's own actions.
 * @param {Element} root @param {MeState} state
 * @param {{ rerender: () => void, reload: () => Promise<void> }} handlers
 */
function bindTranslator(root, state, { rerender, reload }) {
  if (!state.user.isTranslator) return;
  on(root, '[data-action="tab"]', 'click', (_event, button) => {
    state.tab = button.getAttribute('data-tab') === 'added' ? 'added' : 'translations';
    rerender();
  });
  if (state.tab === 'translations') meTranslations.bind(root, { state: translatorStateOf(state), reload });
}

/**
 * Sign in/out, the delete dialog and the Google name form.
 * @param {Element} root @param {MeState} state @param {() => void} rerender
 */
function bindAccount(root, state, rerender) {
  on(root, '[data-action="signout"]', 'click', async () => {
    await postJson('/api/auth/signout');
    window.location.reload();
  });
  on(root, '[data-action="signout-all"]', 'click', async () => {
    await postJson('/api/auth/signout-all');
    window.location.reload();
  });
  on(root, '[data-action="open-delete"]', 'click', () => {
    /** @type {HTMLDialogElement|null} */ (root.querySelector('.c-me__dialog'))?.showModal();
  });
  on(root, '[data-action="cancel-delete"]', 'click', () => {
    /** @type {HTMLDialogElement|null} */ (root.querySelector('.c-me__dialog'))?.close();
  });
  on(root, '.c-me__delete-input', 'input', (_event, input) => {
    const confirm = /** @type {HTMLButtonElement|null} */ (root.querySelector('[data-action="confirm-delete"]'));
    if (confirm) confirm.disabled = input.value.trim() !== 'delete';
  });
  on(root, '[data-action="confirm-delete"]', 'click', async () => {
    await postJson('/api/me/delete', { confirm: 'delete' });
    window.location.assign(HOME_PATH);
  });
  on(root, '.c-name-form', 'submit', async (event, form) => {
    event.preventDefault();
    const input = /** @type {HTMLInputElement|null} */ (form.querySelector('.c-name-form__input'));
    const value = input?.value ?? '';
    try {
      await postJson('/api/me/name', { name: value });
      window.location.reload();
    } catch (err) {
      const reason = err instanceof ApiError && err.body?.message ? String(err.body.message) : 'unknown';
      state.name = { value, reason };
      rerender();
    }
  });
}

/**
 * @param {Element} root @param {MeState} state
 * @returns {void}
 */
export function bind(root, state) {
  previewCard.bind(root);
  /** Re-renders in place after a change the server already accepted. */
  const rerender = () => { mountPage(root, composeSignedIn(state)); bind(root, state); };
  const reload = async () => {
    state.welcome = false;
    await loadTranslations(state);
    rerender();
  };
  bindTranslator(root, state, { rerender, reload });
  bindAccount(root, state, rerender);
  on(root, '[data-action="more"]', 'click', async (_event, button) => {
    button.disabled = true;
    const page = await getJson('/api/me/added', { offset: state.added.length });
    state.added.push(...page.items);
    state.hasMore = page.hasMore;
    rerender();
  });
}

/** Loads (or reloads) the translator's own list into `state`. @param {MeState} state @returns {Promise<void>} */
async function loadTranslations(state) {
  const page = await getJson('/api/me/translations');
  state.translations = { items: page.items, hasMore: page.hasMore, totals: page.totals };
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
    mountLoadError(root, { active: 'me' });
    return;
  }
  document.title = `${t('me.title')} · ${site.name}`;
  if (!me.user) {
    const failed = new URLSearchParams(window.location.search).get('signin') === 'failed';
    mountPage(root, composeSignedOut({ failed }));
    return;
  }
  /** @type {MeState} */
  const state = {
    user: me.user, added: [], hasMore: false,
    translations: { items: [], hasMore: false, totals: { translations: 0, events: 0, sharedStories: 0 } },
    tab: me.user.isTranslator ? 'translations' : 'added', selected: new Set(),
    welcome: me.user.showTranslatorWelcome === true, optedOut: me.user.isOptedOut === true,
  };
  if (!me.user.needsName) {
    try {
      const page = await getJson('/api/me/added');
      state.added = page.items;
      state.hasMore = page.hasMore;
      if (me.user.isTranslator) await loadTranslations(state);
    } catch {
      mountLoadError(root, { active: 'me' });
      return;
    }
    // The welcome shows once: mark it as seen as soon as it is on screen.
    if (state.welcome) postJson('/api/me/welcomed').catch(() => {});
  }
  mountPage(root, composeSignedIn(state));
  bind(root, state);
}

if (typeof document !== 'undefined') start();
