// @ts-check
/** The page footer: about/privacy/takedown links, plus the "unofficial, not affiliated" note. */
import { html } from '../core/html.js';
import { t } from '../core/site.js';

/** @returns {import('../core/html.js').SafeHtml} */
export function render() {
  return html`
    <footer class="c-footer">
      <nav class="c-footer__links">
        <a class="c-footer__link" href="/about/">${t('footer.about')}</a>
        <a class="c-footer__link" href="/privacy/">${t('footer.privacy')}</a>
        <a class="c-footer__link" href="/takedown/">${t('footer.takedown')}</a>
      </nav>
      <p class="c-footer__note">${t('footer.unofficial')}</p>
    </footer>
  `;
}
