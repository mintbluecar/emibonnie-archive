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
 */
import { html } from '../core/html.js';
import { mount, mountPage, on } from '../core/dom.js';
import { getJson, ApiError } from '../core/api.js';
import { site, t, tCount } from '../core/site.js';
import { dayLabel } from '../core/format.js';
import * as chips from '../components/chips.js';
import * as emptyState from '../components/emptyState.js';
import * as pageShell from '../components/pageShell.js';
import * as headerLinks from '../components/headerLinks.js';
import { slugFromEventPath, HOME_PATH, TAKEDOWN_PATH, searchHref } from '../core/routes.js';
import { KIND_UI, renderSections } from '../kinds/_registry.js';

/** Entries are compact previews, as on the person and translator pages (spec: "Entries show their opening lines ... as its preview"; mockups/screens-v2.html's event screen; fix round 1, I2). */
const SECTION_CTX = { compact: true };
import { mountLoadError } from './pageError.js';

const APP_SELECTOR = 'app';
const ALL = 'all';
/** @typedef {{ order: 'asc'|'desc', person: string, account: string }} EventPageState */

/** @param {string} slug @returns {import('../core/html.js').SafeHtml} */
const backLink = (slug) => html`<a class="c-event__back" href="${HOME_PATH}" data-slug="${slug}">${t('event.back')}</a>`;

/**
 * @param {import('../../../src/http/contracts.js').EventView['event']} event
 * @returns {import('../core/html.js').SafeHtml}
 */
function headRow(event) {
  return html`
    <div class="c-event__head">
      <h1 class="c-event__name">${event.name}</h1>
      <a class="c-event__search" href="${searchHref(new URLSearchParams({ event: event.slug }))}" aria-label="${t('event.search')}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7"></circle>
          <path d="M21 21l-4.3-4.3"></path>
        </svg>
      </a>
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
    <p class="c-event__meta">
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
    ...event.hashtags.map((hashtag) => ({ label: `#${hashtag}` })),
    ...(event.type ? [{ label: event.type }] : []),
    ...(event.client ? [{ label: event.client }] : []),
  ];
  return items.length > 0 ? chips.render({ items }) : html``;
}

/**
 * @param {import('../../../src/http/contracts.js').PersonChip[]} people
 * @returns {import('../core/html.js').SafeHtml}
 */
function peopleFilterRow(people) {
  const items = [
    { label: t('event.allPeople'), active: true, value: ALL },
    ...people.map((person) => ({ emoji: person.emoji, label: person.name, colour: person.colour, value: String(person.id) })),
  ];
  return html`<div class="c-event__people-filter">${chips.render({ items })}</div>`;
}

/** @param {string[]} accounts @returns {import('../core/html.js').SafeHtml} */
function accountFilterRow(accounts) {
  if (accounts.length === 0) return html``;
  return html`
    <select class="c-event__account-filter" aria-label="${t('event.translatorFilterLabel')}">
      <option value="${ALL}">${t('event.translatorAll')}</option>
      ${accounts.map((handle) => html`<option value="${handle}">@${handle}</option>`)}
    </select>
  `;
}

/**
 * @param {import('../../../src/http/contracts.js').Section} section
 * @returns {import('../core/html.js').SafeHtml}
 */
function sectionBlock(section) {
  const [rendered] = renderSections([section], SECTION_CTX);
  if (!rendered) return html``;
  return html`
    <div class="c-event-section" data-kind="${section.kind}" data-offset="${section.items.length}">
      ${rendered}
      ${section.hasMore ? html`<button type="button" class="c-event-section__more" data-kind="${section.kind}">${t('event.more')}</button>` : ''}
    </div>
  `;
}

/**
 * Every account handle on any loaded entry, computed client-side (ruling:
 * EventView carries no account list, only `accountCount`).
 * @param {import('../../../src/http/contracts.js').Section[]} sections
 * @returns {string[]}
 */
function uniqueAccounts(sections) {
  const handles = sections.flatMap((section) => section.items.map((item) => item.accountHandle)).filter((h) => h !== null);
  return [...new Set(handles)].sort();
}

/**
 * @param {import('../../../src/http/contracts.js').EventView} data
 * @returns {import('../core/html.js').SafeHtml}
 */
export function composeEvent(data) {
  const content = html`
    ${backLink(data.event.slug)}
    ${headRow(data.event)}
    ${metaLine(data)}
    ${pillsRow(data.event)}
    ${peopleFilterRow(data.people)}
    ${accountFilterRow(uniqueAccounts(data.sections))}
    <button type="button" class="c-event__newest-toggle" aria-pressed="false">${t('event.newestFirst')}</button>
    <div class="c-event-sections">${data.sections.map(sectionBlock)}</div>
    <a class="c-event__report" href="${TAKEDOWN_PATH}">${t('event.report')}</a>
  `;
  return pageShell.render({ active: 'home', compact: true, content });
}

/**
 * Shows/hides every entry per the current person/account filter, over
 * the generic `data-person-ids`/`data-account` attributes. Called after
 * every filter change, and after "more" appends further entries, so a
 * standing filter never misses newly-loaded ones (Task 3 review #4).
 * @param {Element} root @param {string} personValue @param {string} accountValue
 * @returns {void}
 */
function applyFilters(root, personValue, accountValue) {
  for (const card of root.querySelectorAll('.c-preview-card')) {
    const ids = (card.getAttribute('data-person-ids') ?? '').split(',').filter(Boolean);
    const account = card.getAttribute('data-account') ?? '';
    const personOk = personValue === ALL || ids.includes(personValue);
    const accountOk = accountValue === ALL || account === accountValue;
    /** @type {HTMLElement} */ (card).hidden = !(personOk && accountOk);
  }
}

/**
 * Replaces `.c-event-sections`' content with freshly fetched `sections`,
 * re-binds every kind's UI there, then re-applies the current filters --
 * the newest-first toggle's whole job (never a CSS flip).
 * @param {Element} root @param {Element} container @param {import('../../../src/http/contracts.js').Section[]} sections @param {EventPageState} state
 * @returns {void}
 */
function renderAndBindSections(root, container, sections, state) {
  mount(container, html`${sections.map(sectionBlock)}`);
  for (const section of sections) KIND_UI[section.kind]?.section.bind?.(container);
  applyFilters(root, state.person, state.account);
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
  const container = button.closest('.c-event-section');
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
  applyFilters(root, state.person, state.account);
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
  const container = root.querySelector('.c-event-sections');
  if (container) renderAndBindSections(root, container, page.sections, state);
  toggle.setAttribute('aria-pressed', String(!pressed));
  toggle.disabled = false;
}

/**
 * Wires the people-chip/translator-select filters, the newest-first
 * toggle, and each section's "more" button. Exported so tests can drive
 * it directly against a real (if minimal) DOM, the same `render`/`bind`
 * pair every component exports.
 * @param {Element} root @param {import('../../../src/http/contracts.js').EventView} data @param {string} slug
 * @returns {void}
 */
export function bind(root, data, slug) {
  headerLinks.bind(root);
  chips.bind(root);
  for (const section of data.sections) KIND_UI[section.kind]?.section.bind?.(root);
  const peopleFilterEl = root.querySelector('.c-event__people-filter');
  const sectionsEl = root.querySelector('.c-event-sections');
  /** @type {EventPageState} */
  const state = { order: 'asc', person: ALL, account: ALL };

  if (peopleFilterEl) {
    on(peopleFilterEl, '.c-chips__chip', 'click', (_e, target) => {
      const value = target.getAttribute('data-value') ?? ALL;
      state.person = value === state.person ? ALL : value;
      for (const chip of peopleFilterEl.querySelectorAll('.c-chips__chip')) {
        const isOn = chip.getAttribute('data-value') === state.person;
        chip.classList.toggle('c-chips__chip--on', isOn);
        chip.setAttribute('aria-pressed', String(isOn));
      }
      applyFilters(root, state.person, state.account);
    });
  }
  on(root, '.c-event__account-filter', 'change', (_e, target) => {
    state.account = /** @type {HTMLSelectElement} */ (target).value;
    applyFilters(root, state.person, state.account);
  });
  on(root, '.c-event__newest-toggle', 'click', (_e, target) => { toggleOrder(root, slug, state, target); });
  if (sectionsEl) on(sectionsEl, '.c-event-section__more', 'click', (_e, target) => { loadMore(root, slug, state, target); });
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
  mountPage(root, composeEvent(data));
  bind(root, data, slug);
}

if (typeof document !== 'undefined') start();
