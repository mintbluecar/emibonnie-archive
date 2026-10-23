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
 * Task 10c (l), same page: `data-cards="hidden"` ("links in a Post are
 * not expanded to photo, video, or link previews": the pinned player
 * already shows the clip), `data-conversation="none"` ("only the cited
 * Post will be displayed even if it is in reply to another Post"). No
 * `data-width` (Task 10d extra, owner): "An embedded Post will adjust to
 * the width of its containing element ... and will fill up to 550
 * horizontal pixels" (docs.x.com/x-for-websites/embedded-posts/faq), so
 * the box's own width (`--embed-width`, tokens.css) sizes it.
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
import { isDark } from '../core/themeChoice.js';
import * as embedBox from './embedBox.js';

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
    return box(html`
      <blockquote class="c-embed c-embed--gone">
        ${body}<p class="c-embed__by">${byline(author)}</p>
        <p class="c-embed__gone">${t('item.sourceGoneEmbed')}</p>
      </blockquote>
    `);
  }
  return box(html`
    <blockquote class="twitter-tweet c-embed" data-dnt="true" data-cards="hidden" data-conversation="none">
      ${body}<p class="c-embed__by">${byline(author)} <a class="c-embed__link" href="${source.url}">${t('item.originalTweet')}</a></p>
    </blockquote>
  `);
}

/**
 * The embed's box (Task 10c, q): an "original tweet" heading, then the
 * embed (or its fallback) cropped at `--embed-max-height` with a fade,
 * and an expand switch that `bind()` shows only when the content is
 * taller than that. X sets no maximum height of its own.
 * @param {import('../core/html.js').SafeHtml} content
 * @returns {import('../core/html.js').SafeHtml}
 */
function box(content) {
  return html`
    <section class="c-embed-box">
      <h2 class="c-embed-box__label">${t('item.embedHeading')}</h2>
      <div class="c-embed-box__clip"><div class="c-embed-box__inner">${content}</div></div>
      <button class="c-embed-box__more" type="button" aria-expanded="false" title="${t('item.embedMore')}" aria-label="${t('item.embedMore')}"
        data-label-more="${t('item.embedMore')}" data-label-less="${t('item.embedLess')}" hidden>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"></path></svg>
      </button>
    </section>
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
 * Sets the dark theme on every embed when the page is dark (the header's
 * switch, else the device: `isDark()`; X renders it once, so a later
 * switch shows on the next load),
 * then adds X's CSP switch and `widgets.js` -- once per page, and only
 * when there's an embed.
 * @param {Element} root
 * @returns {void}
 */
export function bind(root) {
  embedBox.bind(root);
  const quotes = root.querySelectorAll('blockquote.twitter-tweet');
  if (quotes.length === 0) return;
  if (isDark()) for (const quote of quotes) quote.setAttribute('data-theme', 'dark');
  if (document.getElementById(WIDGETS_ID)) return;
  document.head.appendChild(cspMeta());
  const script = document.createElement('script');
  script.id = WIDGETS_ID;
  script.src = WIDGETS_SRC;
  script.async = true;
  script.setAttribute('charset', 'utf-8');
  document.head.appendChild(script);
}
