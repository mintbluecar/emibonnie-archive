// @ts-check
/**
 * The item page's original post, as X's official embed (Task 10b, owner
 * decision "X embed, always", behind the site setting `embedSources`,
 * default off -- see docs/site-settings.md).
 *
 * Markup is X's documented one: a `<blockquote class="twitter-tweet">`
 * holding the post's text, "&mdash; Name (@handle)" and a link to the
 * post, which `widgets.js` replaces with the rendered post
 * (docs.x.com/x-for-websites/embedded-posts/guides/embedded-tweet-parameter-reference,
 * "HTML example"). Until it does -- or when X is blocked, slow or the post
 * is gone -- that blockquote *is* the content: our archived text and
 * author, escaped by `html`. `data-dnt="true"` opts the embed out of X's
 * personalisation (same page, `dnt` parameter); `data-theme="dark"` is
 * set in `bind()` when the visitor is in dark mode (`theme` parameter).
 *
 * `widgets.js` is an external script, added once (by id, as X's own
 * loader does: docs.x.com/x-for-websites/javascript-api/guides/set-up-x-for-websites),
 * only when the page has an embed. It's loaded from
 * `platform.twitter.com` directly: the docs' `platform.x.com/widgets.js`
 * answers a 302 to that host, which would put both hosts in the CSP.
 */
import { html } from '../core/html.js';
import { t } from '../core/site.js';
import { thaiSpans } from '../core/thai.js';

export const WIDGETS_SRC = 'https://platform.twitter.com/widgets.js';
/** X's own loader's id for the script (set-up-x-for-websites), so a second call never adds it again. */
export const WIDGETS_ID = 'twitter-wjs';
/** Only a canonical post URL (what the engine stores: src/kinds/translation/domain.js) is ever embedded. */
const CANONICAL_POST = /^https:\/\/x\.com\/[A-Za-z0-9_]{1,15}\/status\/\d{1,20}$/;

/**
 * @typedef {{ text: string, author: { handle: string, displayName: string|null }|null,
 *   source: import('../../../src/http/contracts.js').SourceLinkVM, sourceLanguage: string }} EmbedProps
 */

/** @param {import('../../../src/http/contracts.js').SourceLinkVM|undefined} source @returns {boolean} */
export function canEmbed(source) {
  return Boolean(source && CANONICAL_POST.test(source.url));
}

/** @param {EmbedProps['author']} author @returns {import('../core/html.js').SafeHtml} */
function byline(author) {
  if (!author) return html``;
  return html`&mdash; ${author.displayName ? html`${author.displayName} ` : ''}(@${author.handle})`;
}

/**
 * X's embed markup with our archived text as its fallback -- or, for a
 * post already marked deleted/unavailable, the same text and author with
 * the `sourceGoneEmbed` note (the text is above it, not below) and no embed at all.
 * @param {EmbedProps} props
 * @returns {import('../core/html.js').SafeHtml}
 */
export function render({ text, author, source, sourceLanguage }) {
  const body = html`<p class="c-embed__text">${thaiSpans(text, sourceLanguage)}</p>`;
  if (source.status !== 'live') {
    return html`
      <blockquote class="c-embed c-embed--gone">
        ${body}<p class="c-embed__by">${byline(author)}</p>
        <p class="c-embed__gone">${t('item.sourceGoneEmbed')}</p>
      </blockquote>
    `;
  }
  return html`
    <blockquote class="twitter-tweet c-embed" data-dnt="true">
      ${body}<p class="c-embed__by">${byline(author)} <a class="c-embed__link" href="${source.url}">${t('item.originalTweet')}</a></p>
    </blockquote>
  `;
}

/**
 * `<meta name="twitter:widgets:csp" content="on">`: X's documented switch
 * that "turn[s] off functionality which could display Content Security
 * Policy warnings" (docs.x.com/x-for-websites/webpage-properties). Without
 * it, widgets.js probes for inline-style support by adding a `<style>`
 * element, which our `style-src 'self'` blocks (a `style-src-elem`
 * violation, seen in a real browser -- Task 10b report).
 * @returns {HTMLMetaElement}
 */
function cspMeta() {
  const meta = document.createElement('meta');
  meta.setAttribute('name', 'twitter:widgets:csp');
  meta.setAttribute('content', 'on');
  return meta;
}

/**
 * Sets the dark theme on every embed when the visitor is in dark mode,
 * then adds X's CSP switch and `widgets.js` -- once per page, and only
 * when there's an embed.
 * @param {Element} root
 * @returns {void}
 */
export function bind(root) {
  const quotes = root.querySelectorAll('blockquote.twitter-tweet');
  if (quotes.length === 0) return;
  const dark = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;
  if (dark) for (const quote of quotes) quote.setAttribute('data-theme', 'dark');
  if (document.getElementById(WIDGETS_ID)) return;
  document.head.appendChild(cspMeta());
  const script = document.createElement('script');
  script.id = WIDGETS_ID;
  script.src = WIDGETS_SRC;
  script.async = true;
  script.setAttribute('charset', 'utf-8');
  document.head.appendChild(script);
}
