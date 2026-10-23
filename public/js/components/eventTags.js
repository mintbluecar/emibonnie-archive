// @ts-check
/**
 * An event's official keywords and hashtags, as labelled rows under its
 * title (owner, 2026-10-23): "keyword: LOVE TO THE MOON AND KEY",
 * "hashtag: #MoonshadowSeriesFinalEP". Keywords are plain text; each
 * hashtag links to X's hashtag search. A row is left out when the event
 * has none of that kind.
 */
import { html } from '../core/html.js';
import { t, tCount } from '../core/site.js';
import { hashtagHref } from '../core/links.js';

/**
 * @param {{ keywords: string[], hashtags: string[] }} event
 * @returns {import('../core/html.js').SafeHtml}
 */
export function render(event) {
  const keywords = event.keywords ?? [];
  const hashtags = event.hashtags ?? [];
  if (keywords.length === 0 && hashtags.length === 0) return html``;
  return html`
    <dl class="c-event-tags">
      ${keywords.length > 0 ? html`
        <div class="c-event-tags__row">
          <dt class="c-event-tags__label">${tCount('event.keywordLabel', keywords.length)}</dt>
          <dd class="c-event-tags__values">${keywords.map((k) => html`<span class="c-event-tags__value">${k}</span>`)}</dd>
        </div>` : ''}
      ${hashtags.length > 0 ? html`
        <div class="c-event-tags__row">
          <dt class="c-event-tags__label">${tCount('event.hashtagLabel', hashtags.length)}</dt>
          <dd class="c-event-tags__values">${hashtags.map((tag) => html`<a class="c-event-tags__value c-event-tags__link" href="${hashtagHref(tag)}" target="_blank" rel="noopener noreferrer" title="${t('chips.searchOnX')}">#${tag}</a>`)}</dd>
        </div>` : ''}
    </dl>
  `;
}
