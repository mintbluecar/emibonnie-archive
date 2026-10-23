// @ts-check
/**
 * `bind()`-level tests for the in-place search (Task 10d; ported from
 * the old search page's own tests, review round 1, M4): driven against
 * real rendered markup through `miniDom`, on a minimal page built from
 * the same pieces home and the scoped pages use (`filtersSlot`,
 * `region`, `headerProps`). These are about the DOM wiring: results
 * replacing the list in place, the URL, the page's own removable
 * filter, listener pile-up, stale responses and failures.
 */
import '../helpers/siteFixture.js';
import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { MiniElement, fakeDocument } from '../helpers/miniDom.js';
import { mount } from '../../public/js/core/dom.js';
import { html } from '../../public/js/core/html.js';
import { EMPTY_STATE } from '../../public/js/state/searchState.js';
// Dynamic import: see test/components/header.test.js for why.
const inlineSearch = await import('../../public/js/components/inlineSearch.js');
const { filtersSlot, region, headerProps, resultsBody } = await import('../../public/js/components/inlineSearchView.js');
const pageShell = await import('../../public/js/components/pageShell.js');

/** @type {import('../../src/http/contracts.js').FilterOptions} */
const OPTIONS = {
  people: [{ id: 1, name: 'sol', emoji: '☀️', colour: '#c47a12', igHandle: 'solsunny' }, { id: 2, name: 'luna', emoji: '🌙', colour: '#6a5cd6', igHandle: 'lunamoon' }],
  categories: [{ id: 5, name: 'live' }],
  events: [{ slug: 'starfest', name: 'starfest 2026' }],
  clients: [],
  accounts: [{ handle: 'tl_beta' }],
};

/** @type {import('../../src/http/contracts.js').SearchResult} */
const RESULT = {
  kind: 'translation', sourceId: '1', url: '/t/1', lines: [], people: [], accountHandle: null, hasVideo: false,
  followsOnFrom: null, occurredOn: '2026-10-18', placement: 'event', event: null, matchLines: ['hi'],
};

/** @type {import('../../public/js/state/searchScope.js').Scope} */
const EVENT_SCOPE = { field: 'event', value: 'starfest', label: 'starfest 2026' };

/** A few macrotask ticks, enough for mocked fetches' `.then()` chains to settle. */
const flush = async () => { for (let i = 0; i < 3; i++) await new Promise((resolve) => { setTimeout(resolve, 0); }); };

/** @param {unknown} body */
const ok = (body) => new Response(JSON.stringify(body), { status: 200 });

/**
 * A `fetch` stub: `/api/filters` answers OPTIONS; every `/api/search` call is recorded and answered by `search`.
 * @param {(url: string) => any} [search]
 */
function stubFetch(search = () => ({ count: 1, results: [RESULT] })) {
  /** @type {string[]} */
  const calls = [];
  mock.method(globalThis, 'fetch', async (/** @type {any} */ url) => {
    const u = String(url);
    if (u.startsWith('/api/filters')) return ok(OPTIONS);
    calls.push(u);
    const body = await search(u);
    return body instanceof Response ? body : ok(body);
  });
  return calls;
}

/**
 * Mounts a page (home by default) with its search prepared from `query`, stubs the
 * browser globals, and binds. Navigation is a failure: `location.href` throws if set.
 * @param {{ query?: string, scope?: any, path?: string }} [opts]
 */
async function mountedPage({ query = '', scope = null, path = '/' } = {}) {
  const ctx = inlineSearch.prepare({ search: query, scope, placeholder: 'search this event…' });
  const root = new MiniElement('div');
  const content = html`${filtersSlot(ctx)}${region(ctx, html`<p class="the-list">the list</p>`)}`;
  mount(root, pageShell.render({ headerProps: headerProps(ctx), content }));
  globalThis.document = /** @type {any} */ (fakeDocument());
  const location = { pathname: path, search: query ? `?${query}` : '' };
  Object.defineProperty(location, 'href', { get: () => path, set: (v) => { throw new Error(`navigated to ${v}`); } });
  globalThis.window = /** @type {any} */ ({ location });
  /** @type {string[]} */
  const urls = [];
  globalThis.history = /** @type {any} */ ({ replaceState: (/** @type {any} */ _s, /** @type {any} */ _t, /** @type {string} */ url) => { urls.push(url); } });
  await inlineSearch.bind(root, ctx);
  return { root, ctx, urls };
}

function cleanup() {
  delete (/** @type {any} */ (globalThis)).document;
  delete (/** @type {any} */ (globalThis)).window;
  delete (/** @type {any} */ (globalThis)).history;
  mock.restoreAll();
  mock.timers.reset();
}

/** @param {any} root */
const listShown = (root) => !root.querySelector('.c-search__list').hidden && root.querySelector('.c-search').hidden;

/**
 * Types into the box and fires the debounce (mocked timers, so this is instant), then lets the fetch settle.
 * @param {any} root @param {string} q
 */
async function typeAndSettle(root, q) {
  const box = root.querySelector('.c-header__search-box');
  box.value = q;
  box.dispatchEvent({ type: 'input', target: box });
  mock.timers.tick(250);
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

test('home: typing shows results in place of the list, with no navigation; clearing the box brings the list back without a fetch', async () => {
  const calls = stubFetch();
  const { root, urls } = await mountedPage();
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    assert.ok(listShown(root), 'the list shows to begin with');
    assert.equal(calls.length, 0, 'no search for the list view');
    await typeAndSettle(root, 'hi');
    assert.equal(urls.at(-1), '/?q=hi', 'the URL is a shareable search on home');
    assert.ok(!listShown(root), 'results replace the list');
    assert.equal(root.querySelectorAll('.c-result-card').length, 1);
    assert.equal(calls.length, 1);
    await typeAndSettle(root, '');
    assert.equal(urls.at(-1), '/');
    assert.ok(listShown(root), 'the list is back');
    assert.equal(calls.length, 1, 'no fetch to show the list');
    await typeAndSettle(root, 'h');
    assert.equal(calls.length, 1, 'one character is not a search');
  } finally {
    cleanup();
  }
});

test('a URL with ?q= opens straight into its results', async () => {
  const calls = stubFetch();
  try {
    const { root } = await mountedPage({ query: 'q=hug&people=2' });
    assert.ok(!listShown(root));
    assert.match(calls[0], /q=hug/);
    assert.match(calls[0], /people=2/);
    assert.equal(root.querySelector('.c-header__search-box').value, 'hug');
    assert.ok(root.querySelector('.c-search__active-chip[data-field="people"]'), 'its filter shows as a chip');
  } finally {
    cleanup();
  }
});

test('no autofocus: binding never focuses the box', async () => {
  stubFetch();
  try {
    for (const query of ['', 'q=hug']) {
      const ctx = inlineSearch.prepare({ search: query });
      const root = new MiniElement('div');
      mount(root, pageShell.render({ headerProps: headerProps(ctx), content: html`${filtersSlot(ctx)}${region(ctx, html``)}` }));
      const box = /** @type {any} */ (root.querySelector('.c-header__search-box'));
      let focused = false;
      box.focus = () => { focused = true; };
      globalThis.document = /** @type {any} */ (fakeDocument());
      globalThis.window = /** @type {any} */ ({ location: { pathname: '/', search: query } });
      await inlineSearch.bind(root, ctx);
      assert.equal(focused, false, query || 'blank');
    }
  } finally {
    cleanup();
  }
});

test('scoped page: its own filter is a removable chip; removing it widens the search to the whole archive, still in place', async () => {
  const calls = stubFetch();
  try {
    const { root, urls } = await mountedPage({ query: 'q=hug', scope: EVENT_SCOPE, path: '/e/starfest' });
    assert.match(calls[0], /eventSlug=starfest/, 'searches within the event');
    const chip = /** @type {any} */ (root.querySelector('.c-search__active-chip[data-field="event"]'));
    assert.ok(chip, 'the event is a chip');
    assert.match(chip.getAttribute('aria-label'), /remove starfest 2026/);
    assert.ok(!root.querySelector('.c-search__clear-all'), 'nothing beyond the page filter to clear');
    assert.equal(root.querySelector('.c-header__search-box').getAttribute('placeholder'), 'search this event…');
    chip.click();
    await flush();
    assert.equal(urls.at(-1), '/e/starfest?q=hug&scope=all', 'on the page\'s own path, so a reload keeps it removed');
    assert.doesNotMatch(calls.at(-1), /eventSlug/, 'the whole archive');
    assert.ok(!listShown(root), 'still results, on this page');
    assert.equal(root.querySelector('.c-header__search-box').getAttribute('placeholder'), 'search what they said…', 'the placeholder says what is searched now');
    /** @type {any} */ (root.querySelector('.c-search__clear-all')).click();
    await flush();
    assert.equal(urls.at(-1), '/e/starfest?q=hug', '"clear all" brings the page filter back');
  } finally {
    cleanup();
  }
});

test('scoped page: the list shows with the page filter alone; an added filter shows results, with an empty box', async () => {
  const calls = stubFetch();
  try {
    const { root } = await mountedPage({ scope: EVENT_SCOPE, path: '/e/starfest' });
    assert.ok(listShown(root));
    assert.equal(calls.length, 0);
    assert.ok(root.querySelector('.c-search__active-chip[data-field="event"]'), 'the preset chip shows from the start');
    const { root: root2 } = await mountedPage({ query: 'types=live', scope: EVENT_SCOPE, path: '/e/starfest' });
    assert.ok(!listShown(root2));
    assert.match(calls.at(-1), /categories=5/);
    assert.match(calls.at(-1), /eventSlug=starfest/);
  } finally {
    cleanup();
  }
});

test('removing a type chip refetches without it and updates the URL', async () => {
  stubFetch();
  try {
    const { root, urls } = await mountedPage({ query: 'people=2&types=live' });
    /** @type {any} */ (root.querySelector('.c-search__active-chip[data-field="types"]')).click();
    await flush();
    assert.equal(urls.at(-1), '/?people=2', 'types=live is gone, people=2 remains');
  } finally {
    cleanup();
  }
});

test('repeated commits never pile up duplicate listeners (review round 1, self-review bug #2)', async () => {
  stubFetch(() => ({ count: 0, results: [] }));
  try {
    const { root, urls } = await mountedPage({ query: 'people=1&people=2&types=live' });
    for (let i = 0; i < 3; i++) {
      const chip = /** @type {any} */ (root.querySelector('.c-search__active-chip'));
      assert.ok(chip, `a chip is still present before click ${i + 1}`);
      chip.click();
      await flush();
      assert.equal(urls.length, i + 1, `click ${i + 1} committed exactly once, got urls=${JSON.stringify(urls)}`);
    }
  } finally {
    cleanup();
  }
});

test('reopening the filter sheet never piles up duplicate listeners (review round 1, self-review bug #3)', async () => {
  stubFetch(() => ({ count: 0, results: [] }));
  try {
    const { root, urls } = await mountedPage();
    const filterBtn = /** @type {any} */ (root.querySelector('.c-header__filter-btn'));
    for (let i = 0; i < 3; i++) {
      filterBtn.click();
      await flush();
      const dialog = /** @type {any} */ (root.querySelector('.c-filter-sheet'));
      dialog.close = () => {};
      root.dispatchEvent({ type: 'keydown', target: dialog, key: 'Escape' });
    }
    filterBtn.click();
    await flush();
    assert.equal(root.querySelectorAll('.c-filter-sheet__apply').length, 1, 'exactly one sheet is live, not one per open');
    /** @type {any} */ (root.querySelector('.c-filter-sheet__apply')).click();
    await flush();
    assert.equal(urls.length, 1, `Apply committed exactly once, got urls=${JSON.stringify(urls)}`);
  } finally {
    cleanup();
  }
});

test('the filter sheet opened from the list view shows the real match count (review round 1, M1); a scoped page\'s own filter is selected in it', async () => {
  stubFetch((url) => {
    assert.match(url, /limit=0/, 'the open-sheet count fetch uses limit=0');
    return { count: 42, results: [] };
  });
  try {
    const { root } = await mountedPage({ scope: EVENT_SCOPE, path: '/e/starfest' });
    /** @type {any} */ (root.querySelector('.c-header__filter-btn')).click();
    await flush();
    const applyBtn = /** @type {any} */ (root.querySelector('.c-filter-sheet__apply'));
    assert.equal(applyBtn.children.map((/** @type {any} */ c) => c.textContent).join(''), 'show 42');
    const selected = root.querySelectorAll('.c-filter-sheet__event option').find((/** @type {any} */ o) => o.getAttribute('value') === 'starfest');
    assert.ok(selected && selected.getAttribute('selected') !== null, 'the event is already chosen');
  } finally {
    cleanup();
  }
});

/** @param {any} root @returns {string} */
function errorText(root) {
  return root.querySelector('.c-empty-state__message')?.children?.[0]?.textContent ?? '';
}

test('a refetch failure shows the error state but keeps the chips, so there is a way to recover (review round 1, I2)', async () => {
  let fail = false;
  stubFetch(() => { if (fail) throw new Error('network down'); return { count: 1, results: [RESULT] }; });
  try {
    const { root } = await mountedPage({ query: 'people=2&types=live' });
    fail = true;
    /** @type {any} */ (root.querySelector('.c-search__active-chip[data-field="types"]')).click();
    await flush();
    assert.match(errorText(root), /something went wrong/);
    assert.ok(root.querySelector('.c-search__clear-all'), 'the active-filters row is still there');
  } finally {
    cleanup();
  }
});

test('a /api/filters failure still leaves a working search', async () => {
  mock.method(globalThis, 'fetch', async (/** @type {any} */ url) => (String(url).startsWith('/api/filters') ? new Response('x', { status: 500 }) : ok({ count: 1, results: [RESULT] })));
  try {
    const { root } = await mountedPage({ query: 'q=hug' });
    assert.equal(root.querySelectorAll('.c-result-card').length, 1);
  } finally {
    cleanup();
  }
});

test('a stale refetch response never overwrites a newer one, however the two resolve (review round 1, I1)', async () => {
  /** @type {((body: any) => void)[]} */
  const resolvers = [];
  let first = true;
  stubFetch(() => {
    if (first) { first = false; return { count: 3, results: [] }; }
    return new Promise((resolve) => { resolvers.push((body) => resolve(ok(body))); });
  });
  try {
    const { root } = await mountedPage({ query: 'people=2&types=live&account=tl_beta' });
    /** @type {any} */ (root.querySelector('.c-search__active-chip[data-field="types"]')).click();
    /** @type {any} */ (root.querySelector('.c-search__active-chip[data-field="account"]')).click();
    await flush();
    assert.equal(resolvers.length, 2, 'two refetches are in flight');
    resolvers[1]({ count: 1, results: [{ ...RESULT, url: '/t/new', sourceId: 'new' }] });
    await flush();
    resolvers[0]({ count: 99, results: [{ ...RESULT, url: '/t/stale', sourceId: 'stale' }] });
    await flush();
    const hrefs = root.querySelectorAll('.c-result-card').map((/** @type {any} */ c) => c.getAttribute('href'));
    assert.deepEqual(hrefs, ['/t/new'], 'the stale response never rendered');
  } finally {
    cleanup();
  }
});

test('clearing back to the list drops a search still in flight', async () => {
  /** @type {((body: any) => void)[]} */
  const resolvers = [];
  stubFetch(() => new Promise((resolve) => { resolvers.push((body) => resolve(ok(body))); }));
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { root } = await mountedPage();
    await typeAndSettle(root, 'hi');
    await typeAndSettle(root, '');
    resolvers[0]({ count: 1, results: [RESULT] });
    for (let i = 0; i < 20; i++) await Promise.resolve();
    assert.ok(listShown(root));
    assert.equal(root.querySelectorAll('.c-result-card').length, 0, 'the late response never rendered');
  } finally {
    cleanup();
  }
});

test('a loadMore failure just re-enables the button, leaving the existing results alone (review round 1, I2)', async () => {
  let fail = false;
  stubFetch(() => { if (fail) throw new Error('network down'); return { count: 5, results: [RESULT] }; });
  try {
    const { root } = await mountedPage({ query: 'q=hug' });
    fail = true;
    const more = /** @type {any} */ (root.querySelector('.c-search__more'));
    assert.ok(more, 'a "more" button renders when results.length < count');
    more.click();
    await flush();
    assert.equal(more.disabled, false, 'the button is re-enabled so the user can retry');
    assert.equal(root.querySelectorAll('.c-result-card').length, 1, 'the existing result is untouched');
  } finally {
    cleanup();
  }
});

/** @param {any} state @param {number} count @returns {string} */
const body = (state, count) => String(resultsBody({ ...inlineSearch.prepare({ search: '' }), state, data: { count, results: count ? [RESULT] : [] } }));

test('resultsBody (Task 9b): a results line above the results counts every match and names the order', () => {
  const withQ = body({ ...EMPTY_STATE, q: 'hug' }, 3);
  assert.match(withQ, /<p class="c-search__count">3 translations · best match first<\/p>/);
  assert.ok(withQ.indexOf('c-search__count') < withQ.indexOf('c-search__results'));
  assert.match(body({ ...EMPTY_STATE, people: [1] }, 1), /<p class="c-search__count">1 translation · newest first<\/p>/);
  assert.ok(!body({ ...EMPTY_STATE, q: 'zzz' }, 0).includes('c-search__count'), 'no results: no count line');
  assert.match(body({ ...EMPTY_STATE, q: 'zzz' }, 0), /no results/);
});

test('prepare: a q out of the 2-100 range in a hand-edited URL is dropped', () => {
  assert.equal(inlineSearch.prepare({ search: 'q=a' }).state.q, '');
  assert.equal(inlineSearch.prepare({ search: `q=${'x'.repeat(101)}` }).state.q, '');
  assert.equal(inlineSearch.prepare({ search: 'q=ab' }).state.q, 'ab');
});
