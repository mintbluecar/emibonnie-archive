// @ts-check
/**
 * The Google user's "pick a public name" form (Plan 2a Task 12). The
 * server owns validation (`cleanDisplayName`) and refuses a name with a
 * reason; this form only shows that reason in the site's own words, and
 * keeps what the visitor typed.
 */
import { html } from '../core/html.js';
import { t } from '../core/site.js';

/** Server reason -> copy key. Anything unrecognised gets the generic one. */
const REASONS = Object.freeze({
  empty: 'me.name.reason.empty',
  too_long: 'me.name.reason.too_long',
  looks_like_handle: 'me.name.reason.looks_like_handle',
});

/**
 * The sentence for a server refusal reason.
 * @param {string} reason
 * @returns {string}
 */
export function reasonCopy(reason) {
  return Object.hasOwn(REASONS, reason)
    ? t(REASONS[/** @type {keyof typeof REASONS} */ (reason)])
    : t('me.name.reason.unknown');
}

/**
 * @param {{ value?: string, reason?: string }} [props]
 *   `value`: what the visitor typed, retained after a refused save.
 *   `reason`: the server's refusal reason, if any.
 * @returns {import('../core/html.js').SafeHtml}
 */
export function render({ value = '', reason } = {}) {
  const describedBy = reason ? 'c-name-form-hint c-name-form-error' : 'c-name-form-hint';
  return html`
    <form class="c-name-form">
      <h2 class="c-name-form__title">${t('me.nameTitle')}</h2>
      <label class="c-name-form__label" for="c-name-form-input">${t('me.nameLabel')}</label>
      <input class="c-name-form__input" id="c-name-form-input" name="name" type="text" maxlength="30"
        autocomplete="off" value="${value}" aria-describedby="${describedBy}">
      <p class="c-name-form__hint" id="c-name-form-hint">${t('me.nameHint')}</p>
      ${reason ? html`<p class="c-name-form__error" id="c-name-form-error" role="alert">${reasonCopy(reason)}</p>` : ''}
      <button class="c-name-form__save" type="submit">${t('me.nameSave')}</button>
    </form>
  `;
}
