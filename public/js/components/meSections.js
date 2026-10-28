// @ts-check
/**
 * The me page's two panels (Plan 2b): the translator tabs, "my
 * translations" (the translator component) and "added by me". Split out
 * of pages/me.js to keep that page under the lint limits.
 */
import { html } from '../core/html.js';
import { t } from '../core/site.js';
import * as previewCard from './previewCard.js';
import * as meTranslations from './meTranslations.js';
import { editHref } from '../core/routes.js';

/** @typedef {import('./meTranslations.js').TranslationsState} TranslationsState */
/** @typedef {import('../../../src/http/contracts.js').AddedPreview} AddedPreview */

/**
 * @param {{ reviewState: string }} preview
 * @returns {string}
 */
function stateLabel(preview) {
  if (preview.reviewState === 'pending') return t('me.pending');
  if (preview.reviewState === 'rejected') return t('me.rejected');
  return '';
}

/** @param {AddedPreview} preview @returns {import('../core/html.js').SafeHtml} */
function entry(preview) {
  const label = stateLabel(preview);
  return html`
    <li class="c-me__entry">
      ${previewCard.render({ result: preview, compact: true })}
      <div class="c-me__bar">
        ${label ? html`<span class="c-me__state c-me__state--${preview.reviewState}">${label}</span>` : html`<span></span>`}
        <a class="c-me__icon c-me__edit" href="${editHref(preview.kind, preview.sourceId)}"
          title="${t('me.edit')}" aria-label="${t('me.edit')}">${pencil()}</a>
      </div>
    </li>
  `;
}

/** @returns {import('../core/html.js').SafeHtml} */
function pencil() {
  return html`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M4 20h4L20 8l-4-4L4 16v4z"></path><path d="M14 6l4 4"></path>
  </svg>`;
}

/**
 * The translator's two views, as role=tab buttons.
 * @param {{ tab: 'translations'|'added' }} state
 * @returns {import('../core/html.js').SafeHtml}
 */
export function tabs(state) {
  return html`
    <div class="c-me__tabs" role="tablist">
      <button class="c-me__tab${state.tab === 'translations' ? ' c-me__tab--on' : ''}" type="button" role="tab"
        aria-selected="${state.tab === 'translations'}" data-action="tab" data-tab="translations">${t('me.translations.title')}</button>
      <button class="c-me__tab${state.tab === 'added' ? ' c-me__tab--on' : ''}" type="button" role="tab"
        aria-selected="${state.tab === 'added'}" data-action="tab" data-tab="added">${t('me.translations.tabAdded')}</button>
    </div>
  `;
}

/**
 * @param {{ added: AddedPreview[], hasMore: boolean }} state
 * @returns {import('../core/html.js').SafeHtml}
 */
export function added(state) {
  const list = state.added.length > 0
    ? html`<ul class="c-me__list">${state.added.map(entry)}</ul>`
    : html`<p class="c-me__empty">${t('me.empty')}</p>`;
  return html`
    <h2 class="c-me__heading">${t('me.addedByMe')}</h2>
    ${list}
    ${state.hasMore ? html`<button class="c-me__more" type="button" data-action="more">${t('me.more')}</button>` : ''}
  `;
}

/**
 * @param {TranslationsState} state
 * @returns {import('../core/html.js').SafeHtml}
 */
export function translations(state) {
  return meTranslations.render(state);
}
