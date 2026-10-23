// @ts-check
/**
 * DOM-free tests of `composeAccount`/`composeOptedOut` (pure:
 * `AccountView`|`OptedOutAccountView` -> `SafeHtml`), on a snapshot of
 * the real `/api/account/:handle` response for tl_alpha (same source as
 * `test/pages/person.test.js`'s fixtures: `personView()`/`accountView()`
 * against the seeded example site). tl_alpha's own 4 items already cover
 * all three group kinds (an event, a shared story, a standalone post),
 * so one fixture does the job here.
 */
import '../helpers/siteFixture.js';
import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { readFileSync } from 'node:fs';
// Dynamic import: see test/components/header.test.js for why.
const { composeAccount, composeOptedOut, bind, start } = await import('../../public/js/pages/account.js');
const { MiniElement, fakeDocument } = await import('../helpers/miniDom.js');
const { mount } = await import('../../public/js/core/dom.js');

const ACCOUNT = JSON.parse(readFileSync(new URL('../snapshots/account.json', import.meta.url), 'utf8'));
/** One macrotask tick, enough for a mocked fetch's `.then()` chain to settle. */
const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

test('composeAccount: the handle, an "open profile" link, and totals', () => {
  const markup = String(composeAccount(ACCOUNT));
  assert.match(markup, /<h1 class="c-account__handle">@tl_alpha<\/h1>/);
  assert.match(markup, /<a class="c-account__open-profile" href="https:\/\/x\.com\/tl_alpha"[^>]*>open profile ↗<\/a>/);
  assert.match(markup, /4 translations/);
});

test('composeAccount: no "open profile" link when the matched kind defines no profileUrl (review round 1, I3)', () => {
  const accountWithoutProfile = { handle: ACCOUNT.account.handle, displayName: ACCOUNT.account.displayName };
  const markup = String(composeAccount({ ...ACCOUNT, account: accountWithoutProfile }));
  assert.ok(!markup.includes('c-account__open-profile'));
  assert.ok(!markup.includes('x.com'), 'never a hardcoded platform link');
});

test('composeAccount: the segmented control has no "with…" (there is no second translator to combine with)', () => {
  const markup = String(composeAccount(ACCOUNT));
  assert.match(markup, /by event/);
  assert.match(markup, /all, newest/);
  assert.ok(!markup.includes('with…'));
});

test('composeAccount: grouped by event, a shared story, and a post', () => {
  const markup = String(composeAccount(ACCOUNT));
  assert.match(markup, /SOLLUNA AT STARFEST · 18 Oct 2026/);
  assert.match(markup, /luna tiktok live · 12 Feb 2026/);
  assert.match(markup, /<h2 class="c-hub-group__label">shared story · 2 Mar 2026<\/h2>/);
  assert.match(markup, /<h2 class="c-hub-group__label">posts<\/h2>/);
});

test('composeOptedOut: only account.optedOut, and nothing else from the page', () => {
  const markup = String(composeOptedOut());
  assert.match(markup, /this translator has opted out/);
  assert.ok(!markup.includes('c-hub__seg'), 'no segmented control');
  assert.ok(!markup.includes('c-hub-group'), 'no groups');
  assert.ok(!markup.includes('c-account__handle'), 'not even the handle');
});

test('composeOptedOut: still the page shell (header/tab bar/footer), just with the opted-out message as its only content', () => {
  const markup = String(composeOptedOut());
  assert.match(markup, /c-header--compact/);
  assert.match(markup, /c-tabbar/);
  assert.match(markup, /c-empty-state__message">this translator has opted out/);
});

test('bind: switching to "all, newest" re-renders flat, without a group label', () => {
  const root = new MiniElement('div');
  mount(root, composeAccount(ACCOUNT));
  globalThis.document = fakeDocument();
  bind(root, ACCOUNT, 'tl_alpha');
  const allChip = /** @type {any} */ (root.querySelector('.c-hub__seg .c-chips__chip[data-value="all"]'));
  allChip.click();
  const content = /** @type {any} */ (root.querySelector('.c-hub__content'));
  assert.equal(content.querySelectorAll('.c-hub-group__label').length, 0, 'flat view has no group labels');
  assert.ok(content.querySelector('a[href="/t/1900000000000000005"]'), 'the shared-story entry is still there, just ungrouped');
  delete (/** @type {any} */ (globalThis)).document;
});

function cleanup() {
  delete (/** @type {any} */ (globalThis)).document;
  delete (/** @type {any} */ (globalThis)).window;
  mock.restoreAll();
}

test('bind: "more" fetches the kind\'s next page with the right offset, appends, and re-renders (review round 1, I1)', async () => {
  const paged = { ...ACCOUNT, sections: [{ ...ACCOUNT.sections[0], total: 20, hasMore: true }] };
  const root = new MiniElement('div');
  mount(root, composeAccount(paged));
  globalThis.document = fakeDocument();
  bind(root, paged, 'tl_alpha');
  try {
    const nextPage = { sections: [{ kind: 'translation', total: 20, hasMore: false, items: [{ ...ACCOUNT.sections[0].items[0], sourceId: 'NEW_ITEM', url: '/t/NEW_ITEM' }] }] };
    /** @type {string[]} */
    const calls = [];
    mock.method(globalThis, 'fetch', async (/** @type {any} */ url) => {
      calls.push(String(url));
      return new Response(JSON.stringify(nextPage), { status: 200 });
    });
    const more = /** @type {any} */ (root.querySelector('.c-hub__more'));
    assert.ok(more, 'a "more" button is rendered when a section hasMore');
    more.click();
    await flush();
    assert.match(calls[0], /\/api\/account\/tl_alpha\?offset=4/, `expected offset=4 (the 4 items already loaded), got ${calls[0]}`);
    assert.ok(root.querySelector('a[href="/t/NEW_ITEM"]'), 'the newly fetched item is now rendered');
    assert.ok(!root.querySelector('.c-hub__more'), 'no more button once hasMore is false');
  } finally {
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

/** Every text node under `el`, ignoring `parentNode` (circular). @param {any} el @returns {string} */
function allText(el) {
  if (el.nodeType === 3) return el.textContent ?? '';
  return (el.children ?? []).map(allText).join(' ');
}

test('start: an opted-out account\'s title and DOM contain no handle (review round 1, M2)', async () => {
  const root = mountedStart('/tl/tl_gamma');
  mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ account: { handle: 'tl_gamma', optedOut: true } }), { status: 200 }));
  try {
    await start();
    assert.ok(!globalThis.document.title.includes('tl_gamma'), `title leaked the handle: ${globalThis.document.title}`);
    assert.ok(!allText(root).includes('tl_gamma'), 'no handle anywhere in the rendered DOM');
    assert.ok(!root.querySelector('.c-account__handle'), 'not even the handle element');
    assert.match(root.querySelector('.c-empty-state__message')?.children?.[0]?.textContent ?? '', /this translator has opted out/);
  } finally {
    cleanup();
  }
});

test('start: a 404 from the API renders account.notFound', async () => {
  const root = mountedStart('/tl/nobody-here');
  mock.method(globalThis, 'fetch', async () => new Response('not found', { status: 404 }));
  try {
    await start();
    assert.match(root.querySelector('.c-empty-state__message')?.children?.[0]?.textContent ?? '', /translator not found/);
  } finally {
    cleanup();
  }
});

test('start: a non-404 failure renders the generic page.loadFailed fallback, never throws (review round 1, I5)', async () => {
  const root = mountedStart('/tl/tl_alpha');
  mock.method(globalThis, 'fetch', async () => { throw new Error('network down'); });
  try {
    await start();
    assert.match(root.querySelector('.c-empty-state__message')?.children?.[0]?.textContent ?? '', /something went wrong, try again/);
  } finally {
    cleanup();
  }
});

test('start: redirectTo replaces the page at accountHref(redirectTo)', async () => {
  const root = mountedStart('/tl/gamma_old');
  /** @type {string[]} */
  const replaced = [];
  globalThis.window.location.replace = (/** @type {string} */ url) => replaced.push(url);
  mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ ...ACCOUNT, redirectTo: 'gamma_renamed' }), { status: 200 }));
  try {
    await start();
    assert.deepEqual(replaced, ['/tl/gamma_renamed']);
    assert.equal(root.children.length, 0, 'the page was never mounted -- redirectTo short-circuits before that');
  } finally {
    cleanup();
  }
});

test('composeAccount (Task 9b): entries are compact previews, not full bubbles', () => {
  const markup = String(composeAccount(ACCOUNT));
  assert.match(markup, /c-preview-card--compact/);
  assert.ok(!markup.includes('c-bubbles__bub'));
});

test('composeAccount (Task 10d): searches within this translator -- the box names them, preset as a removable chip; the opted-out page has no box', () => {
  const markup = String(composeAccount(ACCOUNT));
  const handle = ACCOUNT.account.handle;
  assert.ok(markup.includes(`placeholder="search @${handle}…"`));
  assert.ok(markup.includes(`data-field="account" data-value="${handle}"`));
  assert.match(markup, /<div class="c-search__list">[\s\S]*c-hub__seg/);
  assert.ok(!String(composeOptedOut()).includes('c-header__search-box'));
});
