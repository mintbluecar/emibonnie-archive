// @ts-check
/**
 * `bind()`-level tests for the search page (review round 1, M4): driven
 * against real rendered markup (`composeSearch`) through `miniDom`, the
 * same pattern `test/pages/event.test.js` uses for its own `bind()`.
 * `composeSearch`/`searchAreaMarkup` themselves are pure and already
 * covered indirectly here; these tests are about the DOM wiring --
 * removing a chip, listener pile-up after repeated re-renders, and
 * `localStorage`-backed recent searches.
 */
import '../helpers/siteFixture.js';
import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { MiniElement, fakeDocument } from '../helpers/miniDom.js';
import { mount } from '../../public/js/core/dom.js';
import { EMPTY_STATE } from '../../public/js/state/searchState.js';
// Dynamic import: see test/components/header.test.js for why.
const { bind, start } = await import('../../public/js/pages/search.js');
const { composeSearch } = await import('../../public/js/pages/searchView.js');

/** @type {import('../../src/http/contracts.js').FilterOptions} */
const OPTIONS = {
  people: [{ id: 1, name: 'sol', emoji: '☀️', colour: '#c47a12', igHandle: 'solsunny' }, { id: 2, name: 'luna', emoji: '🌙', colour: '#6a5cd6', igHandle: 'lunamoon' }],
  categories: [{ id: 5, name: 'live' }],
  events: [],
  clients: [],
  accounts: [{ handle: 'tl_beta' }],
};

/** @type {import('../../src/http/contracts.js').SearchResult} */
const RESULT = {
  kind: 'translation', sourceId: '1', url: '/t/1', lines: [], people: [], accountHandle: null, hasVideo: false,
  followsOnFrom: null, occurredOn: '2026-10-18', placement: 'event', event: null, matchLines: ['hi'],
};

/** One macrotask tick, enough for a mocked fetch's `.then()` chain to settle. */
const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

/** A plain in-memory `localStorage`, or one whose every method throws (for the try/catch tests). @param {{ throws?: boolean }} [opts] */
function fakeLocalStorage({ throws = false } = {}) {
  /** @type {Map<string,string>} */
  const store = new Map();
  if (throws) {
    return { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  }
  return {
    getItem: (/** @type {string} */ k) => store.get(k) ?? null,
    setItem: (/** @type {string} */ k, /** @type {string} */ v) => { store.set(k, v); },
  };
}

/**
 * Mounts the page and stubs every browser global `bind()`/its handlers touch.
 * @param {import('../../src/http/contracts.js').State|any} state
 * @param {import('../../src/http/contracts.js').SearchResponse} [data]
 */
function mountedPage(state = EMPTY_STATE, data = { count: 0, results: [] }) {
  /** @type {import('../../public/js/pages/searchView.js').Ctx & { seq: number }} */
  const ctx = {
    state, options: OPTIONS, data, offset: data.results.length, recent: [], seq: 0,
  };
  const root = new MiniElement('div');
  mount(root, composeSearch(ctx));
  globalThis.document = fakeDocument();
  globalThis.window = /** @type {any} */ ({ location: { href: '' } });
  /** @type {string[]} */
  const urls = [];
  globalThis.history = /** @type {any} */ ({ replaceState: (_s, _t, url) => { urls.push(url); } });
  globalThis.localStorage = /** @type {any} */ (fakeLocalStorage());
  bind(root, ctx);
  return { root, ctx, urls };
}

function cleanup() {
  delete (/** @type {any} */ (globalThis)).document;
  delete (/** @type {any} */ (globalThis)).window;
  delete (/** @type {any} */ (globalThis)).history;
  delete (/** @type {any} */ (globalThis)).localStorage;
  mock.restoreAll();
}

test('bind: removing a type chip refetches without it and updates the URL', async () => {
  const { root, urls } = mountedPage({ ...EMPTY_STATE, people: [2], types: ['live'] });
  mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ count: 1, results: [RESULT] }), { status: 200 }));
  try {
    const chip = /** @type {any} */ (root.querySelector('.c-search__active-chip[data-field="types"]'));
    assert.ok(chip, 'a "live" active-filter chip is rendered');
    chip.click();
    await flush();
    assert.equal(urls.at(-1), '/search?people=2', 'types=live is gone, people=2 remains');
  } finally {
    cleanup();
  }
});

test('bind: repeated commits never pile up duplicate listeners on .c-search (review round 1, self-review bug #2, regression-guarded)', async () => {
  // 3 distinct active filters, so a still-present active-filter chip can be
  // clicked 3 times running (task-6-brief.md carried item #1: the previous
  // version of this test clicked .c-search__clear-all repeatedly, but that
  // button disappears once there are no filters left -- clicks 2 and 3 landed
  // on nothing and never exercised the pile-up this test is meant to guard).
  const { root, urls } = mountedPage({ ...EMPTY_STATE, people: [1, 2], types: ['live'] });
  mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ count: 0, results: [] }), { status: 200 }));
  try {
    for (let i = 0; i < 3; i++) {
      const chip = /** @type {any} */ (root.querySelector('.c-search__active-chip'));
      assert.ok(chip, `an active-filter chip is still present before click ${i + 1}`);
      chip.click();
      await flush();
      // Each click committed exactly once -- a stacked duplicate listener would
      // fire the handler 2x, 3x, ... on each later click, inflating this past i+1.
      assert.equal(urls.length, i + 1, `click ${i + 1} committed exactly once, got urls=${JSON.stringify(urls)}`);
    }
  } finally {
    cleanup();
  }
});

test('bind: reopening the filter sheet never piles up duplicate listeners (review round 1, self-review bug #3, regression-guarded)', async () => {
  const { root, urls } = mountedPage(EMPTY_STATE);
  mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ count: 0, results: [] }), { status: 200 }));
  try {
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

test('bind: opening the filter sheet from the blank state shows the real match count, not "show 0" (review round 1, M1)', async () => {
  const { root } = mountedPage(EMPTY_STATE);
  mock.method(globalThis, 'fetch', async (/** @type {any} */ url) => {
    assert.match(String(url), /limit=0/, 'the open-sheet count fetch uses limit=0');
    return new Response(JSON.stringify({ count: 42, results: [] }), { status: 200 });
  });
  try {
    /** @type {any} */ (root.querySelector('.c-header__filter-btn')).click();
    await flush();
    const applyBtn = /** @type {any} */ (root.querySelector('.c-filter-sheet__apply'));
    assert.equal(applyBtn.children.map((/** @type {any} */ c) => c.textContent).join(''), 'show 42');
  } finally {
    cleanup();
  }
});

/**
 * Fires the input's debounce (mocked timers, so this is instant and
 * deterministic -- no real wall-clock wait, no flakiness) and drains
 * enough microtask turns for the resulting fetch/json/mount chain to settle.
 * @param {any} searchBox @param {string} q
 */
async function typeAndSettle(searchBox, q) {
  searchBox.value = q;
  searchBox.dispatchEvent({ type: 'input', target: searchBox });
  mock.timers.tick(250);
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

test('recent searches: capped at 8, newest first, de-duplicated', async () => {
  const { root } = mountedPage(EMPTY_STATE);
  mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ count: 1, results: [RESULT] }), { status: 200 }));
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const searchBox = /** @type {any} */ (root.querySelector('.c-header__search-box'));
    for (const q of ['aa', 'bb', 'cc', 'dd', 'ee', 'ff', 'gg', 'hh', 'aa']) await typeAndSettle(searchBox, q);
    const stored = JSON.parse(/** @type {any} */ (globalThis.localStorage).getItem('fa:recentSearches'));
    assert.equal(stored.length, 8, 'capped at 8');
    assert.equal(stored[0], 'aa', 'the re-searched "aa" moved back to the front');
    assert.deepEqual(new Set(stored).size, stored.length, 'no duplicates');
  } finally {
    mock.timers.reset();
    cleanup();
  }
});

test('recent searches: a throwing localStorage is handled, never crashes a commit', async () => {
  const { root, urls } = mountedPage(EMPTY_STATE);
  globalThis.localStorage = /** @type {any} */ (fakeLocalStorage({ throws: true }));
  mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ count: 1, results: [RESULT] }), { status: 200 }));
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const searchBox = /** @type {any} */ (root.querySelector('.c-header__search-box'));
    await typeAndSettle(searchBox, 'hug');
    assert.equal(urls.at(-1), '/search?q=hug', 'the search itself still went through');
  } finally {
    mock.timers.reset();
    cleanup();
  }
});

/** The error state's own message text, read off `.c-empty-state__message`'s own text child (parsed markup carries no `.textContent` on the element itself, only its MiniText children -- see M1's test for the same reason). @param {any} root @returns {string} */
function errorText(root) {
  return root.querySelector('.c-empty-state__message')?.children?.[0]?.textContent ?? '';
}

test('start: an unexpected failure (e.g. /api/filters itself) renders the whole-page error fallback instead of throwing (review round 1, I2)', async () => {
  const root = new MiniElement('div');
  globalThis.document = /** @type {any} */ ({
    createElement: (/** @type {any} */ tag) => new MiniElement(tag), getElementById: (/** @type {string} */ id) => (id === 'app' ? root : null), title: '',
  });
  globalThis.window = /** @type {any} */ ({ location: { href: 'http://localhost/search' } });
  mock.method(globalThis, 'fetch', async () => { throw new Error('network down'); });
  try {
    await start();
    assert.match(errorText(root), /something went wrong/);
    assert.ok(root.querySelector('.c-tabbar'), 'still the full page shell (header/tabs/footer), not a bare message');
  } finally {
    cleanup();
  }
});

test('bind: a refetch failure shows the error state but keeps the active-filter chips (so there is still a way to recover) (review round 1, I2)', async () => {
  // Two active filters, so removing one still leaves the state non-blank -- otherwise
  // refetchAndRender would skip the network call entirely (ruling 3) and never hit the mock.
  const { root } = mountedPage({ ...EMPTY_STATE, people: [2], types: ['live'] }, { count: 1, results: [RESULT] });
  mock.method(globalThis, 'fetch', async () => { throw new Error('network down'); });
  try {
    /** @type {any} */ (root.querySelector('.c-search__active-chip[data-field="types"]')).click();
    await flush();
    assert.match(errorText(root), /something went wrong/);
    assert.ok(root.querySelector('.c-search__clear-all'), 'the active-filters row is still there');
  } finally {
    cleanup();
  }
});

test('bind: a stale refetch response never overwrites a newer one, however the two resolve (review round 1, I1)', async () => {
  const { root } = mountedPage({ ...EMPTY_STATE, people: [2], types: ['live'], account: 'tl_beta' }, { count: 3, results: [] });
  /** @type {((body: any) => void)[]} */
  const resolvers = [];
  mock.method(globalThis, 'fetch', () => new Promise((resolve) => {
    resolvers.push((body) => resolve(new Response(JSON.stringify(body), { status: 200 })));
  }));
  try {
    // Two refetches in a row, synchronously, before either resolves: removing "types"
    // (an older, now-superseded request) then removing "account" too (the newer one).
    /** @type {any} */ (root.querySelector('.c-search__active-chip[data-field="types"]')).click();
    /** @type {any} */ (root.querySelector('.c-search__active-chip[data-field="account"]')).click();
    assert.equal(resolvers.length, 2, 'two refetches are in flight');

    const newResult = { ...RESULT, url: '/t/new', sourceId: 'new' };
    const staleResult = { ...RESULT, url: '/t/stale', sourceId: 'stale' };
    // Resolve in reverse order: the newer request answers first, the older (stale) one after.
    resolvers[1]({ count: 1, results: [newResult] });
    await flush();
    resolvers[0]({ count: 99, results: [staleResult] });
    await flush();

    const hrefs = root.querySelectorAll('.c-result-card').map((/** @type {any} */ c) => c.getAttribute('href'));
    assert.deepEqual(hrefs, ['/t/new'], 'the stale response never rendered');
  } finally {
    cleanup();
  }
});

test('bind: a loadMore failure just re-enables the button, leaving the existing results alone (review round 1, I2)', async () => {
  const { root } = mountedPage(EMPTY_STATE, { count: 5, results: [RESULT] });
  mock.method(globalThis, 'fetch', async () => { throw new Error('network down'); });
  try {
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
const composed = (state, count) => String(composeSearch({
  state, options: OPTIONS, data: { count, results: count ? [RESULT] : [] }, offset: 0, recent: [],
}));

test('composeSearch (Task 9b): a results line above the results counts every match and names the order -- best match first with a query, newest first when browsing by filter', () => {
  const withQ = composed({ ...EMPTY_STATE, q: 'hug' }, 3);
  assert.match(withQ, /<p class="c-search__count">3 translations · best match first<\/p>/);
  assert.ok(withQ.indexOf('c-search__count') < withQ.indexOf('c-search__results'));
  assert.match(composed({ ...EMPTY_STATE, people: [1] }, 1), /<p class="c-search__count">1 translation · newest first<\/p>/);
});

test('composeSearch (Task 9b): no results line for the blank state or no results', () => {
  assert.ok(!composed(EMPTY_STATE, 0).includes('c-search__count'));
  assert.ok(!composed({ ...EMPTY_STATE, q: 'zzz' }, 0).includes('c-search__count'));
});
