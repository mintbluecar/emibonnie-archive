// @ts-check
/**
 * The event page (spec: "Event page"). `composeEvent` is pure (exported
 * for DOM-free tests on an `EventView` snapshot: src/http/contracts.js);
 * `start()`/the bind helpers below are the only parts that touch the DOM
 * or the network. People/translator filtering is client-side, over the
 * `data-person-ids`/`data-account` attributes `previewCard` already
 * carries on every entry, so this page never needs to know which kind
 * rendered them.
 */
import { html } from '../core/html.js';
import { mount, on } from '../core/dom.js';
import { getJson, ApiError } from '../core/api.js';
import { site, t } from '../core/site.js';
import { dayLabel } from '../core/format.js';
import * as footer from '../components/footer.js';
import * as tabBar from '../components/tabBar.js';
import * as chips from '../components/chips.js';
import * as emptyState from '../components/emptyState.js';
import { KIND_UI, renderSections } from '../kinds/_registry.js';

const APP_SELECTOR = 'app';
const ALL = 'all';

/** @param {string} slug @returns {import('../core/html.js').SafeHtml} */
const backLink = (slug) => html`<a class="c-event__back" href="/" data-slug="${slug}">${t('event.back')}</a>`;

/**
 * @param {import('../../../src/http/contracts.js').EventView['event']} event
 * @returns {import('../core/html.js').SafeHtml}
 */
function headRow(event) {
  return html`
    <div class="c-event__head">
      <h1 class="c-event__name">${event.name}</h1>
      <a class="c-event__search" href="/search/?event=${event.slug}" aria-label="${t('event.search')}">
        <span aria-hidden="true">🔍</span>
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
      ${dayLabel(data.event.occurredOn)} · ${total} ${t('event.translations')} · ${data.accountCount} ${t('event.translators')}
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
    ...people.map((person) => ({ label: `${person.emoji} ${person.name}`, colour: person.colour, value: String(person.id) })),
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
  const [rendered] = renderSections([section], {});
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
  return html`
    ${tabBar.render({ active: 'home' })}
    <main class="container">
      ${backLink(data.event.slug)}
      ${headRow(data.event)}
      ${metaLine(data)}
      ${pillsRow(data.event)}
      ${peopleFilterRow(data.people)}
      ${accountFilterRow(uniqueAccounts(data.sections))}
      <button type="button" class="c-event__newest-toggle" aria-pressed="false">${t('event.newestFirst')}</button>
      <div class="c-event-sections">${data.sections.map(sectionBlock)}</div>
      <a class="c-event__report" href="/soon">${t('event.report')}</a>
    </main>
    ${footer.render()}
  `;
}

/**
 * Shows/hides every entry per the current person/account filter, over
 * the generic `data-person-ids`/`data-account` attributes.
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
  mount(scratch, sectionUi.render(section));
  const liveList = container.querySelector(`[data-kind="${kind}"]`);
  const newList = scratch.querySelector(`[data-kind="${kind}"]`);
  while (liveList && newList && newList.firstChild) liveList.appendChild(newList.firstChild);
  sectionUi.bind?.(container);
}

/**
 * Fetches the next page for one kind section and appends its entries
 * into the already-rendered section (ruling 3: "the API's limit/offset/
 * hasMore ... appends"). Never re-renders what's already on the page.
 * @param {string} slug @param {HTMLButtonElement} button
 * @returns {Promise<void>}
 */
async function loadMore(slug, button) {
  const container = button.closest('.c-event-section');
  const kind = button.getAttribute('data-kind');
  const kindUi = kind && KIND_UI[kind];
  if (!container || !kindUi) return;
  const offset = Number(container.getAttribute('data-offset') ?? '0');
  button.disabled = true;
  const page = await getJson(`/api/event/${encodeURIComponent(slug)}`, { offset });
  const section = page.sections.find((/** @type {any} */ s) => s.kind === kind);
  if (!section) return;
  appendMoreItems(container, /** @type {string} */ (kind), kindUi.section, section);
  container.setAttribute('data-offset', String(offset + section.items.length));
  button.disabled = !section.hasMore;
  if (!section.hasMore) button.remove();
}

/**
 * @param {Element} root @param {import('../../../src/http/contracts.js').EventView} data @param {string} slug
 * @returns {void}
 */
function bindEvent(root, data, slug) {
  chips.bind(root);
  for (const section of data.sections) KIND_UI[section.kind]?.section.bind?.(root);
  let personValue = ALL;
  let accountValue = ALL;

  on(root, '.c-event__people-filter .c-chips__chip', 'click', (_e, target) => {
    const value = target.getAttribute('data-value') ?? ALL;
    personValue = value === personValue ? ALL : value;
    for (const chip of root.querySelectorAll('.c-event__people-filter .c-chips__chip')) {
      chip.classList.toggle('c-chips__chip--on', chip.getAttribute('data-value') === personValue);
    }
    applyFilters(root, personValue, accountValue);
  });
  on(root, '.c-event__account-filter', 'change', (_e, target) => {
    accountValue = /** @type {HTMLSelectElement} */ (target).value;
    applyFilters(root, personValue, accountValue);
  });
  on(root, '.c-event__newest-toggle', 'click', (_e, target) => {
    const pressed = target.getAttribute('aria-pressed') === 'true';
    target.setAttribute('aria-pressed', String(!pressed));
    root.querySelector('.c-event-sections')?.classList.toggle('is-newest-first', !pressed);
  });
  on(root, '.c-event-section__more', 'click', (_e, target) => { loadMore(slug, target); });
}

/** @param {string} path @returns {string|null} */
function slugFromPath(path) {
  const match = /^\/e\/([^/]+)/.exec(path);
  return match ? decodeURIComponent(match[1]) : null;
}

/** @param {Element} root @returns {void} */
function mountNotFound(root) {
  mount(root, html`
    ${tabBar.render({ active: 'home' })}
    <main class="container">${emptyState.render({ message: t('event.notFound') })}</main>
    ${footer.render()}
  `);
}

/** @returns {Promise<void>} */
export async function start() {
  const root = document.getElementById(APP_SELECTOR);
  const slug = root && slugFromPath(window.location.pathname);
  if (!root || !slug) return;
  /** @type {import('../../../src/http/contracts.js').EventView} */
  let data;
  try {
    data = await getJson(`/api/event/${encodeURIComponent(slug)}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      mountNotFound(root);
      return;
    }
    throw err;
  }
  document.title = `${data.event.name} · ${site.name}`;
  mount(root, composeEvent(data));
  bindEvent(root, data, slug);
}

if (typeof document !== 'undefined') start();
