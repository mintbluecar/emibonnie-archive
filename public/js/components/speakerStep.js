// @ts-check
/**
 * Step 3 of the add flow and the edit page (Plan 2a Task 13): one
 * dropdown per marker, then every line as it will read. An unmapped
 * marker is never a blocker -- the note says how many are left and Save
 * stays enabled (the owner removed the old gate on purpose: the entry
 * saves and those lines show the marker itself).
 *
 * A subbed entry skips this step entirely, so `render` returns nothing
 * for one. The page owns the picks, the fixes and the re-preview.
 */
import { html } from '../core/html.js';
import { on } from '../core/dom.js';
import { t, tCount } from '../core/site.js';
import * as personPicker from './personPicker.js';
import { fixOf } from '../state/addState.js';

/** @typedef {import('../state/addState.js').Speaker} Speaker */

/**
 * The display label for a marker's current answer: an emoji + name, or
 * the generic role's word. `null` when nothing is mapped yet.
 * @param {Speaker|undefined} speaker
 * @param {any} options
 * @returns {string|null}
 */
export function speakerLabel(speaker, options) {
  if (!speaker) return null;
  if ('person' in speaker) {
    const person = options.people.find((/** @type {any} */ p) => p.id === speaker.person);
    return person ? `${person.emoji} ${person.displayName}` : null;
  }
  return t(`add.role.${speaker.role}`);
}

/**
 * One line's visible speaker, before its text: each of a joint line's
 * markers, or the one marker. A marker with no answer shows as itself, as
 * the saved entry will.
 * @param {any} line @param {Record<string, Speaker>} speakers @param {any} options
 * @returns {string} `''` for plain and footnote lines
 */
function lineWho(line, speakers, options) {
  if (line.kind !== 'speech') return '';
  const speaker = line.fixed ?? speakers[line.marker];
  const markers = line.markers ?? [line.marker];
  if (speaker) {
    const label = speakerLabel(speaker, options);
    if (label) return label;
  }
  return markers.join('');
}

/**
 * One marker's dropdown: the summary says who it maps to (or "choose…") and
 * whether that answer is remembered, and the body is the picker itself.
 * @param {{ entry: { marker: string, count: number }, index: number, speakers: Record<string, Speaker>,
 *   memory: Record<string, Speaker>|undefined, chosen: Record<string, Speaker>, options: any,
 *   open: string|null }} props
 * @returns {import('../core/html.js').SafeHtml}
 */
function markerItem({ entry, index, speakers, memory, chosen, options, open }) {
  const current = speakers[entry.marker] ?? null;
  const label = speakerLabel(current, options);
  const remembered = Boolean(memory && Object.hasOwn(memory, entry.marker) && !Object.hasOwn(chosen, entry.marker));
  return html`
    <details class="c-speaker-step__marker" data-marker="${entry.marker}"${open === entry.marker ? ' open' : ''}>
      <summary class="c-speaker-step__summary">
        <span class="c-speaker-step__src" aria-hidden="true">${entry.marker}</span>
        <span class="c-speaker-step__arrow" aria-hidden="true">→</span>
        <span class="c-speaker-step__pick${label ? '' : ' c-speaker-step__pick--need'}">${label ?? t('add.choose')}</span>
        ${remembered ? html`<span class="c-speaker-step__rem">${t('add.remembered')}</span>` : ''}
      </summary>
      ${personPicker.render({ options, current, idPrefix: `marker-${index}` })}
    </details>
  `;
}

/**
 * One line as it will read, tap-able to open the fix sheet.
 * @param {{ line: any, speakers: Record<string, Speaker>, options: any, lineFixes: any[] }} props
 * @returns {import('../core/html.js').SafeHtml}
 */
function lineItem({ line, speakers, options, lineFixes }) {
  const who = lineWho(line, speakers, options);
  const fixed = Boolean(fixOf(lineFixes, line.part, line.line));
  return html`
    <button type="button" class="c-speaker-step__line${fixed ? ' c-speaker-step__line--fixed' : ''}"
      data-part="${line.part}" data-line="${line.line}">
      ${who ? html`<span class="c-speaker-step__who">${who}</span>` : ''}
      <span class="c-speaker-step__text">${line.text}</span>
    </button>
  `;
}

/**
 * The step's footer: how many markers are still unmapped, and Save when
 * this step owns it.
 * @param {{ unmapped: any[], showSave: boolean }} props
 * @returns {import('../core/html.js').SafeHtml}
 */
function actionBar({ unmapped, showSave }) {
  return html`
    <div class="c-add__actions">
      ${unmapped.length > 0
        ? html`<p class="c-add__note">${tCount('add.unmappedNote', unmapped.length, { n: unmapped.length })}</p>`
        : ''}
      ${showSave ? html`<button class="c-add__save" type="button" data-action="save">${t('add.save')}</button>` : ''}
    </div>
  `;
}

/**
 * @param {{ draft: any, options: any, chosen: Record<string, Speaker>,
 *   open?: string|null, lineFixes?: any[], showSave?: boolean }} props
 *   `open`: the marker whose dropdown is expanded (the page opens one at
 *   a time); `chosen`: this session's picks, so only a remembered answer
 *   (not one just picked) says "remembered". `showSave: false` leaves the
 *   save button to the page (the edit page's one bar).
 * @returns {import('../core/html.js').SafeHtml}
 */
export function render({ draft, options, chosen, open = null, lineFixes = [], showSave = true }) {
  if (draft.subbed) return html``;
  const speakers = { ...draft.speakers, ...chosen };
  const markers = draft.markers ?? [];
  return html`
    <section class="c-speaker-step">
      <h2 class="c-add__heading">${t('add.speakersTitle')}</h2>
      <p class="c-speaker-step__intro">${markers.length > 0
        ? tCount('add.markers', markers.length, { n: markers.length })
        : t('add.markersNone')}</p>
      <div class="c-speaker-step__markers">
        ${markers.map((/** @type {any} */ entry, /** @type {number} */ index) => markerItem({
          entry, index, speakers, memory: draft.memory, chosen, options, open,
        }))}
      </div>
      <h3 class="c-speaker-step__lines-title">${t('add.linesTitle')}</h3>
      <div class="c-speaker-step__lines">
        ${(draft.lines ?? []).map((/** @type {any} */ line) => lineItem({ line, speakers, options, lineFixes }))}
      </div>
      ${actionBar({ unmapped: draft.unmapped ?? [], showSave })}
    </section>
  `;
}

/**
 * The page's step-3 wiring: each marker's picker reports `(marker,
 * speaker)`, each line reports its own `{part, line}` for the fix sheet,
 * and Save is the page's call. A new person goes through the page's
 * `onNewPerson`, shared with the line sheet. The edit page passes no
 * `onSave` (its own Save bar is below the step, with `showSave: false`).
 * @param {Element} el
 * @param {{ onPick: (marker: string, speaker: Speaker) => void,
 *   onLine: (line: { part: number, line: number }) => void,
 *   onSave?: () => void,
 *   onNewPerson: (input: { displayName: string, igHandle: string }) => Promise<{ id: number }> }} ctx
 * @returns {void}
 */
export function bind(el, { onPick, onLine, onSave, onNewPerson }) {
  for (const markerEl of el.querySelectorAll('[data-marker]')) {
    const marker = markerEl.getAttribute('data-marker');
    const pickerEl = markerEl.querySelector('.c-person-picker');
    if (!marker || !pickerEl) continue;
    personPicker.bind(pickerEl, { onPick: (speaker) => onPick(marker, speaker), onNewPerson });
  }
  on(el, '.c-speaker-step__line', 'click', (_event, target) => {
    onLine({ part: Number(target.getAttribute('data-part')), line: Number(target.getAttribute('data-line')) });
  });
  on(el, '[data-action="save"]', 'click', () => onSave?.());
}
