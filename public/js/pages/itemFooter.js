// @ts-check
/**
 * The item page's footer (task-4 brief): the original post (a link, or
 * X's embed -- Task 10b), "follows on from", who added it, a copy-link
 * button, and the report link. Split out of `item.js` to keep that file
 * under the lint line limits (ruling 6's splits are pre-approved).
 *
 * Plan 2a Task 13 adds the signed-in editor's controls: an edit link and
 * "check for follow-ups", shown only when `itemView` says the caller has
 * that role (`canEdit`/`canCheckFollowUps`). Both are icon-only, so each
 * carries a `title` *and* an `aria-label` with the same words.
 */
import { html } from '../core/html.js';
import { site, t } from '../core/site.js';
import * as sourceEmbed from '../components/sourceEmbed.js';
import * as reportForm from '../components/reportForm.js';
import { editHref } from '../core/routes.js';

/** @typedef {import('../../../src/http/contracts.js').ItemView & { canEdit?: boolean, canCheckFollowUps?: boolean }} FooterView */

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
      text: data.original, author: data.credits.account, source: primary, sourceLanguage: site.sourceLanguage,
    })}</div>`;
  }
  return html`<a class="tap-link tap-link--sm c-item__footer-link" href="${primary.url}">${t('item.originalTweet')}</a>`;
}

/** @param {import('../../../src/http/contracts.js').ItemLink|null} link @returns {import('../core/html.js').SafeHtml} */
function followsOnLine(link) {
  return link ? html`<a class="tap-link tap-link--sm c-item__footer-link" href="${link.url}">${t('item.followsOn')}</a>` : html``;
}

/** @param {import('../../../src/http/contracts.js').AddedByVM|null} addedBy @returns {import('../core/html.js').SafeHtml} */
function addedByLine(addedBy) {
  if (!addedBy) return html``;
  const who = addedBy.kind === 'handle' ? `@${addedBy.handle}` : addedBy.kind === 'name' ? addedBy.name : t('item.addedByFan');
  return html`<p class="meta" data-added-by>${t('item.addedBy')} ${who}</p>`;
}

/**
 * The editor's own controls, for a signed-in caller `itemView` gave the
 * role to: a pencil that opens the entry's edit page, and a button that
 * asks the kind to check for new same-author follow-ups. A stranger gets
 * neither -- `footerBlock` then renders no `.c-item__owner` at all.
 * @param {FooterView} data
 * @returns {import('../core/html.js').SafeHtml}
 */
function ownerControls(data) {
  if (!data.canEdit && !data.canCheckFollowUps) return html``;
  return html`
    <div class="cluster c-item__owner">
      ${data.canEdit
        ? html`<a class="btn btn--secondary btn--icon" href="${editHref(data.kind, data.sourceId)}" title="${t('item.edit')}" aria-label="${t('item.edit')}">✎</a>`
        : ''}
      ${data.canCheckFollowUps
        ? html`<button type="button" class="btn btn--secondary btn--icon" data-action="follow-ups" title="${t('item.followUps')}" aria-label="${t('item.followUps')}">⟳</button>`
        : ''}
    </div>
  `;
}

/**
 * @param {FooterView} data
 * @returns {import('../core/html.js').SafeHtml}
 */
export function footerBlock(data) {
  return html`
    <div class="cluster c-item__footer">
      ${originalPost(data)}
      ${followsOnLine(data.followsOnFrom)}
      ${addedByLine(data.addedBy)}
      <button type="button" class="btn btn--secondary btn--sm" data-action="copy-link">${t('item.copyLink')}</button>
      <button class="btn btn--quiet btn--sm" type="button" data-action="report">${t('item.report')}</button>
      ${ownerControls(data)}
      <p class="c-item__follow-status" role="status" data-follow-ups-status hidden></p>
      ${reportForm.render()}
    </div>
  `;
}
