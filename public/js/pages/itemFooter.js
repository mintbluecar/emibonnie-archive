// @ts-check
/**
 * The item page's footer (task-4 brief): the original post (a link, or
 * X's embed -- Task 10b), "follows on from", who added it, a copy-link
 * button, and the report link. Split out of `item.js` to keep that file
 * under the lint line limits (ruling 6's splits are pre-approved).
 *
 * Plan 2a Task 13 adds the signed-in editor's controls: an edit link and
 * "check for follow-ups", shown only when the caller's own fields
 * (`…/viewer`, review Task 13) say they have that role
 * (`canEdit`/`canCheckFollowUps`). Both are icon-only, so each carries a
 * `title` *and* an `aria-label` with the same words.
 */
import { html } from '../core/html.js';
import { mount } from '../core/dom.js';
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
 * The editor's own icons, for a signed-in caller `…/viewer` gave the
 * role to: a pencil that opens the entry's edit page, and a button that
 * asks the kind to check for new same-author follow-ups.
 * @param {FooterView} data
 * @returns {import('../core/html.js').SafeHtml}
 */
function ownerIcons(data) {
  return html`${data.canEdit
    ? html`<a class="c-item__icon" href="${editHref(data.kind, data.sourceId)}" title="${t('item.edit')}" aria-label="${t('item.edit')}">✎</a>`
    : ''}${data.canCheckFollowUps
    ? html`<button type="button" class="c-item__icon" data-action="follow-ups" title="${t('item.followUps')}" aria-label="${t('item.followUps')}">⟳</button>`
    : ''}`;
}

/**
 * The editor's controls' place in the footer: hidden and empty until the
 * caller's own fields say they have a role (a stranger never gets a
 * `.c-item__icon`). The cached public view carries no such fields, so the
 * page fills it later, through `mountOwnerControls`.
 * @param {FooterView} data
 * @returns {import('../core/html.js').SafeHtml}
 */
function ownerControls(data) {
  const shown = data.canEdit === true || data.canCheckFollowUps === true;
  return html`<div class="c-item__owner" ${shown ? '' : 'hidden'}>${ownerIcons(data)}</div>`;
}

/**
 * Fills the footer's controls from the caller's own fields (`ItemViewerVM`)
 * once they arrive. Returns whether any control is shown.
 * @param {Element} root @param {FooterView} data
 * @returns {boolean}
 */
export function mountOwnerControls(root, data) {
  const slot = root.querySelector('.c-item__owner');
  const shown = data.canEdit === true || data.canCheckFollowUps === true;
  if (!slot || !shown) return false;
  mount(slot, ownerIcons(data));
  slot.removeAttribute('hidden');
  return true;
}

/**
 * @param {FooterView} data
 * @returns {import('../core/html.js').SafeHtml}
 */
export function footerBlock(data) {
  return html`
    <div class="c-item__footer">
      ${originalPost(data)}
      ${followsOnLine(data.followsOnFrom)}
      ${addedByLine(data.addedBy)}
      <button type="button" class="c-item__copy-link">${t('item.copyLink')}</button>
      <button class="c-item__footer-link" type="button" data-action="report">${t('item.report')}</button>
      ${ownerControls(data)}
      <p class="c-item__follow-status" role="status" data-follow-ups-status hidden></p>
      ${reportForm.render()}
    </div>
  `;
}
