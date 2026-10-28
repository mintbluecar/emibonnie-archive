// @ts-check
/**
 * The me page's account actions (Plan 2b, split out to keep pages/me.js
 * under the lint limit): sign out, sign out everywhere, delete my account
 * behind its typed confirmation, and the Google display-name form.
 */
import { on } from '../core/dom.js';
import { postJson, ApiError } from '../core/api.js';
import { HOME_PATH } from '../core/routes.js';

/** @typedef {{ name?: { value?: string, reason?: string } }} AccountState */

/**
 * Sign in/out, the delete dialog and the Google name form.
 * @param {Element} root @param {AccountState} state @param {() => void} rerender
 */
export function bindAccount(root, state, rerender) {
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
