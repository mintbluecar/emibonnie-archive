// @ts-check
/** The page footer: about/privacy/takedown links, plus the "unofficial, not affiliated" note. */
import { html } from '../core/html.js';
import { t } from '../core/site.js';
import { ABOUT_PATH, PRIVACY_PATH, TAKEDOWN_PATH } from '../core/routes.js';

/** @returns {import('../core/html.js').SafeHtml} */
export function render() {
  return html`
    <footer class="c-footer">
      <nav class="c-footer__links">
        <a class="meta tap-link" href="${ABOUT_PATH}">${t('footer.about')}</a>
        <a class="meta tap-link" href="${PRIVACY_PATH}">${t('footer.privacy')}</a>
        <a class="meta tap-link" href="${TAKEDOWN_PATH}">${t('footer.takedown')}</a>
      </nav>
      <p class="meta">${t('footer.unofficial')}</p>
    </footer>
  `;
}
