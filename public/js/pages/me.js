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
import { bindAccount } from './meAccount.js';
import { getJson, postJson } from '../core/api.js';
import { getMe } from '../core/session.js';
import { site, t } from '../core/site.js';
import * as pageShell from '../components/pageShell.js';
import * as previewCard from '../components/previewCard.js';
import * as signIn from '../components/signIn.js';
import * as nameForm from '../components/nameForm.js';
import * as meTranslations from '../components/meTranslations.js';
import * as meSections from '../components/meSections.js';
import * as ownerSection from '../components/ownerSection.js';
import { ME_PATH } from '../core/routes.js';
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
 * @typedef {import('../components/ownerSection.js').OwnerState} OwnerState
 * @typedef {{ user: MeUser, added: AddedPreview[], hasMore: boolean, translations: Translations,
 *   tab: 'translations'|'added', selected: Set<string>, welcome: boolean, optedOut: boolean,
 *   owner: OwnerState, name?: { value?: string, reason?: string } }} MeState
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
      <h1 class="heading heading--lg c-me__title">${t('me.title')}</h1>
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
    <dialog class="card card--roomy c-me__dialog" aria-labelledby="c-me-delete-title">
      <div class="stack stack--3">
        <h2 class="heading heading--md" id="c-me-delete-title">${t('me.deleteTitle')}</h2>
        <p class="meta c-me__dialog-body">${t('me.deleteBody')}</p>
        <div class="field">
          <label class="field__label" for="c-me-delete-input">${t('me.deleteConfirmLabel')}</label>
          <input id="c-me-delete-input" type="text" autocomplete="off" data-delete-input>
        </div>
        <div class="cluster cluster--2 c-me__dialog-actions">
          <button class="btn btn--secondary" type="button" data-action="cancel-delete">${t('me.cancel')}</button>
          <button class="btn btn--danger" type="button" data-action="confirm-delete" disabled>${t('me.deleteConfirm')}</button>
        </div>
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
  const badge = user.isTranslator ? html` <span class="badge badge--accent" data-translator-badge>${t('me.translatorBadge')}</span>` : '';
  return pageShell.render({
    active: 'me',
    compact: true,
    content: html`
      <h1 class="heading heading--lg c-me__title">${t('me.title')}</h1>
      <div class="card card--compact c-me__head">
        <p class="c-me__who">${whoOf(user)}${badge}</p>
        <div class="cluster cluster--2 c-me__controls">
          <button class="btn btn--secondary btn--icon" type="button" data-action="signout"
            title="${t('me.signOut')}" aria-label="${t('me.signOut')}">${signOutIcon()}</button>
          <button class="btn btn--secondary btn--icon" type="button" data-action="signout-all"
            title="${t('me.signOutAll')}" aria-label="${t('me.signOutAll')}">${signOutAllIcon()}</button>
        </div>
      </div>
      ${panelsOf(state)}
      ${user.isOwner && !user.needsName ? ownerSection.render(state.owner) : ''}
      ${nameStep}
      <section class="c-me__danger">
        <button class="btn btn--danger btn--block" type="button" data-action="open-delete">${t('me.deleteAccount')}</button>
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
 * @param {Element} root @param {MeState} state
 * @returns {void}
 */
export function bind(root, state) {
  previewCard.bind(root);
  /** Re-renders in place after a change the server already accepted. */
  const rerender = () => { mountPage(root, composeSignedIn(state)); bind(root, state); };
  const reload = async () => {
    state.welcome = false;
    const fresh = await getMe();
    state.user = fresh.user ?? state.user;
    state.optedOut = fresh.user?.isOptedOut === true;
    await loadTranslations(state);
    rerender();
  };
  /** Refetches the owner view, keeping the user search the owner typed. */
  const reloadOwner = async () => {
    const [view, imports] = await Promise.all([getJson('/api/owner'), getJson('/api/owner/imports')]);
    state.owner = { ...view, users: state.owner.users, query: state.owner.query, imports: imports.jobs };
    rerender();
  };
  bindTranslator(root, state, { rerender, reload });
  if (state.user.isOwner) ownerSection.bind(root, { owner: state.owner, reload: reloadOwner, rerender });
  bindAccount(root, state, rerender);
  on(root, '[data-action="more-translations"]', 'click', async (_event, button) => {
    button.disabled = true;
    const page = await getJson('/api/me/translations', { offset: state.translations.items.length });
    state.translations.items.push(...page.items);
    state.translations.hasMore = page.hasMore;
    rerender();
  });
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
    owner: { approvalRequired: false, signInFailedAt: null, waiting: [], reports: [], users: null, query: '', imports: [] },
  };
  if (!me.user.needsName) {
    try {
      const page = await getJson('/api/me/added');
      state.added = page.items;
      state.hasMore = page.hasMore;
      if (me.user.isTranslator) await loadTranslations(state);
      if (me.user.isOwner) {
        const [view, imports] = await Promise.all([getJson('/api/owner'), getJson('/api/owner/imports')]);
        state.owner = { ...view, users: null, query: '', imports: imports.jobs };
      }
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
