// @ts-check
/**
 * The item page's footer (task-4 brief): links to the original tweet
 * and original media, "follows on from", who added it, a copy-link
 * button, and the report link. Split out of `item.js` to keep that file
 * under the lint line limits (ruling 6's splits are pre-approved).
 */
import { html } from '../core/html.js';
import { t } from '../core/site.js';

/** @type {Record<string, string>} the copy key for one source link's role */
const SOURCE_LABEL = { primary: 'item.originalTweet', media: 'item.originalMedia', quoted: 'item.originalTweet' };

/** @param {import('../../../src/http/contracts.js').SourceLinkVM[]} sources @returns {import('../core/html.js').SafeHtml} */
function sourceLinks(sources) {
  return html`${sources.map((s) => html`<a class="c-item__footer-link" href="${s.url}">${t(SOURCE_LABEL[s.role] ?? 'item.originalTweet')}</a>`)}`;
}

/** @param {import('../../../src/http/contracts.js').ItemLink|null} link @returns {import('../core/html.js').SafeHtml} */
function followsOnLine(link) {
  return link ? html`<a class="c-item__footer-link" href="${link.url}">${t('item.followsOn')}</a>` : html``;
}

/** @param {import('../../../src/http/contracts.js').AddedByVM|null} addedBy @returns {import('../core/html.js').SafeHtml} */
function addedByLine(addedBy) {
  if (!addedBy) return html``;
  const who = addedBy.kind === 'handle' ? `@${addedBy.handle}` : addedBy.kind === 'name' ? addedBy.name : t('item.addedByFan');
  return html`<p class="c-item__added-by">${t('item.addedBy')} ${who}</p>`;
}

/**
 * @param {import('../../../src/http/contracts.js').ItemView} data
 * @returns {import('../core/html.js').SafeHtml}
 */
export function footerBlock(data) {
  return html`
    <div class="c-item__footer">
      ${sourceLinks(data.sources)}
      ${followsOnLine(data.followsOnFrom)}
      ${addedByLine(data.addedBy)}
      <button type="button" class="c-item__copy-link">${t('item.copyLink')}</button>
      <a class="c-item__footer-link" href="/takedown/">${t('item.report')}</a>
    </div>
  `;
}
