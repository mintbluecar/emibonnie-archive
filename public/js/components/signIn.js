// @ts-check
/**
 * The sign-in screen (Plan 2a Task 12, mockup
 * `translator-signin-v2.html`): the site's brand, the one line saying
 * what signing in is for, then X first and Google second. X is first
 * because only an X sign-in can recognise a translator; both keep their
 * provider name in text (an icon alone can't say which account type
 * you're choosing). Both are plain links to the OAuth start route, with
 * the page to come back to.
 */
import { html } from '../core/html.js';
import { site, t } from '../core/site.js';

/** @typedef {'x'|'google'} Provider */

/**
 * The OAuth start link for `provider`, coming back to `returnTo`.
 * @param {Provider} provider @param {string} returnTo
 * @returns {string}
 */
export function startHref(provider, returnTo) {
  return `/api/auth/${provider}/start?return=${encodeURIComponent(returnTo)}`;
}

/** The provider's mark, kept out of the accessible name: the text beside it says which one. @param {Provider} provider */
function mark(provider) {
  return provider === 'x'
    ? html`<span class="c-signin__mark" aria-hidden="true">𝕏</span>`
    : html`<span class="c-signin__mark c-signin__mark--google" aria-hidden="true">G</span>`;
}

/**
 * @param {{ returnTo?: string, failed?: boolean }} [props]
 *   `returnTo`: the path the OAuth callback sends the visitor back to.
 *   `failed`: the callback landed on `?signin=failed`.
 * @returns {import('../core/html.js').SafeHtml}
 */
export function render({ returnTo = '/me', failed = false } = {}) {
  return html`
    <section class="card card--roomy c-signin">
      <div class="c-signin__brand">
        ${site.logo ? html`<img class="c-signin__logo" src="${site.logo}" alt="" width="64" height="64">` : ''}
        <p class="c-signin__wordmark"><span class="c-signin__accent">${site.wordmark.accent}</span>${site.wordmark.rest}</p>
        <p class="badge c-signin__badge">${t('badge.fanMade')}</p>
      </div>
      ${failed ? html`<p class="notice notice--error c-signin__failed" role="alert">${t('signIn.failed')}</p>` : ''}
      <p class="meta c-signin__pitch">${t('signIn.pitch')}<br>${t('signIn.pitchTranslators')}</p>
      <a class="btn btn--block c-signin__provider c-signin__provider--x" href="${startHref('x', returnTo)}">
        ${mark('x')}<span>${t('signIn.withX')}</span>
      </a>
      <a class="btn btn--secondary btn--block c-signin__provider" href="${startHref('google', returnTo)}">
        ${mark('google')}<span>${t('signIn.withGoogle')}</span>
      </a>
      <p class="meta c-signin__keep"><b>${t('signIn.keepLabel')}</b> ${t('signIn.keep')}</p>
    </section>
  `;
}
