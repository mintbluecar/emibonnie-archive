// @ts-check
/**
 * The person page (task-6-brief.md "Person page"): a `personHeader` in
 * the person's own colour, the "in N translations · M events · K shared
 * stories" line (plural-aware, review round 1, M1), a search icon scoped
 * to this person, the segmented control (by event / all, newest /
 * with…), and the grouped/paged entries themselves (`hubGroups.js`).
 * "with…" opens a people picker (fetched from `/api/filters`, the same
 * roster the search page's own filter sheet uses) and sends the chosen
 * people, plus this page's own person, to a scoped search
 * (`peopleMode=all`) -- built through `state/searchState.js`'s
 * `toQuery`, never by hand. Every delegated listener (segmented control,
 * "more", the picker) is bound once in `bind()`, never re-bound on a
 * re-render (review round 1, I2).
 */
import { html } from '../core/html.js';
import { mount, mountPage, on } from '../core/dom.js';
import { getJson, ApiError } from '../core/api.js';
import { site, t, tCount } from '../core/site.js';
import * as chips from '../components/chips.js';
import * as personHeader from '../components/personHeader.js';
import * as emptyState from '../components/emptyState.js';
import * as pageShell from '../components/pageShell.js';
import * as headerLinks from '../components/headerLinks.js';
import { EMPTY_STATE, toQuery } from '../state/searchState.js';
import { igFromPersonPath, personHref } from '../core/routes.js';
import { activeView, bindMore, bindSections, segmentedControl } from './hubGroups.js';
import { mountLoadError } from './pageError.js';

const APP_SELECTOR = 'app';
/** @typedef {import('../../../src/http/contracts.js').PersonView} PersonView */
/** @typedef {import('../../../src/http/contracts.js').FilterOptions} FilterOptions */
/** @typedef {import('./hubGroups.js').HubCtx & { options: FilterOptions|null, selected: Set<number> }} Ctx */

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
const countsLine = (counts) => html`<p class="c-hub__counts">${t('person.countsLine', {
  translations: tCount('person.translations', counts.items), events: tCount('person.events', counts.events), shared: tCount('person.sharedStories', counts.sharedStories),
})}</p>`;

/** @param {number} selfId @param {import('../../../src/http/contracts.js').PersonChip[]} people @returns {import('../core/html.js').SafeHtml} */
function pickerMarkup(selfId, people) {
  const items = people.filter((p) => p.id !== selfId).map((p) => ({ label: `${p.emoji} ${p.name}`, colour: p.colour, value: p.id }));
  return html`
    <button type="button" class="c-hub__picker-close" aria-label="${t('person.closePicker')}">✕</button>
    <h2 class="c-hub__picker-title">${t('person.withTitle')}</h2>
    ${chips.render({ items })}
    <button type="button" class="c-hub__picker-apply">${t('person.withApply')}</button>
  `;
}

/** The picker's error body (review round 1, M3): `/api/filters` failed, but the dialog still opens, with a way to close it. @returns {import('../core/html.js').SafeHtml} */
function pickerErrorMarkup() {
  return html`
    <button type="button" class="c-hub__picker-close" aria-label="${t('person.closePicker')}">✕</button>
    <h2 class="c-hub__picker-title">${t('person.withTitle')}</h2>
    <p class="c-hub__picker-error">${t('search.error')}</p>
  `;
}

/** @param {PersonView} data @returns {import('../core/html.js').SafeHtml} */
export function composePerson(data) {
  const content = html`
    ${headRow(data)}
    ${countsLine(data.counts)}
    ${segmentedControl('byEvent', true)}
    <div class="c-hub__content">${activeView('byEvent', data.sections, {})}</div>
    <dialog class="c-hub__picker" aria-label="${t('person.withTitle')}"></dialog>
  `;
  return pageShell.render({ active: 'home', compact: true, content });
}

/**
 * Opens the "with…" picker, fetching `/api/filters` only the first time
 * (cached on `ctx.options`), guarded by `ctx.seq` against a stale
 * response landing after the dialog's already been closed and reopened
 * (review-pattern shared with `search.js`'s own filter sheet). Every
 * click handler for the dialog's own contents is bound once, in
 * `bindPicker()` below -- this only ever (re)mounts its *content*.
 * @param {Element} dialog @param {PersonView} data @param {Ctx} ctx
 * @returns {Promise<void>}
 */
async function openPicker(dialog, data, ctx) {
  const mySeq = ++ctx.seq;
  if (!ctx.options) {
    try {
      ctx.options = await getJson('/api/filters');
    } catch {
      if (mySeq !== ctx.seq) return;
      mount(dialog, pickerErrorMarkup());
      /** @type {any} */ (dialog).showModal?.();
      return;
    }
    if (mySeq !== ctx.seq) return;
  }
  const options = ctx.options;
  if (!options) return;
  ctx.selected = new Set();
  mount(dialog, pickerMarkup(data.person.id, options.people));
  chips.bind(dialog);
  /** @type {any} */ (dialog).showModal?.();
}

/**
 * Binds the picker dialog's own controls exactly once (review round 1,
 * I2: `openPicker` used to re-bind three listeners every time it ran).
 * `ctx.selected` is reset by `openPicker` on every open, so a chip
 * toggled in a previous session never leaks into the next.
 * @param {Element} dialog @param {PersonView} data @param {Ctx} ctx
 * @returns {void}
 */
function bindPicker(dialog, data, ctx) {
  on(dialog, '.c-chips__chip', 'click', (_e, chip) => {
    const id = Number(chip.getAttribute('data-value'));
    const already = ctx.selected.has(id);
    if (already) ctx.selected.delete(id); else ctx.selected.add(id);
    chip.classList.toggle('c-chips__chip--on', !already);
    chip.setAttribute('aria-pressed', String(!already));
  });
  on(dialog, '.c-hub__picker-close', 'click', () => { /** @type {any} */ (dialog).close?.(); });
  on(dialog, '.c-hub__picker-apply', 'click', () => {
    const people = [data.person.id, ...ctx.selected];
    window.location.href = `/search?${toQuery({ ...EMPTY_STATE, people, peopleMode: 'all' }).toString()}`;
  });
}

/** @param {Element} root @param {Element} dialog @param {PersonView} data @param {Ctx} ctx @returns {void} */
function bindSegment(root, dialog, data, ctx) {
  const segEl = root.querySelector('.c-hub__seg');
  if (!segEl) return;
  const contentEl = root.querySelector('.c-hub__content');
  on(segEl, '.c-chips__chip', 'click', (_e, chip) => {
    const value = chip.getAttribute('data-value');
    if (value === 'with') { openPicker(dialog, data, ctx); return; }
    if (value !== 'byEvent' && value !== 'all') return;
    ctx.seg = value;
    for (const c of segEl.querySelectorAll('.c-chips__chip')) {
      const isOn = c.getAttribute('data-value') === value;
      c.classList.toggle('c-chips__chip--on', isOn);
      c.setAttribute('aria-pressed', String(isOn));
    }
    if (contentEl) { mount(contentEl, activeView(ctx.seg, data.sections, {})); bindSections(contentEl, data.sections); }
  });
}

/** @param {Element} root @param {PersonView} data @param {string} ig @returns {void} */
export function bind(root, data, ig) {
  headerLinks.bind(root);
  chips.bind(root);
  bindSections(root, data.sections);
  const dialog = root.querySelector('.c-hub__picker');
  /** @type {Ctx} */
  const ctx = { seg: 'byEvent', options: null, seq: 0, offset: {}, selected: new Set() };
  if (dialog) {
    bindSegment(root, dialog, data, ctx);
    bindPicker(dialog, data, ctx);
  }
  bindMore(root, `/api/person/${encodeURIComponent(ig)}`, data, ctx);
}

/** @param {Element} root @returns {void} */
function mountNotFound(root) {
  mountPage(root, pageShell.render({ active: 'home', compact: true, content: emptyState.render({ message: t('person.notFound') }) }));
}

/** @returns {Promise<void>} */
export async function start() {
  const root = document.getElementById(APP_SELECTOR);
  const ig = root && igFromPersonPath(window.location.pathname);
  if (!root || !ig) return;
  // A synchronous default, so the page never has an empty <title> while the
  // person fetch below is in flight (axe's document-title rule; same pattern
  // as home.js/item.js) -- overwritten with the person's own name once it loads.
  document.title = site.name;
  /** @type {PersonView} */
  let data;
  try {
    data = await getJson(`/api/person/${encodeURIComponent(ig)}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      mountNotFound(root);
      return;
    }
    mountLoadError(root, { active: 'home' });
    return;
  }
  if (data.redirectTo && data.redirectTo !== ig) {
    window.location.replace(personHref(data.redirectTo));
    return;
  }
  document.title = `${data.person.name} · ${site.name}`;
  mountPage(root, composePerson(data));
  bind(root, data, ig);
}

if (typeof document !== 'undefined') start();
