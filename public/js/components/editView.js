// @ts-check
/**
 * The edit page's markup (Plan 2a Task 13): the add flow's steps 2 and 3
 * filled from `GET /api/item/:kind/:sourceId/edit`, one page-level Save
 * bar, and -- for the owner only -- the edit history, each entry with a
 * revert icon button. Pure: page state in, markup out.
 */
import { html } from '../core/html.js';
import { t } from '../core/site.js';
import { dayLabel } from '../core/format.js';
import * as pageShell from './pageShell.js';
import * as addDetails from './addDetails.js';
import * as speakerStep from './speakerStep.js';
import * as lineFixSheet from './lineFixSheet.js';

/** @typedef {import('../state/addState.js').Choices} Choices */
/** @typedef {import('../state/addState.js').LineFix} LineFix */
/** @typedef {import('../state/addState.js').Speaker} Speaker */
/** @typedef {{ role: 'submitter'|'translator'|'owner', fields: any, parts: string[],
 *   lines: any[], unmapped: any[], history: any[], reviewState?: string|null }} EditData */
/** @typedef {{ options: any, data: EditData, choices: Choices, chosen: Record<string, Speaker>,
 *   lineFixes: LineFix[], fix: any|null, open: string|null, busy: boolean,
 *   notice: string|null, saved: boolean, published?: boolean }} EditState */

/** `{marker, count}` for every marker still doing work in the lines (a fixed line's answer is its own). */
/** @param {any[]} lines @returns {{ marker: string, count: number }[]} */
function markersOf(lines) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const line of lines) {
    if (line.kind !== 'speech' || line.fixed) continue;
    for (const marker of line.markers ?? [line.marker]) counts.set(marker, (counts.get(marker) ?? 0) + 1);
  }
  return [...counts].map(([marker, count]) => ({ marker, count }));
}

/** The draft shape the step-2 and step-3 components render from. @param {EditState} s */
function editDraft(s) {
  return {
    common: {}, tweet: {}, newTags: [],
    markers: markersOf(s.data.lines),
    speakers: s.data.fields.speakers,
    memory: s.data.fields.speakers,
    lines: s.data.lines,
    unmapped: s.data.unmapped,
    subbed: s.data.fields.subbed === true,
  };
}

/** @param {any} at @returns {string} */
function whenLabel(at) {
  return dayLabel(String(at).slice(0, 10));
}

/** @param {any[]} history @returns {import('../core/html.js').SafeHtml} */
function historyBlock(history) {
  return html`
    <section class="c-edit__history">
      <h2 class="c-add__heading">${t('edit.history')}</h2>
      ${history.length === 0 ? '' : html`
        <ul class="c-edit__edits">
          ${history.map((entry) => html`
            <li class="c-edit__edit">
              <p class="c-edit__when">${t('edit.by', { name: entry.by })} · ${whenLabel(entry.at)}</p>
              <p class="c-edit__what">${t('edit.changed', { fields: entry.changed.join(', ') })}</p>
              ${entry.reverted
                ? html`<span class="c-edit__reverted">${t('edit.reverted')}</span>`
                : html`<button type="button" class="c-edit__revert" data-action="revert" data-edit="${entry.id}"
                    title="${t('edit.revert')}" aria-label="${t('edit.revert')}">↺</button>`}
            </li>
          `)}
        </ul>
      `}
    </section>
  `;
}

/** The buttons and the save/publish messages. @param {EditState} s @param {boolean} held */
function actionsBlock(s, held) {
  return html`
    <div class="c-edit__actions">
      <button class="c-add__save" type="button" data-action="save"${s.busy ? ' disabled' : ''}>
        ${s.busy ? t('edit.saving') : t('edit.save')}
      </button>
      ${held ? html`
        <button class="c-add__save" type="button" data-action="save-publish"${s.busy ? ' disabled' : ''}>
          ${s.busy ? t('edit.saving') : t('edit.saveAndPublish')}
        </button>
      ` : ''}
      ${s.notice ? html`<p class="c-edit__notice" role="alert">${s.notice}</p>` : ''}
      ${s.saved ? html`<p class="c-edit__saved" role="status">${t('edit.saved')}</p>` : ''}
      ${s.published ? html`<p class="c-edit__published" role="status">${t('edit.published')}</p>` : ''}
    </div>
  `;
}

/** @param {EditState} s @returns {import('../core/html.js').SafeHtml} */
export function render(s) {
  const draft = editDraft(s);
  const isOwner = s.data.role === 'owner';
  const held = s.data.reviewState === 'pending';
  return pageShell.render({
    active: 'me', compact: true,
    content: html`
      <h1 class="c-me__title">${t('edit.title')}</h1>
      ${held ? html`<p class="c-item__held" role="status">${t('item.held')}</p>` : ''}
      ${addDetails.render({ draft, options: s.options, isOwner, choices: s.choices, showActions: false, allowNewEvent: false })}
      ${speakerStep.render({ draft, options: s.options, chosen: s.chosen, open: s.open, lineFixes: s.lineFixes, showSave: false })}
      ${s.fix ? lineFixSheet.render({ line: s.fix, options: s.options, fixes: s.lineFixes }) : ''}
      ${actionsBlock(s, held)}
      ${isOwner ? historyBlock(s.data.history) : ''}
    `,
  });
}
