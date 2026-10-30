// @ts-check
/**
 * The event page (spec: "Event page"). `composeEvent` is pure (exported
 * for DOM-free tests on an `EventView` snapshot: src/http/contracts.js);
 * `bind()`/`start()` are the only parts that touch the DOM or the
 * network. People/translator filtering is client-side, over the
 * `data-person-ids`/`data-account` attributes `previewCard` already
 * carries on every entry, so this page never needs to know which kind
 * rendered them.
 *
 * "Newest first" is **not** a CSS flip: that would desync reading/focus
 * order from what's shown (an accessibility bug) and fight pagination
 * once "more" has appended further items. Instead the toggle re-fetches
 * `/api/event/:slug?order=desc` (offset reset) and re-renders every
 * section; "more" always continues in whichever order is currently
 * active (Task 3 review #1).
 *
 * Task 10d: the page searches within itself (`components/inlineSearch.js`),
 * with the event preset as a removable chip; the results replace the
 * entries (and their own people/translator/order controls) in place.
 */
import { html } from '../core/html.js';
import { mount, mountPage, on } from '../core/dom.js';
import { getJson, ApiError } from '../core/api.js';
import { site, t, tCount } from '../core/site.js';
import { dayLabel } from '../core/format.js';
import * as chips from '../components/chips.js';
import * as eventTags from '../components/eventTags.js';
import * as reportForm from '../components/reportForm.js';
import * as emptyState from '../components/emptyState.js';
import * as pageShell from '../components/pageShell.js';
import * as inlineSearch from '../components/inlineSearch.js';
import { filtersSlot, headerProps, region } from '../components/inlineSearchView.js';
import { slugFromEventPath, HOME_PATH } from '../core/routes.js';
import { KIND_UI, renderSections } from '../kinds/_registry.js';

/** Entries are compact previews, as on the person and translator pages (spec: "Entries show their opening lines ... as its preview"; mockups/screens-v2.html's event screen; fix round 1, I2). */
const SECTION_CTX = { compact: true };
import { mountLoadError } from './pageError.js';

const APP_SELECTOR = 'app';
/** @typedef {{ order: 'asc'|'desc' }} EventPageState */

/** @param {string} slug @returns {import('../core/html.js').SafeHtml} */
const backLink = (slug) => html`<a class="meta c-event__back" href="${HOME_PATH}" data-slug="${slug}">${t('event.back')}</a>`;

/**
 * @param {import('../../../src/http/contracts.js').EventView['event']} event
 * @returns {import('../core/html.js').SafeHtml}
 */
function headRow(event) {
  return html`
    <div class="c-event__head">
      <h1 class="heading heading--md">${event.name}</h1>
    </div>
  `;
}

/**
 * `dayLabel · N translations · M translators`, built from the real
 * counts (never capped by a section's page) plus copy, per Task 3's
 * ruling 3.
 * @param {import('../../../src/http/contracts.js').EventView} data
 * @returns {import('../core/html.js').SafeHtml}
 */
function metaLine(data) {
  const total = Object.values(data.counts).reduce((sum, n) => sum + n, 0);
  return html`
    <p class="meta c-event__meta">
      ${dayLabel(data.event.occurredOn)} · ${tCount('event.translations', total)} · ${tCount('event.translators', data.accountCount)}
    </p>
  `;
}

/**
 * Hashtag/type/client pills (ruling 3: "type/client pills from EventView").
 * @param {import('../../../src/http/contracts.js').EventView['event']} event
 * @returns {import('../core/html.js').SafeHtml}
 */
function pillsRow(event) {
  const items = [
    ...(event.type ? [{ label: event.type }] : []),
    ...(event.client ? [{ label: event.client }] : []),
  ];
  return items.length > 0 ? html`<div class="c-event__pills">${chips.render({ items })}</div>` : html``;
}

/**
 * @param {import('../../../src/http/contracts.js').Section} section
 * @returns {import('../core/html.js').SafeHtml}
 */
function sectionBlock(section) {
  const [rendered] = renderSections([section], SECTION_CTX);
  if (!rendered) return html``;
  return html`
    <div class="stack stack--2" data-event-section data-kind="${section.kind}" data-offset="${section.items.length}">
      ${rendered}
      ${section.hasMore ? html`<button type="button" class="btn btn--quiet btn--block" data-action="more" data-kind="${section.kind}">${t('event.more')}</button>` : ''}
    </div>
  `;
}

/**
 * This event's in-place search (Task 10d), from the page URL's query.
 * @param {import('../../../src/http/contracts.js').EventView['event']} event @param {string} [query]
 * @returns {import('../components/inlineSearchView.js').Ctx}
 */
export function eventSearch(event, query = '') {
  const scope = /** @type {const} */ ({ field: 'event', value: event.slug, label: event.name });
  return inlineSearch.prepare({ search: query, scope, placeholder: t('search.placeholderEvent') });
}

/**
 * @param {import('../../../src/http/contracts.js').EventView} data
 * @param {import('../components/inlineSearchView.js').Ctx} [search]
 * @returns {import('../core/html.js').SafeHtml}
 */
export function composeEvent(data, search = eventSearch(data.event)) {
  const list = html`
    <button type="button" class="btn btn--secondary c-event__newest-toggle" aria-pressed="false" data-action="newest-first">${t('event.newestFirst')}</button>
    <div class="stack" data-event-sections>${data.sections.map(sectionBlock)}</div>
  `;
  const content = html`
    ${filtersSlot(search)}
    ${backLink(data.event.slug)}
    ${headRow(data.event)}
    ${metaLine(data)}
    ${eventTags.render(data.event)}
    ${pillsRow(data.event)}
    ${region(search, list)}
    <button class="btn btn--quiet" type="button" data-action="report">${t('event.report')}</button>
    ${reportForm.render()}
  `;
  return pageShell.render({ active: 'home', compact: true, headerProps: headerProps(search), content });
}

/**
 * Replaces `[data-event-sections]`' content with freshly fetched `sections`,
 * and re-binds every kind's UI there -- the newest-first toggle's whole
 * job (never a CSS flip).
 * @param {Element} container @param {import('../../../src/http/contracts.js').Section[]} sections
 * @returns {void}
 */
function renderAndBindSections(container, sections) {
  mount(container, html`${sections.map(sectionBlock)}`);
  for (const section of sections) KIND_UI[section.kind]?.section.bind?.(container);
}

/**
 * Moves `section`'s freshly-rendered entries into the already-live kind
 * section element, then re-binds it (colours, delegated listeners) --
 * idempotent, so re-running it over the old entries too is harmless.
 * @param {Element} container @param {string} kind
 * @param {{ render: Function, bind?: Function }} sectionUi
 * @param {import('../../../src/http/contracts.js').Section} section
 * @returns {void}
 */
function appendMoreItems(container, kind, sectionUi, section) {
  const scratch = document.createElement('div');
  mount(scratch, sectionUi.render(section, SECTION_CTX));
  const liveList = container.querySelector(`[data-kind="${kind}"]`);
  const newList = scratch.querySelector(`[data-kind="${kind}"]`);
  while (liveList && newList && newList.firstChild) liveList.appendChild(newList.firstChild);
  sectionUi.bind?.(container);
}

/**
 * Fetches the next page for one kind section, in the currently active
 * order, and appends its entries into the already-rendered section
 * (ruling 3: "the API's limit/offset/hasMore ... appends"). Never
 * re-renders what's already on the page; re-applies the standing filter
 * to the whole section afterward (review #4).
 * @param {Element} root @param {string} slug @param {EventPageState} state @param {HTMLButtonElement} button
 * @returns {Promise<void>}
 */
async function loadMore(root, slug, state, button) {
  const container = button.closest('[data-event-section]');
  const kind = button.getAttribute('data-kind');
  const kindUi = kind && KIND_UI[kind];
  if (!container || !kindUi) return;
  const offset = Number(container.getAttribute('data-offset') ?? '0');
  button.disabled = true;
  const page = await getJson(`/api/event/${encodeURIComponent(slug)}`, { offset, order: state.order });
  const section = page.sections.find((/** @type {any} */ s) => s.kind === kind);
  if (!section) return;
  appendMoreItems(container, /** @type {string} */ (kind), kindUi.section, section);
  container.setAttribute('data-offset', String(offset + section.items.length));
  button.disabled = !section.hasMore;
  if (!section.hasMore) button.remove();
}

/**
 * Re-fetches the whole event at the flipped order and re-renders every
 * section (review #1: real re-ordering, not a CSS flip).
 * @param {Element} root @param {string} slug @param {EventPageState} state @param {HTMLButtonElement} toggle
 * @returns {Promise<void>}
 */
async function toggleOrder(root, slug, state, toggle) {
  const pressed = toggle.getAttribute('aria-pressed') === 'true';
  state.order = pressed ? 'asc' : 'desc';
  toggle.disabled = true;
  const page = await getJson(`/api/event/${encodeURIComponent(slug)}`, { order: state.order });
  const container = root.querySelector('[data-event-sections]');
  if (container) renderAndBindSections(container, page.sections);
  toggle.setAttribute('aria-pressed', String(!pressed));
  toggle.disabled = false;
}

/**
 * Wires the newest-first
 * toggle, and each section's "more" button. Exported so tests can drive
 * it directly against a real (if minimal) DOM, the same `render`/`bind`
 * pair every component exports.
 * @param {Element} root @param {import('../../../src/http/contracts.js').EventView} data @param {string} slug
 * @returns {void}
 */
export function bind(root, data, slug) {
  chips.bind(root);
  reportForm.bind(root, { type: 'event', slug });
  for (const section of data.sections) KIND_UI[section.kind]?.section.bind?.(root);
  const sectionsEl = root.querySelector('[data-event-sections]');
  /** @type {EventPageState} */
  const state = { order: 'asc' };

  on(root, '[data-action="newest-first"]', 'click', (_e, target) => { toggleOrder(root, slug, state, target); });
  if (sectionsEl) on(sectionsEl, '[data-action="more"]', 'click', (_e, target) => { loadMore(root, slug, state, target); });
}

/** @param {Element} root @returns {void} */
function mountNotFound(root) {
  mountPage(root, pageShell.render({ active: 'home', compact: true, content: emptyState.render({ message: t('event.notFound') }) }));
}

/** @returns {Promise<void>} */
export async function start() {
  const root = document.getElementById(APP_SELECTOR);
  const slug = root && slugFromEventPath(window.location.pathname);
  if (!root || !slug) return;
  // A synchronous default, so the page never has an empty <title> while the
  // event fetch below is in flight (axe's document-title rule; same pattern
  // as home.js/item.js) -- overwritten with the event's own name once it loads.
  document.title = site.name;
  /** @type {import('../../../src/http/contracts.js').EventView} */
  let data;
  try {
    data = await getJson(`/api/event/${encodeURIComponent(slug)}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      mountNotFound(root);
      return;
    }
    mountLoadError(root, { active: 'home' });
    return;
  }
  document.title = `${data.event.name} · ${site.name}`;
  const search = eventSearch(data.event, window.location.search);
  mountPage(root, composeEvent(data, search));
  bind(root, data, slug);
  inlineSearch.bind(root, search);
}

if (typeof document !== 'undefined') start();
