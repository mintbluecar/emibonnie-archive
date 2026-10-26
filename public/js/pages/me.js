// @ts-check
/**
 * The me page (Plan 2a Task 12): signed out, it is the sign-in screen;
 * signed in, it is "added by me" -- every entry the visitor submitted, in
 * any review state, with an edit link -- plus the Google name form when
 * one is still needed, sign out / sign out everywhere, and delete my
 * account behind a typed confirmation. The translator-only parts of me
 * (my translations, remove/restore, opt out) are 2b; nothing here knows
 * about them.
 */
import { html } from '../core/html.js';
import { mount, mountPage, on } from '../core/dom.js';
import { getJson, postJson, ApiError } from '../core/api.js';
import { getMe } from '../core/session.js';
import { site, t } from '../core/site.js';
import * as pageShell from '../components/pageShell.js';
import * as previewCard from '../components/previewCard.js';
import * as signIn from '../components/signIn.js';
import * as nameForm from '../components/nameForm.js';
import { editHref, HOME_PATH, ME_PATH } from '../core/routes.js';
import { mountLoadError } from './pageError.js';

const APP_SELECTOR = 'app';
/** @typedef {import('../../../src/http/contracts.js').AddedPreview} AddedPreview */
/**
 * @typedef {{
 *   via: 'x'|'google', handle: string|null, displayName: string|null,
 *   isOwner: boolean, isTranslator: boolean, needsName: boolean,
 * }} MeUser
 * @typedef {{ user: MeUser, added: AddedPreview[], hasMore: boolean,
 *   name?: { value?: string, reason?: string } }} MeState
 */

/** @returns {import('../core/html.js').SafeHtml} */
function pencil() {
  return html`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M4 20h4L20 8l-4-4L4 16v4z"></path><path d="M14 6l4 4"></path>
  </svg>`;
}

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

/** @param {string} state @returns {string} */
function stateLabel(state) {
  if (state === 'pending') return t('me.pending');
  if (state === 'rejected') return t('me.rejected');
  return '';
}

/** @param {AddedPreview} preview @returns {import('../core/html.js').SafeHtml} */
function entry(preview) {
  const label = stateLabel(preview.reviewState);
  return html`
    <li class="c-me__entry">
      ${previewCard.render({ result: preview, compact: true })}
      <div class="c-me__bar">
        ${label ? html`<span class="c-me__state c-me__state--${preview.reviewState}">${label}</span>` : html`<span></span>`}
        <a class="c-me__icon c-me__edit" href="${editHref(preview.kind, preview.sourceId)}"
          title="${t('me.edit')}" aria-label="${t('me.edit')}">${pencil()}</a>
      </div>
    </li>
  `;
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

/**
 * @param {MeState} state
 * @returns {import('../core/html.js').SafeHtml}
 */
export function composeSignedIn(state) {
  const { user, added, hasMore, name } = state;
  const list = added.length > 0
    ? html`<ul class="c-me__list">${added.map(entry)}</ul>`
    : html`<p class="c-me__empty">${t('me.empty')}</p>`;
  const nameStep = (name || user.needsName) ? nameForm.render(name ?? {}) : '';
  return pageShell.render({
    active: 'me',
    compact: true,
    content: html`
      <h1 class="c-me__title">${t('me.title')}</h1>
      <div class="c-me__head">
        <p class="c-me__who">${whoOf(user)}</p>
        <div class="c-me__controls">
          <button class="c-me__icon" type="button" data-action="signout"
            title="${t('me.signOut')}" aria-label="${t('me.signOut')}">${signOutIcon()}</button>
          <button class="c-me__icon" type="button" data-action="signout-all"
            title="${t('me.signOutAll')}" aria-label="${t('me.signOutAll')}">${signOutAllIcon()}</button>
        </div>
      </div>
      ${user.needsName ? '' : html`
        <h2 class="c-me__heading">${t('me.addedByMe')}</h2>
        ${list}
        ${hasMore ? html`<button class="c-me__more" type="button" data-action="more">${t('me.more')}</button>` : ''}
      `}
      ${nameStep}
      <section class="c-me__danger">
        <button class="c-me__delete" type="button" data-action="open-delete">${t('me.deleteAccount')}</button>
      </section>
      ${deleteDialog()}
    `,
  });
}

/**
 * @param {Element} root @param {MeState} state
 * @returns {void}
 */
export function bind(root, state) {
  previewCard.bind(root);
  on(root, '[data-action="signout"]', 'click', async () => {
    await postJson('/api/auth/signout');
    window.location.reload();
  });
  on(root, '[data-action="signout-all"]', 'click', async () => {
    await postJson('/api/auth/signout-all');
    window.location.reload();
  });
  on(root, '[data-action="more"]', 'click', async (_event, button) => {
    button.disabled = true;
    const page = await getJson('/api/me/added', { offset: state.added.length });
    state.added.push(...page.items);
    state.hasMore = page.hasMore;
    mount(root, composeSignedIn(state));
    previewCard.bind(root);
  });
  on(root, '[data-action="open-delete"]', 'click', () => {
    const dialog = /** @type {HTMLDialogElement|null} */ (root.querySelector('.c-me__dialog'));
    dialog?.showModal();
  });
  on(root, '[data-action="cancel-delete"]', 'click', () => {
    const dialog = /** @type {HTMLDialogElement|null} */ (root.querySelector('.c-me__dialog'));
    dialog?.close();
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
      mount(root, composeSignedIn({ ...state, name: { value, reason } }));
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
  const state = { user: me.user, added: [], hasMore: false };
  if (!me.user.needsName) {
    try {
      const page = await getJson('/api/me/added');
      state.added = page.items;
      state.hasMore = page.hasMore;
    } catch {
      mountLoadError(root, { active: 'me' });
      return;
    }
  }
  mountPage(root, composeSignedIn(state));
  bind(root, state);
}

if (typeof document !== 'undefined') start();
