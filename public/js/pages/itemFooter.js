// @ts-check
/**
 * The item page's footer (task-4 brief): the original post (a link, or
 * X's embed -- Task 10b), "follows on from", who added it, a copy-link
 * button, and the report link. Split out of `item.js` to keep that file
 * under the lint line limits (ruling 6's splits are pre-approved).
 */
import { html } from '../core/html.js';
import { site, t } from '../core/site.js';
import * as sourceEmbed from '../components/sourceEmbed.js';

/**
 * The original post: X's embed when the site turns `embedSources` on
 * (Task 10b) and the post has a canonical URL, else a single "original
 * tweet" link (Task 10b dropped "original media" and "quoted tweet": the
 * pinned media area already shows those).
 * @param {import('../../../src/http/contracts.js').ItemView} data
 * @returns {import('../core/html.js').SafeHtml}
 */
function originalPost(data) {
  const primary = data.sources.find((s) => s.role === 'primary');
  if (!primary) return html``;
  if (site.embedSources && sourceEmbed.canEmbed(primary)) {
    return html`<div class="c-item__embed">${sourceEmbed.render({
      text: data.original, author: data.credits.account, postedAt: data.credits.postedAt, source: primary, sourceLanguage: site.sourceLanguage,
    })}</div>`;
  }
  return html`<a class="c-item__footer-link" href="${primary.url}">${t('item.originalTweet')}</a>`;
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
      ${originalPost(data)}
      ${followsOnLine(data.followsOnFrom)}
      ${addedByLine(data.addedBy)}
      <button type="button" class="c-item__copy-link">${t('item.copyLink')}</button>
      <a class="c-item__footer-link" href="/takedown/">${t('item.report')}</a>
    </div>
  `;
}
