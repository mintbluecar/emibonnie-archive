// @ts-check
/**
 * Plan 3 Task 11: the edit page notices a held entry -- the same banner
 * the item page shows, plus "save & publish", which saves the pending
 * changes and then publishes through the owner's review route.
 *
 * `start()` drives the real page against a mocked `fetch`, the same way
 * test/pages/item.test.js does for the item page.
 */
import '../helpers/siteFixture.js';
import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { MiniElement } from '../helpers/miniDom.js';
import { copyRe } from '../helpers/copyMarkup.js';
const { start } = await import('../../public/js/pages/edit.js');
const { t } = await import('../../public/js/core/site.js');

const SOURCE = '1900000000000000020';
const API = `/api/item/translation/${SOURCE}`;

const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

const OPTIONS = {
  people: [], roles: ['fan'], events: [{ id: 3, name: 'SOLLUNA HAPPY DAY', slug: 'happy', occurredOn: '2026-10-19' }],
  categories: [], clients: [],
};

/** @param {Partial<any>} [overrides] */
function editData(overrides = {}) {
  return {
    role: 'owner',
    fields: { placement: 'event', eventId: 3, categoryName: null, clientName: null, speakers: {}, lineFixes: [], subbed: false },
    parts: ['A: hello there'],
    lines: [{ part: 0, line: 0, kind: 'speech', marker: 'A', markers: ['A'], text: 'hello there', fixed: false }],
    unmapped: [],
    history: [],
    reviewState: 'pending',
    ...overrides,
  };
}

/** Every text node under `el`, ignoring `parentNode` (circular). @param {any} el @returns {string} */
function allText(el) {
  if (el.nodeType === 3) return el.textContent ?? '';
  return (el.children ?? []).map(allText).join(' ');
}

/** A page root and the globals `start()` needs. @returns {MiniElement} */
function pageRoot() {
  const root = new MiniElement('div');
  globalThis.document = /** @type {any} */ ({
    createElement: (/** @type {any} */ tag) => new MiniElement(tag),
    getElementById: (/** @type {string} */ id) => (id === 'app' ? root : null),
    title: '',
  });
  globalThis.window = /** @type {any} */ ({ location: { pathname: `/edit/translation/${SOURCE}`, href: `http://localhost/edit/translation/${SOURCE}`, search: '' } });
  globalThis.localStorage = /** @type {any} */ ({ getItem: () => null, setItem: () => {}, removeItem: () => {} });
  return root;
}

/**
 * The page's three endpoints. `publishStatus` lets a test fail the review
 * call; the edit payload's `reviewState` flips to `published` on success.
 * @param {Partial<any>} [overrides]
 */
function mockApi(overrides = {}) {
  /** @type {{ url: string, method: string, body: any }[]} */
  const calls = [];
  let reviewState = overrides.reviewState ?? 'pending';
  const publishStatus = overrides.publishStatus ?? 200;
  globalThis.fetch = /** @type {any} */ (async (/** @type {string} */ url, /** @type {any} */ init) => {
    const method = init?.method ?? 'GET';
    calls.push({ url: String(url), method, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (String(url) === '/api/me') return Response.json({ user: { via: 'x', handle: 'owner', isOwner: true, isTranslator: false, needsName: false } });
    if (String(url) === '/api/add/options') return Response.json(OPTIONS);
    if (String(url) === `${API}/edit` && method === 'GET') return Response.json(editData({ reviewState }));
    if (String(url) === `${API}/edit` && method === 'POST') return Response.json({ editId: 1 });
    if (String(url) === `/api/owner/items/translation/${SOURCE}/review` && method === 'POST') {
      if (publishStatus !== 200) return Response.json({ error: 'nope' }, { status: publishStatus });
      reviewState = 'published';
      return Response.json({ reviewState });
    }
    return Response.json({}, { status: 404 });
  });
  return calls;
}

/** Runs `body` with the page globals set, then cleans up. @param {() => Promise<void>} body */
async function withPage(body) {
  pageRoot();
  try {
    await body();
  } finally {
    mock.restoreAll();
    delete (/** @type {any} */ (globalThis)).document;
    delete (/** @type {any} */ (globalThis)).window;
    delete (/** @type {any} */ (globalThis)).localStorage;
  }
}

/** @returns {any} */
function app() {
  return globalThis.document.getElementById('app');
}

test('the edit page shows the held banner and save & publish only for a held entry', async () => {
  mockApi({ reviewState: 'pending' });
  await withPage(async () => {
    await start();
    assert.ok(app().querySelector('[data-held]'), 'the held banner');
    assert.match(allText(app().querySelector('[data-held]')), /only you can see this/);
    assert.ok(app().querySelector('[data-action="save-publish"]'), 'save & publish');
    assert.match(allText(app().querySelector('[data-action="save-publish"]')), copyRe(t('edit.saveAndPublish')));
  });
});

test('a published entry\'s edit page has neither the banner nor save & publish', async () => {
  mockApi({ reviewState: 'published' });
  await withPage(async () => {
    await start();
    assert.equal(app().querySelector('[data-held]'), null);
    assert.equal(app().querySelector('[data-action="save-publish"]'), null);
  });
});

test('save & publish saves the pending change, publishes, and drops the banner', async () => {
  const calls = mockApi({ reviewState: 'pending' });
  await withPage(async () => {
    await start();
    const placement = app().querySelector('[data-field="placement"]');
    placement.value = 'post';
    placement.dispatchEvent({ type: 'change', target: placement });
    await flush();
    app().querySelector('[data-action="save-publish"]').click();
    await flush(); await flush(); await flush(); await flush();

    const posts = calls.filter((call) => call.method === 'POST');
    assert.deepEqual(posts.map((call) => call.url), [`${API}/edit`, `/api/owner/items/translation/${SOURCE}/review`]);
    assert.deepEqual(posts[0].body, { changes: { placement: 'post' } });
    assert.deepEqual(posts[1].body, { state: 'published' });

    assert.equal(app().querySelector('[data-held]'), null, 'the banner is gone');
    assert.match(allText(app()), copyRe(t('edit.published')), 'the publication is reported');
  });
});

test('a failed publish keeps the entry held and says so', async () => {
  const calls = mockApi({ reviewState: 'pending', publishStatus: 403 });
  await withPage(async () => {
    await start();
    app().querySelector('[data-action="save-publish"]').click();
    await flush(); await flush(); await flush();

    assert.ok(calls.some((call) => call.url.endsWith('/review')), 'it tried to publish');
    assert.match(allText(app()), copyRe(t('edit.publishFailed')), 'the failure is reported');
    assert.ok(app().querySelector('[data-held]'), 'still held');
  });
});
