// @ts-check
/**
 * The import review page's speaker mapping (Plan 3): one card per
 * translator, one row per unmapped marker with a bulk answer, a per-entry
 * override behind "review", and the publish/retry bar. The page owns
 * fetching; this component renders and calls back.
 */
import { html } from '../core/html.js';
import { on } from '../core/dom.js';
import { postJson } from '../core/api.js';
import { t } from '../core/site.js';
import { speakerSelect, newPersonFields, rowId, bindPick, answerOf } from './importSpeakerPick.js';

/**
 * @typedef {{ itemId: number, kind: string, sourceId: string, text: string }} MarkerEntry
 * @typedef {{ marker: string, count: number, example: string, entries: MarkerEntry[] }} Marker
 * @typedef {{ accountId: number|null, handle: string|null, markers: Marker[] }} MarkerGroup
 * @typedef {{ id: number, displayName: string, igHandle?: string|null }} Person
 * @typedef {{ people: Person[], roles: string[] }} Catalogue
 * @typedef {{ jobId: number, expanded: Set<string>, remember: boolean }} SpeakersState
 * @typedef {{ root: Element, state: SpeakersState, map: (body: any) => Promise<any>,
 *   reload: () => Promise<void>, say: (text: string) => void, fail: () => void }} BindContext
 */

/**
 * The key a marker's "review" toggle stores in `expanded`. The
 * "translator unknown" card's null account is '', as its `data-account`
 * renders, so the toggle (which reads that attribute) finds the same key.
 * @param {MarkerGroup} group @param {Marker} marker
 */
export function markerKey(group, marker) {
  return `${group.accountId ?? ''}:${marker.marker}`;
}

/**
 * One entry behind "review": its own answer, so a bulk map can be
 * corrected for a single entry without touching the others.
 * @param {MarkerGroup} group @param {Marker} marker @param {MarkerEntry} entry @param {Catalogue} catalogue
 */
function entryRow(group, marker, entry, catalogue) {
  return html`
    <li class="c-import-speakers__entry">
      ${speakerSelect(catalogue, {
        attr: 'data-entry-select',
        value: String(entry.itemId),
        label: `${marker.marker} ${entry.sourceId}`,
      })}
      <button class="btn btn--secondary btn--sm btn--icon" type="button" data-action="save-entry" data-item="${entry.itemId}"
        data-marker="${marker.marker}" data-account="${group.accountId}"
        title="${t('import.marker.save')}" aria-label="${t('import.marker.save')}">✓</button>
      <span class="meta c-import-speakers__text">${entry.text}</span>
      ${newPersonFields(rowId([group.accountId, marker.marker, entry.itemId]))}
    </li>
  `;
}

/**
 * One marker: its glyph and uses, an example line, the bulk select, the
 * review toggle and -- when open -- every entry using it.
 * @param {MarkerGroup} group @param {Marker} marker @param {Catalogue} catalogue
 * @param {{ expanded: Set<string> }} view
 */
function markerRow(group, marker, catalogue, view) {
  const open = view.expanded.has(markerKey(group, marker));
  const entries = marker.entries.length > 0 ? html`
    <ul class="c-import-speakers__entries">
      ${marker.entries.map((entry) => entryRow(group, marker, entry, catalogue))}
    </ul>
  ` : '';
  const check = marker.count <= 2 ? html`<p class="c-import-speakers__check">${t('import.marker.check')}</p>` : '';
  return html`
    <li class="c-import-speakers__marker" data-marker="${marker.marker}" data-account="${group.accountId}">
      <span class="c-import-speakers__glyph" aria-hidden="true">${marker.marker}</span>
      <span class="c-import-speakers__uses">${marker.count}</span>
      <span class="meta c-import-speakers__text">${marker.example}</span>
      ${speakerSelect(catalogue, {
        attr: 'data-marker-select', value: marker.marker, label: t('import.marker.select', { marker: marker.marker }),
      })}
      <div class="cluster cluster--2 c-import-speakers__actions">
        <button class="btn btn--secondary btn--sm" type="button" data-action="save-marker"
          data-marker="${marker.marker}" data-account="${group.accountId}">${t('import.marker.save')}</button>
        <button class="btn btn--secondary btn--sm" type="button" data-action="review"
          data-marker="${marker.marker}" data-account="${group.accountId}" aria-expanded="${String(open)}">${t('import.marker.review', { n: marker.entries.length })}</button>
      </div>
      ${newPersonFields(rowId([group.accountId, marker.marker]))}
      ${check}
      ${open ? entries : ''}
    </li>
  `;
}

/** @param {MarkerGroup} group */
function entryCountOf(group) {
  const ids = new Set(group.markers.flatMap((marker) => marker.entries.map((entry) => entry.itemId)));
  return ids.size;
}

/**
 * @param {MarkerGroup} group @param {Catalogue} catalogue
 * @param {{ expanded: Set<string>, remember: boolean }} view
 */
function card(group, catalogue, view) {
  return html`
    <article class="card card--compact stack stack--2" data-account="${group.accountId}" data-speaker-card>
      <header class="c-import-speakers__head">
        <h3 class="heading heading--sm">${group.handle ? `@${group.handle}` : t('import.speakers.none')}</h3>
        <span class="meta">${t('import.speakers.entries', { n: entryCountOf(group) })}</span>
      </header>
      <ul class="c-import-speakers__markers">
        ${group.markers.map((marker) => markerRow(group, marker, catalogue, view))}
      </ul>
      <label class="check meta c-import-speakers__remember">
        <input type="checkbox" data-remember ${view.remember ? 'checked' : ''}> ${t('import.marker.remember')}
      </label>
    </article>
  `;
}

/**
 * @param {{ markers: MarkerGroup[], people: Person[], roles: string[],
 *   expanded: Set<string>, remember: boolean }} props
 */
export function render({ markers, people, roles, expanded, remember }) {
  const catalogue = { people, roles };
  const view = { expanded, remember };
  const cards = markers.length > 0
    ? markers.map((group) => card(group, catalogue, view))
    : html`<p class="meta">${t('import.speakers.empty')}</p>`;
  return html`
    <section class="c-import-speakers stack stack--3">
      <h2 class="heading heading--md">${t('import.speakers.title')}</h2>
      ${cards}
      <div class="cluster cluster--2">
        <button class="btn btn--secondary btn--sm" type="button" data-action="publish-ready">${t('import.publish.ready')}</button>
        <button class="btn btn--secondary btn--sm" type="button" data-action="publish-all">${t('import.publish.all')}</button>
        <button class="btn btn--secondary btn--sm" type="button" data-action="retry-import">${t('import.retry')}</button>
      </div>
      <p class="meta" role="status" data-import-speakers-status></p>
    </section>
  `;
}

/** @param {Element} button @param {string} attribute */
function attrOf(button, attribute) {
  return button.getAttribute(attribute) ?? '';
}

/**
 * Sends the answer in `button`'s row (a marker or an entry), creating a
 * new person first when that's the answer. Nothing chosen sends nothing;
 * a new person who couldn't be added, or a save that changed no entry,
 * says so.
 * @param {BindContext} context @param {Element} button
 * @param {{ row: string, select: string, extra?: Record<string, unknown> }} where
 */
async function sendAnswer(context, button, { row, select, extra = {} }) {
  const rowEl = button.closest(row);
  if (!rowEl) return;
  let speaker;
  try {
    speaker = await answerOf(rowEl, select, (input) => postJson('/api/people', input));
  } catch {
    context.say(t('add.personFailed'));
    return;
  }
  if (!speaker) return;
  // "translator unknown" renders no account (''): entries credited to no one.
  const account = attrOf(button, 'data-account');
  const accountId = account === '' ? null : Number(account);
  const marker = attrOf(button, 'data-marker');
  // "not a speaker" is for this import only: never remembered.
  const remember = 'plain' in speaker ? false : context.state.remember;
  const result = await context.map({ accountId, marker, speaker, remember, ...extra });
  // Nothing to repaint, and a repaint would wipe the message.
  if (result?.updated === 0) { context.say(t('import.marker.nothing')); return; }
  await context.reload();
}

/** @param {BindContext} context */
function bindMapping(context) {
  const { state, reload, fail } = context;
  /** @param {Element} button @param {string} row @param {string} select @param {Record<string, unknown>} [extra] */
  const send = (button, row, select, extra) => { void sendAnswer(context, button, { row, select, extra }).catch(fail); };
  bindPick(context.root);
  on(context.root, '[data-action="save-marker"]', 'click', (_event, button) => {
    send(button, '.c-import-speakers__marker', '[data-marker-select]');
  });
  on(context.root, '[data-action="save-entry"]', 'click', (_event, button) => {
    send(button, '.c-import-speakers__entry', '[data-entry-select]', { entries: [Number(attrOf(button, 'data-item'))] });
  });
  on(context.root, '[data-action="review"]', 'click', (_event, button) => {
    const key = `${attrOf(button, 'data-account')}:${attrOf(button, 'data-marker')}`;
    if (state.expanded.has(key)) state.expanded.delete(key); else state.expanded.add(key);
    void reload().catch(fail);
  });
  on(context.root, '[data-remember]', 'change', (_event, input) => {
    state.remember = /** @type {HTMLInputElement} */ (input).checked;
  });
}

/** @param {BindContext} context @param {'ready'|'all'} scope */
async function publishJob(context, scope) {
  try {
    const result = await postJson(`/api/owner/imports/${context.state.jobId}/publish`, { scope });
    context.say(t('import.publish.done', { n: result.published ?? 0 }));
    await context.reload();
  } catch {
    context.fail();
  }
}

/** @param {BindContext} context */
async function retryJob(context) {
  try {
    let processed = 0;
    let afterId = 0;
    // The route walks ~10 rows per request, from the cursor it hands back;
    // a big job needs a few passes, each one past the last row seen.
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const result = await postJson(`/api/owner/imports/${context.state.jobId}/retry`, { afterId });
      processed += result.processed ?? 0;
      afterId = result.lastId ?? afterId;
      context.say(t('import.retrying', { n: processed }));
      if ((result.remaining ?? 0) <= 0) break;
    }
    await context.reload();
  } catch {
    context.fail();
  }
}

/** @param {BindContext} context */
function bindBar(context) {
  on(context.root, '[data-action="publish-ready"]', 'click', () => { void publishJob(context, 'ready'); });
  on(context.root, '[data-action="publish-all"]', 'click', () => { void publishJob(context, 'all'); });
  on(context.root, '[data-action="retry-import"]', 'click', () => { void retryJob(context); });
}

/**
 * @param {Element} root
 * @param {{ state: SpeakersState, map: (body: any) => Promise<any>, reload: () => Promise<void> }} handlers
 */
export function bind(root, { state, map, reload }) {
  const status = root.querySelector('[data-import-speakers-status]');
  const say = (/** @type {string} */ text) => { if (status) status.textContent = text; };
  const context = { root, state, map, reload, say, fail: () => say(t('import.failed')) };
  bindMapping(context);
  bindBar(context);
}
