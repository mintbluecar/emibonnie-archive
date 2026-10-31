// @ts-check
/**
 * The three static trust-and-safety pages (task-6-brief.md "Static
 * pages") plus the 404 page: each renders nothing but copy keys
 * (`about.*`, `privacy.*`, `takedown.*`, `static.*`), so a site can
 * retune or translate every word through `site/copy.json` without
 * touching this file. Which page to render comes from `<body
 * data-page="…">` (set per `public/*.html`, plain static markup, not a
 * copy string), never guessed from the URL -- `404.html` in particular
 * can be served for *any* unmatched path, so it can't rely on its own
 * pathname naming the page.
 */
import { html } from '../core/html.js';
import { mountPage } from '../core/dom.js';
import { site, t } from '../core/site.js';
import * as pageShell from '../components/pageShell.js';
import * as emptyState from '../components/emptyState.js';
import { HOME_PATH } from '../core/routes.js';

const APP_SELECTOR = 'app';

/** @param {string} labelKey @returns {import('../core/html.js').SafeHtml} */
const contactLink = (labelKey) => html`<p class="c-static__contact"><a href="${site.contactUrl}" rel="noopener">${t(labelKey)}</a></p>`;

/** @returns {import('../core/html.js').SafeHtml} */
function aboutContent() {
  return html`
    <h1 class="heading heading--lg c-static__title">${t('about.title')}</h1>
    <p class="c-static__badge"><span class="badge">${t('badge.fanMade')}</span></p>
    <p class="c-static__p">${t('about.whatIsThis')}</p>
    <p class="c-static__p">${t('about.credits')}</p>
    <p class="c-static__p">${t('footer.unofficial')}</p>
    ${site.logo ? html`<p class="c-static__p">${t('about.logoCredit')}</p>` : ''}
  `;
}

/** X's own privacy policy, linked from the embed notice. */
const X_PRIVACY_URL = 'https://x.com/en/privacy';

/**
 * Task 10b: only a site that turns `embedSources` on loads anything from
 * X, so only its privacy page says so.
 * @returns {import('../core/html.js').SafeHtml}
 */
function embedNotice() {
  if (!site.embedSources) return html``;
  return html`
    <p class="c-static__p" data-embed-notice>${t('privacy.embedNotice')}
      <a href="${X_PRIVACY_URL}" rel="noopener">${t('privacy.embedPolicyLinkLabel')}</a></p>
  `;
}

/** @returns {import('../core/html.js').SafeHtml} */
function privacyContent() {
  const keys = [
    'privacy.whoRuns', 'privacy.whatCollected', 'privacy.thirdParties', 'privacy.retention',
    'privacy.publicPrivate', 'privacy.translatorOptOut', 'privacy.accountDeletion',
    // With X's embed on, "no trackers" would contradict the embed notice (review fix round 1, I1).
    site.embedSources ? 'privacy.noSaleNoAdsEmbed' : 'privacy.noSaleNoAds',
  ];
  return html`
    <h1 class="heading heading--lg c-static__title">${t('privacy.title')}</h1>
    ${keys.map((key) => html`<p class="c-static__p">${t(key)}</p>${key === 'privacy.thirdParties' ? embedNotice() : ''}`)}
    <h2 class="heading heading--sm c-static__subtitle">${t('privacy.contactLabel')}</h2>
    ${contactLink('privacy.contactLinkLabel')}
  `;
}

/** @returns {import('../core/html.js').SafeHtml} */
function takedownContent() {
  return html`
    <h1 class="heading heading--lg c-static__title">${t('takedown.title')}</h1>
    <p class="c-static__p">${t('takedown.whoCanAsk')}</p>
    <p class="c-static__p">${t('takedown.whatToSend')}</p>
    <p class="c-static__p">${t('takedown.response')}</p>
    ${contactLink('takedown.contactLinkLabel')}
  `;
}

/** @returns {import('../core/html.js').SafeHtml} */
function notFoundContent() {
  return html`
    ${emptyState.render({ message: t('static.notFound'), icon: '🧭' })}
    <p class="c-static__back"><a href="${HOME_PATH}">${t('static.notFoundBack')}</a></p>
  `;
}

/** `data-page` -> that page's content (defensive default: every shipped `public/*.html` sets a known one, but a stray value still renders *something*). @type {Record<string, () => import('../core/html.js').SafeHtml>} */
const CONTENT_BY_PAGE = {
  about: aboutContent, privacy: privacyContent, takedown: takedownContent, notFound: notFoundContent,
};

/** Every call here is a literal `t('…')` (never a computed key), so `scripts/buildChecks.js`'s missing-copy-key scan still covers it. @param {string} page @returns {string} */
function titleFor(page) {
  if (page === 'about') return t('about.title');
  if (page === 'privacy') return t('privacy.title');
  if (page === 'takedown') return t('takedown.title');
  return t('static.notFound');
}

/**
 * The whole page for one `data-page` value -- pure, like every other
 * page's own `composeX()` (`composePerson`, `composeEvent`, …), so it's
 * testable with no DOM at all.
 * @param {string} page
 * @returns {import('../core/html.js').SafeHtml}
 */
export function composeStatic(page) {
  const contentOf = CONTENT_BY_PAGE[page] ?? notFoundContent;
  return pageShell.render({ compact: true, content: contentOf() });
}

/** @returns {void} */
export function start() {
  const root = document.getElementById(APP_SELECTOR);
  if (!root) return;
  const page = document.body.getAttribute('data-page') ?? 'notFound';
  document.title = `${titleFor(page)} · ${site.name}`;
  mountPage(root, composeStatic(page));
}

if (typeof document !== 'undefined') start();
