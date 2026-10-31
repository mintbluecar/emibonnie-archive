// @ts-check
/**
 * The add page's markup (Plan 2a Task 13): the three step dots and the
 * card for whichever step is showing -- the paste form (or the screen an
 * ingest outcome lands on), check the details, who's speaking, and the
 * line-fix sheet over the top. Pure: state in, markup out; the page owns
 * the requests, the choices and the debounced re-preview.
 */
import { html } from '../core/html.js';
import { t } from '../core/site.js';
import * as pageShell from './pageShell.js';
import * as addLink from './addLink.js';
import * as addDetails from './addDetails.js';
import * as speakerStep from './speakerStep.js';
import * as lineFixSheet from './lineFixSheet.js';
import * as signIn from './signIn.js';
import * as nameForm from './nameForm.js';

/** @param {any} state @returns {import('../core/html.js').SafeHtml} */
function steps(state) {
  const at = state.preview ? (state.step === 'speakers' ? 2 : 1) : 0;
  return html`<div class="c-add__steps" aria-hidden="true">${[0, 1, 2].map((i) => html`<span${i <= at ? ' data-on' : ''}></span>`)}</div>`;
}

/**
 * The signed-out screen: the page title and the sign-in card, with `/add`
 * as the return path so a visitor comes straight back here.
 * @param {string} returnTo @returns {import('../core/html.js').SafeHtml}
 */
export function signedOut(returnTo) {
  return pageShell.render({
    active: 'add', compact: true,
    content: html`<h1 class="c-me__title">${t('add.title')}</h1>${signIn.render({ returnTo })}`,
  });
}

/**
 * The Google user's "pick a public name" gate, which comes before the form.
 * @param {{ value?: string, reason?: string }} [name] @returns {import('../core/html.js').SafeHtml}
 */
export function nameScreen(name = {}) {
  return pageShell.render({
    active: 'add', compact: true,
    content: html`<h1 class="c-me__title">${t('add.title')}</h1>${nameForm.render(name)}`,
  });
}

/** `draft` plus the parts only the preview knows: the lines as fixed, and what's still unmapped. */
/** @param {any} state @returns {any} */
function speakerDraft(state) {
  return { ...state.preview.draft, lines: state.preview.lines, unmapped: state.preview.unmapped };
}

/**
 * @param {{ state: any, addingAs: string, isOwner: boolean, options: any }} props
 * @returns {import('../core/html.js').SafeHtml}
 */
export function render({ state, addingAs, isOwner, options }) {
  return pageShell.render({
    active: 'add', compact: true,
    content: html`
      <h1 class="c-me__title">${t('add.title')}</h1>
      ${state.status ? '' : steps(state)}
      ${bodyOf(state, { addingAs, isOwner, options })}
    `,
  });
}

/**
 * @param {any} state @param {{ addingAs: string, isOwner: boolean, options: any }} props
 * @returns {import('../core/html.js').SafeHtml}
 */
function bodyOf(state, { addingAs, isOwner, options }) {
  if (state.status) return addLink.render({ addingAs, result: state.status.result, itemHref: state.status.itemHref });
  if (!state.preview) return addLink.render({ addingAs, url: state.link, busy: state.busy, error: state.error });
  const draft = speakerDraft(state);
  return html`
    ${addDetails.render({ draft, options, isOwner, choices: state.choices, media: state.preview.media, showActions: state.step !== 'speakers' })}
    ${state.step === 'speakers' ? speakerStep.render({
      draft, options, chosen: state.chosen, open: state.open, lineFixes: state.lineFixes,
    }) : ''}
    ${state.notice ? html`<p class="notice notice--error c-add__notice" role="alert">${state.notice}</p>` : ''}
    ${state.fix ? lineFixSheet.render({ line: state.fix, options, fixes: state.lineFixes }) : ''}
  `;
}
