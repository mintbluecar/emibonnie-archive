// @ts-check
/**
 * The line-by-line fix sheet (Plan 2a Task 13): mark one line as speech
 * or plain, and pick who speaks it even where the parser found no marker
 * or one marker means different people on different lines. The sheet
 * only reports the choice (`{part, line, as: …}`); the page stores it as
 * a line fix and re-previews. Closing without choosing is `cancel`. A new
 * person typed into the picker goes through the page's own `onNewPerson`,
 * the same callback every other picker on the page uses.
 */
import { html } from '../core/html.js';
import { on } from '../core/dom.js';
import { t } from '../core/site.js';
import * as personPicker from './personPicker.js';
import { fixOf } from '../state/addState.js';

/** @typedef {import('../state/addState.js').LineFix} LineFix */
/** @typedef {import('../state/addState.js').Speaker} Speaker */

/** @param {any} line @returns {string} */
function lineText(line) {
  if (line.kind === 'footnote') return `${line.mark ?? ''} ${line.text ?? ''}`.trim();
  return line.text ?? '';
}

/**
 * @param {{ line: any, options: any, fixes?: LineFix[] }} props
 *   `fixes`: the fixes already chosen, so the sheet shows which answer is
 *   current (a line marked plain offers speech to put it back).
 * @returns {import('../core/html.js').SafeHtml}
 */
export function render({ line, options, fixes = [] }) {
  const fix = fixOf(fixes, line.part, line.line);
  const current = fix && fix.as === 'speech' ? /** @type {Speaker} */ (fix.speaker) : null;
  return html`
    <section class="c-line-fix" role="dialog" aria-label="${t('add.fixLine')}">
      <h2 class="c-line-fix__title">${t('add.fixLine')}</h2>
      <p class="c-line-fix__line">${lineText(line)}</p>
      <div class="c-line-fix__actions">
        <button type="button" class="c-line-fix__action${fix && fix.as === 'speech' ? ' c-line-fix__action--on' : ''}"
          data-action="speech">${t('add.lineSpeech')}</button>
        <button type="button" class="c-line-fix__action${fix && fix.as === 'plain' ? ' c-line-fix__action--on' : ''}"
          data-action="plain">${t('add.linePlain')}</button>
        <button type="button" class="c-line-fix__cancel" data-action="cancel">${t('add.cancel')}</button>
      </div>
      <div class="c-line-fix__picker" hidden>
        <p class="c-line-fix__speaker">${t('add.lineSpeaker')}</p>
        ${personPicker.render({ options, current, idPrefix: `line-${line.part}-${line.line}` })}
      </div>
    </section>
  `;
}

/**
 * @param {Element} el
 * @param {{ line: any, onFix: (fix: LineFix) => void, onCancel?: () => void,
 *   onNewPerson?: (input: { displayName: string, igHandle: string }) => Promise<{ id: number }> }} ctx
 * @returns {void}
 */
export function bind(el, { line, onFix, onCancel, onNewPerson }) {
  const picker = el.querySelector('.c-line-fix__picker');
  on(el, '[data-action="plain"]', 'click', () => onFix({ part: line.part, line: line.line, as: 'plain' }));
  on(el, '[data-action="speech"]', 'click', () => {
    if (picker) /** @type {HTMLElement} */ (picker).hidden = false;
  });
  on(el, '[data-action="cancel"]', 'click', () => onCancel?.());
  const pickerEl = picker ?? el;
  personPicker.bind(pickerEl, {
    onPick: (speaker) => onFix({ part: line.part, line: line.line, as: 'speech', speaker }),
    onNewPerson: onNewPerson ?? (async () => {
      throw new Error('no new-person handler');
    }),
  });
}
