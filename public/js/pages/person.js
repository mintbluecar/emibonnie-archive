// @ts-check
/**
 * The person page (task-6-brief.md "Person page"): a `personHeader` in
 * the person's own colour, the "in N translations · M events · K shared
 * stories" line, a search icon scoped to this person, the segmented
 * control (by event / all, newest / with…), and the grouped entries
 * themselves (`hubGroups.js`). "with…" opens a people picker (fetched
 * from `/api/filters`, the same roster the search page's own filter
 * sheet uses) and sends the chosen people, plus this page's own person,
 * to a scoped search (`peopleMode=all`) -- built through
 * `state/searchState.js`'s `toQuery`, never by hand.
 */
import { html } from '../core/html.js';
import { mount, on } from '../core/dom.js';
import { getJson, ApiError } from '../core/api.js';
import { site, t } from '../core/site.js';
import * as chips from '../components/chips.js';
import * as personHeader from '../components/personHeader.js';
import * as emptyState from '../components/emptyState.js';
import * as pageShell from '../components/pageShell.js';
import * as headerLinks from '../components/headerLinks.js';
import { EMPTY_STATE, toQuery } from '../state/searchState.js';
import { igFromPersonPath, personHref } from '../core/routes.js';
import { activeView, bindSections, segmentedControl } from './hubGroups.js';

const APP_SELECTOR = 'app';
/** @typedef {import('../../../src/http/contracts.js').PersonView} PersonView */
/** @typedef {import('../../../src/http/contracts.js').FilterOptions} FilterOptions */
/** @typedef {{ seg: import('./hubGroups.js').SegKey, options: FilterOptions|null, seq: number }} Ctx */

/** @param {PersonView} data @returns {import('../core/html.js').SafeHtml} */
function headRow(data) {
  const href = `/search?${toQuery({ ...EMPTY_STATE, people: [data.person.id] }).toString()}`;
  return html`
    <div class="c-person__head">
      ${personHeader.render({ person: data.person })}
      <a class="c-person__search" href="${href}" aria-label="${t('person.search')}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7"></circle>
          <path d="M21 21l-4.3-4.3"></path>
        </svg>
      </a>
    </div>
  `;
}

/** @param {PersonView['counts']} counts @returns {import('../core/html.js').SafeHtml} */
const countsLine = (counts) => html`<p class="c-hub__counts">${t('person.counts', { items: counts.items, events: counts.events, shared: counts.sharedStories })}</p>`;

/** @param {number} selfId @param {import('../../../src/http/contracts.js').PersonChip[]} people @returns {import('../core/html.js').SafeHtml} */
function pickerMarkup(selfId, people) {
  const items = people.filter((p) => p.id !== selfId).map((p) => ({ label: `${p.emoji} ${p.name}`, colour: p.colour, value: p.id }));
  return html`
    <dialog class="c-hub__picker" aria-label="${t('person.withTitle')}">
      <button type="button" class="c-hub__picker-close" aria-label="${t('person.closePicker')}">✕</button>
      <h2 class="c-hub__picker-title">${t('person.withTitle')}</h2>
      ${chips.render({ items })}
      <button type="button" class="c-hub__picker-apply">${t('person.withApply')}</button>
    </dialog>
  `;
}

/** @param {PersonView} data @returns {import('../core/html.js').SafeHtml} */
export function composePerson(data) {
  const content = html`
    ${headRow(data)}
    ${countsLine(data.counts)}
    ${segmentedControl('byEvent', true)}
    <div class="c-hub__content">${activeView('byEvent', data.sections, {})}</div>
    <div class="c-hub__picker-container"></div>
  `;
  return pageShell.render({ active: 'home', compact: true, content });
}

/** @param {Element} container @param {Set<number>} selected @returns {void} */
function bindPickerChips(container, selected) {
  on(container, '.c-chips__chip', 'click', (_e, chip) => {
    const id = Number(chip.getAttribute('data-value'));
    const already = selected.has(id);
    if (already) selected.delete(id); else selected.add(id);
    chip.classList.toggle('c-chips__chip--on', !already);
    chip.setAttribute('aria-pressed', String(!already));
  });
}

/**
 * Opens the "with…" picker, fetching `/api/filters` only the first
 * time (guarded by `ctx.seq` against a stale response landing after the
 * dialog's already been closed and reopened, review-pattern shared with
 * `search.js`'s own filter sheet).
 * @param {Element} root @param {PersonView} data @param {Ctx} ctx
 * @returns {Promise<void>}
 */
async function openPicker(root, data, ctx) {
  const container = root.querySelector('.c-hub__picker-container');
  if (!container) return;
  const mySeq = ++ctx.seq;
  if (!ctx.options) {
    try {
      ctx.options = await getJson('/api/filters');
    } catch {
      return;
    }
    if (mySeq !== ctx.seq) return;
  }
  const options = ctx.options;
  if (!options) return;
  mount(container, pickerMarkup(data.person.id, options.people));
  chips.bind(container);
  const selected = /** @type {Set<number>} */ (new Set());
  bindPickerChips(container, selected);
  on(container, '.c-hub__picker-close', 'click', () => { /** @type {any} */ (container.querySelector('dialog'))?.close?.(); });
  on(container, '.c-hub__picker-apply', 'click', () => {
    const people = [data.person.id, ...selected];
    window.location.href = `/search?${toQuery({ ...EMPTY_STATE, people, peopleMode: 'all' }).toString()}`;
  });
  /** @type {any} */ (container.querySelector('dialog'))?.showModal?.();
}

/** @param {Element} root @param {Element} segEl @param {PersonView} data @param {Ctx} ctx @returns {void} */
function bindSegment(root, segEl, data, ctx) {
  on(segEl, '.c-chips__chip', 'click', (_e, chip) => {
    const value = chip.getAttribute('data-value');
    if (value === 'with') { openPicker(root, data, ctx); return; }
    if (value !== 'byEvent' && value !== 'all') return;
    ctx.seg = value;
    for (const c of segEl.querySelectorAll('.c-chips__chip')) {
      const isOn = c.getAttribute('data-value') === value;
      c.classList.toggle('c-chips__chip--on', isOn);
      c.setAttribute('aria-pressed', String(isOn));
    }
    const contentEl = root.querySelector('.c-hub__content');
    if (contentEl) { mount(contentEl, activeView(ctx.seg, data.sections, {})); bindSections(contentEl, data.sections); }
  });
}

/** @param {Element} root @param {PersonView} data @returns {void} */
export function bind(root, data) {
  headerLinks.bind(root);
  chips.bind(root);
  bindSections(root, data.sections);
  const segEl = root.querySelector('.c-hub__seg');
  /** @type {Ctx} */
  const ctx = { seg: 'byEvent', options: null, seq: 0 };
  if (segEl) bindSegment(root, segEl, data, ctx);
}

/** @param {Element} root @returns {void} */
function mountNotFound(root) {
  mount(root, pageShell.render({ active: 'home', compact: true, content: emptyState.render({ message: t('person.notFound') }) }));
}

/** @returns {Promise<void>} */
export async function start() {
  const root = document.getElementById(APP_SELECTOR);
  const ig = root && igFromPersonPath(window.location.pathname);
  if (!root || !ig) return;
  /** @type {PersonView} */
  let data;
  try {
    data = await getJson(`/api/person/${encodeURIComponent(ig)}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      mountNotFound(root);
      return;
    }
    throw err;
  }
  if (data.redirectTo && data.redirectTo !== ig) {
    window.location.replace(personHref(data.redirectTo));
    return;
  }
  document.title = `${data.person.name} · ${site.name}`;
  mount(root, composePerson(data));
  bind(root, data);
}

if (typeof document !== 'undefined') start();
