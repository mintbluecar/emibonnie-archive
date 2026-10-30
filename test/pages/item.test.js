// @ts-check
/**
 * DOM-free tests of `composeItem` (pure: `ItemView & { editOpenUntil }`
 * -> `SafeHtml`), on a hand-built fixture matching `src/http/contracts.js`
 * (the same approach test/components/translationKindUi.test.js's
 * `detailVm()` uses) -- `public/js` can't import `src/**` (eslint layer
 * rule), so there's no DB-backed snapshot here the way
 * test/pages/event.test.js's is. `bind()` is driven against the real
 * rendered markup via test/helpers/miniDom.js, the same as event.test.js.
 */
import '../helpers/siteFixture.js';
import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { MiniElement, fakeDocument } from '../helpers/miniDom.js';
import { mount } from '../../public/js/core/dom.js';

// `public/js/kinds/_registry.js` (with its real urlPrefix, `/t/`) is generated once, before
// any test file runs, by `npm test`'s `pretest` step (`scripts/genRegistries.js`) -- see
// scripts/buildOutputs.js's `writeKindsRegistries` doc comment (Plan 1b Task 7 brief, carried
// item B). This file's own start()-level tests route a pathname through it via item.js's import.
// Dynamic import: see test/components/header.test.js for why.
const { composeItem, bind, start } = await import('../../public/js/pages/item.js');
const { site, t } = await import('../../public/js/core/site.js');
const { copyRe } = await import('../helpers/copyMarkup.js');

const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

/** @returns {import('../../src/http/contracts.js').ItemView & { editOpenUntil: string|null }} */
function itemVm(overrides = {}) {
  return {
    kind: 'translation', sourceId: '1900000000000000004', url: '/t/1900000000000000004',
    placement: 'post', event: { slug: 'solluna-happy-day-2026-10-19', name: 'SOLLUNA HAPPY DAY', occurredOn: '2026-10-19' },
    people: [], tags: { keyword: null, hashtags: ['SLHappyDay2026'] }, category: 'clip', addedBy: { kind: 'handle', handle: 'tl_alpha' },
    followsOnFrom: null, prev: { sourceId: '1', url: '/t/1' }, next: { sourceId: '2', url: '/t/2' },
    bubbles: [{ kind: 'speech', emoji: '🧡', name: 'sol', colour: '#ff8a3d', text: 'hello', cont: false }],
    cast: [{ kind: 'person', id: 1, emoji: '🧡', name: 'sol', colour: '#ff8a3d', igHandle: null }],
    original: 'hello',
    credits: { account: { handle: 'tl_alpha', displayName: null }, clipBy: null, occurredOn: '2026-10-19' },
    sources: [{ role: 'primary', url: 'https://x.com/tl_alpha/status/1900000000000000004', status: 'live' }],
    media: { type: 'video', variants: [{ bitrate: 632000, url: 'https://video.twimg.com/a/632000.mp4' }], width: 720, height: 1280 },
    editOpenUntil: null,
    ...overrides,
  };
}

test('composeItem: the back row, media box, credits, pills, cast and bubbles, in order (task-4 brief; review round 1, IMPORTANT #1)', () => {
  const markup = String(composeItem(itemVm()));
  const indices = ['c-item__back', 'c-media-box', 'k-translation-detail__credits', 'c-chips', 'c-cast__chip', 'c-bubbles__bub'].map((m) => markup.indexOf(m));
  assert.ok(indices.every((i) => i >= 0), markup);
  for (let i = 1; i < indices.length; i++) assert.ok(indices[i - 1] < indices[i], `${indices}`);
});

test('composeItem: the back row links to the event page via the shared eventUrl helper, with the event name as its text', () => {
  const markup = String(composeItem(itemVm()));
  assert.match(markup, /<a class="meta c-item__back" href="\/e\/solluna-happy-day-2026-10-19">‹ SOLLUNA HAPPY DAY<\/a>/);
});

test('composeItem: no back row when the item has no event', () => {
  const markup = String(composeItem(itemVm({ event: null })));
  assert.ok(!markup.includes('c-item__back'));
});

test('composeItem: a <select>-free active "home" tab, per pageShell (review round 1, MINOR)', () => {
  const markup = String(composeItem(itemVm()));
  assert.match(markup, /<a\s+class="c-tabbar__item"\s+href="\/"\s+aria-current="page"\s*>/);
});

test('composeItem: prev/next links when ItemView carries neighbours', () => {
  const markup = String(composeItem(itemVm()));
  assert.match(markup, /<a class="meta tap-link" href="\/t\/1">/);
  assert.match(markup, /<a class="meta tap-link" href="\/t\/2">/);
});

test('composeItem: no prev/next nav when there are no neighbours', () => {
  const markup = String(composeItem(itemVm({ prev: null, next: null })));
  assert.ok(!markup.includes('c-item__prevnext'));
});

test('composeItem: the footer -- original tweet, follows on, added by, copy link, report', () => {
  const markup = String(composeItem(itemVm({
    followsOnFrom: { sourceId: '3', url: '/t/3' },
  })));
  assert.match(markup, /<a class="c-item__footer-link" href="https:\/\/x\.com\/tl_alpha\/status\/1900000000000000004">original tweet<\/a>/);
  assert.match(markup, /<a class="c-item__footer-link" href="\/t\/3">follows on from<\/a>/);
  assert.match(markup, /added by @tl_alpha/);
  assert.match(markup, /<button type="button" class="btn btn--secondary btn--sm" data-action="copy-link">copy link<\/button>/);
  assert.match(markup, /<button class="btn btn--quiet btn--sm" type="button" data-action="report">report<\/button>/);
  assert.match(markup, /<dialog[^>]*aria-labelledby="c-report-title"/);
});

test('composeItem (Task 10b): with embedSources off, one "original tweet" link -- no "original media" or "quoted tweet"', () => {
  const markup = String(composeItem(itemVm({
    sources: [
      { role: 'primary', url: 'https://x.com/tl_alpha/status/1900000000000000004', status: 'live' },
      { role: 'media', url: 'https://x.com/solsunny_x/status/1900000000000000011', status: 'live' },
      { role: 'quoted', url: 'https://x.com/solsunny_x/status/1900000000000000010', status: 'live' },
    ],
  })));
  assert.equal(markup.match(/c-item__footer-link" href="https:\/\/x\.com/g)?.length, 1, markup);
  assert.match(markup, /<a class="c-item__footer-link" href="https:\/\/x\.com\/tl_alpha\/status\/1900000000000000004">original tweet<\/a>/);
  assert.ok(!markup.includes('original media') && !markup.includes('quoted tweet'));
  assert.ok(!markup.includes('twitter-tweet'), 'no embed while the setting is off');
});

/** Runs `fn` with the fixture site's `embedSources` on, restoring it afterwards. @param {() => void|Promise<void>} fn */
async function withEmbedSources(fn) {
  /** @type {any} */ (site).embedSources = true;
  try { await fn(); } finally { delete (/** @type {any} */ (site)).embedSources; }
}

test('composeItem (Task 10b): with embedSources on, X\'s embed blockquote replaces the link -- our escaped text, the author and the canonical link inside; copy link and report stay', async () => {
  await withEmbedSources(() => {
    const markup = String(composeItem(itemVm({
      original: 'hi <b>there</b>',
      credits: { account: { handle: 'tl_alpha', displayName: 'TL <alpha>' }, clipBy: null, occurredOn: '2026-10-19' },
    })));
    assert.match(markup, /<blockquote class="twitter-tweet c-embed" data-dnt="true" data-cards="hidden" data-conversation="none">/);
    assert.match(markup, /hi &lt;b&gt;there&lt;\/b&gt;/);
    assert.match(markup, /&mdash; TL &lt;alpha&gt; \(@tl_alpha\)/);
    assert.match(markup, /<a class="c-embed__link" href="https:\/\/x\.com\/tl_alpha\/status\/1900000000000000004">/);
    assert.ok(!markup.includes('class="c-item__footer-link" href="https://x.com'), 'the embed replaces the footer link');
    assert.match(markup, /data-action="copy-link"/);
    assert.match(markup, /data-action="report">report<\/button>/);
  });
});

test('composeItem (Task 10b): a deleted/unavailable post skips the embed -- the stored text with the sourceGone note', async () => {
  await withEmbedSources(() => {
    for (const status of /** @type {const} */ (['deleted', 'unavailable'])) {
      const markup = String(composeItem(itemVm({ original: 'kept text', sources: [{ role: 'primary', url: 'https://x.com/tl_alpha/status/1900000000000000004', status }] })));
      assert.ok(!markup.includes('twitter-tweet'), status);
      assert.match(markup, /c-embed--gone[\s\S]*kept text[\s\S]*Original tweet is no longer available/i);
      assert.match(markup, /c-embed__gone">Original tweet is no longer available\. The text above is the archived copy\./, 'the sourceGoneEmbed wording -- not "kept below" (fix round 1, M6)');
    }
  });
});

test('composeItem (Task 10b): a source URL that isn\'t a canonical x.com post is never embedded, only linked', async () => {
  await withEmbedSources(() => {
    const markup = String(composeItem(itemVm({ sources: [{ role: 'primary', url: 'https://x.com/i/web/status/abc', status: 'live' }] })));
    assert.ok(!markup.includes('twitter-tweet'));
    assert.match(markup, />original tweet<\/a>/);
  });
});

test('composeItem: "added by" shows a fan, a chosen name, or nothing for the engine\'s own writes', () => {
  assert.match(String(composeItem(itemVm({ addedBy: { kind: 'fan' } }))), /added by a fan/);
  assert.match(String(composeItem(itemVm({ addedBy: { kind: 'name', name: 'a reader' } }))), /added by a reader/);
  assert.ok(!String(composeItem(itemVm({ addedBy: null }))).includes('data-added-by'));
});

test('composeItem: the check-for-update button shows only while editOpenUntil is in the future', () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  assert.match(String(composeItem(itemVm({ editOpenUntil: future }))), /data-action="check-update"/);
  assert.ok(!String(composeItem(itemVm({ editOpenUntil: null }))).includes('data-action="check-update"'));
});

test('composeItem: includes the compact page shell (header + tabs + footer)', () => {
  const markup = String(composeItem(itemVm()));
  assert.match(markup, /<header class="c-header" data-compact>/);
  assert.match(markup, /c-tabbar/);
  assert.match(markup, /c-footer__links/);
});

/** A tiny fake localStorage backed by a Map the test can clear between presses. */
function fakeLocalStorage() {
  const store = new Map();
  return {
    store,
    api: {
      getItem: (/** @type {string} */ k) => store.get(k) ?? null,
      setItem: (/** @type {string} */ k, /** @type {string} */ v) => store.set(k, v),
    },
  };
}

test('bind: a successful check reloads only .c-item__body -- the video is the same node across reloads, and the refresh listener never piles up (review round 1, IMPORTANT #2)', async () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  const data = itemVm({ editOpenUntil: future });
  const root = new MiniElement('div');
  mount(root, composeItem(data));
  globalThis.document = fakeDocument();
  const { store, api } = fakeLocalStorage();
  globalThis.localStorage = /** @type {any} */ (api);
  let postCount = 0;
  let getCount = 0;
  mock.method(globalThis, 'fetch', async (/** @type {string} */ _url, /** @type {any} */ opts) => {
    if ((opts?.method ?? 'GET') === 'POST') {
      postCount += 1;
      return new Response(JSON.stringify({ updated: 1, editOpenUntil: future }), { status: 200 });
    }
    getCount += 1;
    return new Response(JSON.stringify(itemVm({ editOpenUntil: future })), { status: 200 });
  });
  try {
    bind(root, data);
    const videoBefore = root.querySelector('video');
    assert.ok(videoBefore, 'the video rendered on first mount');

    // 1st press -> reload #1.
    /** @type {any} */ (root.querySelector('[data-action="check-update"]')).click();
    await flush(); await flush(); await flush();
    assert.equal(postCount, 1);
    assert.equal(getCount, 1, 'the body reload fetched fresh item data');
    assert.equal(root.querySelector('video'), videoBefore, 'the video element was not replaced');

    // Clear the backoff lock (tested on its own in refreshButton.test.js) so a 2nd press is
    // allowed -- the countdown also disabled the button itself, which only its own real-time
    // tick() would re-enable, so that's reset by hand too (this test is about listener
    // pileup, not backoff timing).
    store.clear();
    /** @type {any} */ (root.querySelector('[data-action="check-update"]')).disabled = false;

    // 2nd press -> reload #2.
    /** @type {any} */ (root.querySelector('[data-action="check-update"]')).click();
    await flush(); await flush(); await flush();
    assert.equal(postCount, 2);
    assert.equal(getCount, 2);
    assert.equal(root.querySelector('video'), videoBefore, 'still the same video element after a 2nd reload');

    // A 3rd press, after two reloads: exactly one more POST, not 2 or 3 -- proves the
    // click listener (bound once on root) never piled up across the two body re-renders.
    store.clear();
    /** @type {any} */ (root.querySelector('[data-action="check-update"]')).disabled = false;
    /** @type {any} */ (root.querySelector('[data-action="check-update"]')).click();
    await flush(); await flush(); await flush();
    assert.equal(postCount, 3, 'exactly one more POST per click, even after two reloads');
  } finally {
    mock.restoreAll();
    delete (/** @type {any} */ (globalThis)).document;
    delete (/** @type {any} */ (globalThis)).localStorage;
  }
});

test('bind: a 409 on a real page bind (not an isolated refreshButton.bind() call) still removes the button (review round 1, CRITICAL #2)', async () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  const data = itemVm({ editOpenUntil: future });
  const root = new MiniElement('div');
  mount(root, composeItem(data));
  globalThis.document = fakeDocument();
  const { api } = fakeLocalStorage();
  globalThis.localStorage = /** @type {any} */ (api);
  mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ error: 'edit_window_closed' }), { status: 409 }));
  try {
    bind(root, data);
    /** @type {any} */ (root.querySelector('[data-action="check-update"]')).click();
    await flush();
    assert.equal(root.querySelector('.c-refresh'), null);
  } finally {
    mock.restoreAll();
    delete (/** @type {any} */ (globalThis)).document;
    delete (/** @type {any} */ (globalThis)).localStorage;
  }
});

test('bind: the copy-link button copies the absolute item URL and shows "copied"', async () => {
  const root = new MiniElement('div');
  mount(root, composeItem(itemVm()));
  globalThis.document = fakeDocument();
  /** @type {string[]} */
  const written = [];
  // `navigator` is a getter-only Node global; redefine it for this test.
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true, value: { clipboard: { writeText: async (/** @type {string} */ text) => { written.push(text); } } },
  });
  globalThis.window = /** @type {any} */ ({ location: { origin: 'https://example.fan', href: 'https://example.fan/t/1900000000000000004' } });
  // A tiny fake, so refreshButton.js's bind() doesn't touch Node's real
  // (experimental, warning-on-access) global localStorage.
  /** @type {Map<string, string>} */
  const store = new Map();
  globalThis.localStorage = /** @type {any} */ ({ getItem: (/** @type {string} */ k) => store.get(k) ?? null, setItem: (/** @type {string} */ k, /** @type {string} */ v) => store.set(k, v) });
  mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ variants: [] }), { status: 200 }));
  try {
    bind(root, itemVm());
    const button = /** @type {any} */ (root.querySelector('[data-action="copy-link"]'));
    assert.ok(button);
    button.click();
    await flush();
    assert.deepEqual(written, ['https://example.fan/t/1900000000000000004']);
    assert.equal(button.textContent, 'copied');
  } finally {
    mock.restoreAll();
    delete (/** @type {any} */ (globalThis)).document;
    delete (/** @type {any} */ (globalThis)).navigator;
    delete (/** @type {any} */ (globalThis)).window;
    delete (/** @type {any} */ (globalThis)).localStorage;
  }
});

test('start: a non-404 failure renders the generic page.loadFailed fallback, never throws (review round 1, I5)', async () => {
  const root = new MiniElement('div');
  globalThis.document = /** @type {any} */ ({
    createElement: (/** @type {any} */ tag) => new MiniElement(tag), getElementById: (/** @type {string} */ id) => (id === 'app' ? root : null), title: '',
  });
  globalThis.window = /** @type {any} */ ({ location: { pathname: '/t/1900000000000000004', href: 'http://localhost/t/1900000000000000004' } });
  mock.method(globalThis, 'fetch', async () => { throw new Error('network down'); });
  try {
    await start();
    assert.match(root.querySelector('.c-empty-state__message')?.children?.[0]?.textContent ?? '', /something went wrong, try again/);
  } finally {
    mock.restoreAll();
    delete (/** @type {any} */ (globalThis)).document;
    delete (/** @type {any} */ (globalThis)).window;
  }
});

test('composeItem: a held entry shows the owner banner; a public entry does not', () => {
  const held = String(composeItem(itemVm({ reviewState: 'pending' })));
  assert.match(held, /class="notice notice--strong c-item__held"/);
  assert.match(held, copyRe(t('item.held')));

  const open = String(composeItem(itemVm()));
  assert.ok(!open.includes('c-item__held'), 'no banner on a public entry');
});

test('composeItem (Task 10c r): the item page has no search row or box at any width; the bar\'s search icon goes home', () => {
  const markup = String(composeItem(itemVm()));
  assert.ok(!markup.includes('c-header__search'), 'no search row');
  assert.ok(!markup.includes('c-header__below'), 'nothing under the bar');
  assert.match(markup, /<a class="btn btn--quiet btn--icon c-header__icon c-header__find" href="\/"/);
});
