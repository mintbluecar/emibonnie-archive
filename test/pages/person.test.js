// @ts-check
/**
 * DOM-free tests of `composePerson` (pure: `PersonView` -> `SafeHtml`),
 * on snapshots of the real `/api/person/:ig` response (generated from
 * `personView()` against the seeded example site, same as
 * `test/pages/event.test.js` does for `composeEvent`). `person.json`:
 * solsunny's real page (events grouped by event, two standalone posts
 * folding into one "posts" group). `person-groups.json`: lunamoon's real
 * page (review round 1, replacing an earlier fabricated fixture) -- her
 * SHARED item (tweet `...005`, examples/solluna/seed/maps.json) now maps
 * its 🪇 marker to her, so one real fixture exercises an event group, a
 * "shared story" group, and a "posts" group together.
 */
import '../helpers/siteFixture.js';
import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { readFileSync } from 'node:fs';
// Dynamic import: see test/components/header.test.js for why.
const { composePerson, bind, start } = await import('../../public/js/pages/person.js');
const { MiniElement, fakeDocument } = await import('../helpers/miniDom.js');
const { mount } = await import('../../public/js/core/dom.js');

const PERSON = JSON.parse(readFileSync(new URL('../snapshots/person.json', import.meta.url), 'utf8'));
const PERSON_GROUPS = JSON.parse(readFileSync(new URL('../snapshots/person-groups.json', import.meta.url), 'utf8'));
/** One macrotask tick, enough for a mocked fetch's `.then()` chain to settle. */
const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

test('composePerson: the person header, in their colour, and the counts line', () => {
  const markup = String(composePerson(PERSON));
  assert.match(markup, /c-person-header/);
  assert.match(markup, /data-c="#c47a12"/);
  assert.match(markup, /<h1 class="c-person-header__name">sol<\/h1>/);
  assert.match(markup, /in 6\u00a0translations · 3\u00a0events · 0\u00a0shared\u00a0stories/);
});

test('composePerson (Task 10d): searches within this person -- the box names them, and there is no separate search icon', () => {
  const markup = String(composePerson(PERSON));
  assert.match(markup, /placeholder="search sol…"/);
  assert.ok(!markup.includes('c-person__search'));
  assert.ok(!markup.includes('/search'));
  assert.match(markup, /<div data-search-list>[\s\S]*c-hub__seg/);
  assert.match(markup, /data-field="people" data-value="1"[^>]*aria-label="remove ☀️ sol"/, 'the person is a removable chip from the start');
});

test('composePerson: the segmented control, with "with…" (person only)', () => {
  const markup = String(composePerson(PERSON));
  assert.match(markup, /by event/);
  assert.match(markup, /all, newest/);
  assert.match(markup, /with…/);
});

test('composePerson: grouped by event, each event name its own group label', () => {
  const markup = String(composePerson(PERSON));
  assert.match(markup, /SOLLUNA HAPPY DAY · 19 Oct 2026/);
  assert.match(markup, /SOLLUNA AT STARFEST · 18 Oct 2026/);
  assert.match(markup, /sol &amp; luna ig live · 1 Mar 2026/);
});

test('composePerson: two standalone posts (no event) fold into one "posts" group', () => {
  const markup = String(composePerson(PERSON));
  const postsHeadings = markup.match(/<h2 class="label label--section">posts<\/h2>/g) ?? [];
  assert.equal(postsHeadings.length, 1, 'one "posts" heading, not one per post');
  assert.match(markup, /href="\/t\/1900000000000000009"/);
  assert.match(markup, /href="\/t\/1900000000000000008"/);
});

test('composePerson: a shared-story item groups under "shared story · <day>", distinct from "posts" and from an event', () => {
  const markup = String(composePerson(PERSON_GROUPS));
  assert.match(markup, /<h2 class="label label--section">shared story · 2 Mar 2026<\/h2>/);
  assert.match(markup, /<h2 class="label label--section">posts<\/h2>/);
  assert.match(markup, /SOLLUNA AT STARFEST · 18 Oct 2026/);
});

test('composePerson: includes the page shell\'s compact header and tab bar', () => {
  const markup = String(composePerson(PERSON));
  assert.match(markup, /<header class="c-header" data-compact>/);
  assert.match(markup, /c-tabbar/);
  assert.match(markup, /c-footer__links/);
});

test('bind: switching to "all, newest" re-renders flat, without a group label', () => {
  const root = new MiniElement('div');
  mount(root, composePerson(PERSON));
  globalThis.document = fakeDocument();
  bind(root, PERSON, 'solsunny');
  const allChip = /** @type {any} */ (root.querySelector('.c-hub__seg [data-value="all"]'));
  allChip.click();
  assert.equal(allChip.getAttribute('aria-pressed'), 'true', 'the chosen view is pressed');
  assert.equal(root.querySelector('.c-hub__seg [data-value="byEvent"]')?.getAttribute('aria-pressed'), 'false', 'and the other is not');
  const content = /** @type {any} */ (root.querySelector('[data-hub-content]'));
  assert.equal(content.querySelectorAll('[data-hub-group] h2').length, 0, 'flat view has no group labels');
  assert.ok(content.querySelector('a[href="/t/1900000000000000009"]'), 'the entries are still there, just ungrouped');
  assert.equal(allChip.getAttribute('aria-pressed'), 'true');
  delete (/** @type {any} */ (globalThis)).document;
});

/** @param {any} data @param {string} ig */
function mountedPerson(data, ig) {
  const root = new MiniElement('div');
  mount(root, composePerson(data));
  globalThis.document = fakeDocument();
  bind(root, data, ig);
  return root;
}

function cleanup() {
  delete (/** @type {any} */ (globalThis)).document;
  delete (/** @type {any} */ (globalThis)).window;
  mock.restoreAll();
}

test('bind: "more" fetches the kind\'s next page with the right offset, appends, and re-renders (review round 1, I1)', async () => {
  const paged = { ...PERSON, sections: [{ ...PERSON.sections[0], total: 20, hasMore: true }] };
  const root = mountedPerson(paged, 'solsunny');
  try {
    const nextPage = { sections: [{ kind: 'translation', total: 20, hasMore: false, items: [{ ...PERSON.sections[0].items[0], sourceId: 'NEW_ITEM', url: '/t/NEW_ITEM' }] }] };
    /** @type {any[]} */
    const calls = [];
    mock.method(globalThis, 'fetch', async (/** @type {any} */ url) => {
      calls.push(String(url));
      return new Response(JSON.stringify(nextPage), { status: 200 });
    });
    const more = /** @type {any} */ (root.querySelector('[data-action="more"]'));
    assert.ok(more, 'a "more" button is rendered when a section hasMore');
    more.click();
    await flush();
    assert.match(calls[0], /\/api\/person\/solsunny\?offset=6/, `expected offset=6 (the 6 items already loaded), got ${calls[0]}`);
    assert.ok(root.querySelector('a[href="/t/NEW_ITEM"]'), 'the newly fetched item is now rendered');
    assert.ok(!root.querySelector('[data-action="more"]'), 'no more button once hasMore is false');
  } finally {
    cleanup();
  }
});

test('bind: "more" is guarded by a sequence number against a stale response (review round 1, I1)', async () => {
  const paged = { ...PERSON, sections: [{ ...PERSON.sections[0], total: 20, hasMore: true }] };
  const root = mountedPerson(paged, 'solsunny');
  try {
    /** @type {((v: any) => void)[]} */
    const releasers = [];
    mock.method(globalThis, 'fetch', () => new Promise((resolve) => {
      releasers.push((page) => resolve(new Response(JSON.stringify(page), { status: 200 })));
    }));
    const more = /** @type {any} */ (root.querySelector('[data-action="more"]'));
    more.click();
    more.click(); // fires again while the first is still in flight (button isn't disabled until the click handler runs synchronously first)
    // Resolve the *first* request last, with a response that would be wrong if it won.
    releasers[1]({ sections: [{ kind: 'translation', total: 20, hasMore: false, items: [{ ...PERSON.sections[0].items[0], sourceId: 'SECOND', url: '/t/SECOND' }] }] });
    await flush();
    releasers[0]({ sections: [{ kind: 'translation', total: 20, hasMore: true, items: [{ ...PERSON.sections[0].items[0], sourceId: 'FIRST', url: '/t/FIRST' }] }] });
    await flush();
    assert.ok(root.querySelector('a[href="/t/SECOND"]'), 'the second (newer) click\'s result won');
    assert.ok(!root.querySelector('a[href="/t/FIRST"]'), 'the first (now-stale) click\'s result never applied');
  } finally {
    cleanup();
  }
});

test('bind (Task 10d): reopening the "with…" picker twice, then applying, searches in place exactly once with the right people (review round 1, I2)', async () => {
  const root = mountedPerson(PERSON, 'solsunny');
  try {
    /** @type {string[]} */
    const urls = [];
    globalThis.history = /** @type {any} */ ({ replaceState: (/** @type {any} */ _s, /** @type {any} */ _t, /** @type {string} */ url) => { urls.push(url); } });
    const location = { pathname: '/p/solsunny', search: '' };
    Object.defineProperty(location, 'href', { get: () => '/p/solsunny', set: (v) => { throw new Error(`navigated to ${v}`); } });
    globalThis.window = /** @type {any} */ ({ location });
    /** @type {string[]} */
    const searches = [];
    mock.method(globalThis, 'fetch', async (/** @type {any} */ url) => {
      if (String(url).startsWith('/api/search')) { searches.push(String(url)); return new Response(JSON.stringify({ count: 0, results: [] }), { status: 200 }); }
      return new Response(JSON.stringify({
        people: [
          { id: 1, name: 'sol', emoji: '☀️', colour: '#c47a12', igHandle: 'solsunny' },
          { id: 2, name: 'luna', emoji: '🌙', colour: '#6a5cd6', igHandle: 'lunamoon' },
        ],
        categories: [], clients: [], events: [], accounts: [],
      }), { status: 200 });
    });
    const withChip = /** @type {any} */ (root.querySelector('.c-hub__seg [data-value="with"]'));
    withChip.click();
    await flush();
    withChip.click();
    await flush();
    withChip.click();
    await flush();
    // sol is PERSON's own person (id 1); the picker excludes self, so only luna (id 2) is choosable.
    assert.ok(!root.querySelector('[data-person-picker] [data-value="1"]'), 'the picker excludes self (review round 1, M2)');
    const lunaChip = /** @type {any} */ (root.querySelector('[data-person-picker] [data-value="2"]'));
    lunaChip.click();
    const applyBtn = /** @type {any} */ (root.querySelector('.c-hub__picker-apply'));
    applyBtn.click();
    await flush();
    assert.deepEqual(urls, ['/p/solsunny?people=2&peopleMode=all'], 'one in-place search on the person\'s own page (sol is implied by the path)');
    assert.equal(searches.length, 1);
    assert.match(searches[0], /people=1%2C2&peopleMode=all/);
    assert.ok(root.querySelector('[data-search-list]').hidden, 'results replace the list');
  } finally {
    delete (/** @type {any} */ (globalThis)).history;
    cleanup();
  }
});

/** @param {string} pathname @returns {any} */
function mountedStart(pathname) {
  const root = new MiniElement('div');
  globalThis.document = /** @type {any} */ ({
    createElement: (/** @type {any} */ tag) => new MiniElement(tag), getElementById: (/** @type {string} */ id) => (id === 'app' ? root : null), title: '',
  });
  globalThis.window = /** @type {any} */ ({ location: { pathname, href: `http://localhost${pathname}` } });
  return root;
}

/** @param {any} root @returns {string} */
function emptyStateText(root) {
  return root.querySelector('.c-empty-state__message')?.children?.[0]?.textContent ?? '';
}

test('start: a 404 from the API renders person.notFound', async () => {
  const root = mountedStart('/p/nobody-here');
  mock.method(globalThis, 'fetch', async () => new Response('not found', { status: 404 }));
  try {
    await start();
    assert.equal(emptyStateText(root), 'person not found');
  } finally {
    cleanup();
  }
});

test('start: a non-404 failure renders the generic page.loadFailed fallback, never throws (review round 1, I5)', async () => {
  const root = mountedStart('/p/solsunny');
  mock.method(globalThis, 'fetch', async () => { throw new Error('network down'); });
  try {
    await start();
    assert.equal(emptyStateText(root), 'something went wrong, try again');
  } finally {
    cleanup();
  }
});

test('start: redirectTo replaces the page at personHref(redirectTo)', async () => {
  const root = mountedStart('/p/SolSunny');
  /** @type {string[]} */
  const replaced = [];
  globalThis.window.location.replace = (/** @type {string} */ url) => replaced.push(url);
  mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ ...PERSON, redirectTo: 'solsunny' }), { status: 200 }));
  try {
    await start();
    assert.deepEqual(replaced, ['/p/solsunny']);
    assert.equal(root.children.length, 0, 'the page was never mounted -- redirectTo short-circuits before that');
  } finally {
    cleanup();
  }
});

test('composePerson (Task 9b): entries are compact previews in both views, not full bubbles', () => {
  const markup = String(composePerson(PERSON_GROUPS));
  assert.match(markup, /data-compact/);
  assert.ok(!markup.includes('c-bubbles__bub'));
});

test('hubGroups (Task 9b): the flat "all, newest" view is compact too', async () => {
  const { activeView } = await import('../../public/js/pages/hubGroups.js');
  const markup = String(activeView('all', PERSON_GROUPS.sections, {}));
  assert.match(markup, /data-compact/);
  assert.ok(!markup.includes('c-bubbles__bub'));
});
