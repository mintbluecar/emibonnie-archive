// @ts-check
/**
 * Task 10 (review-fixes): the add page's step 3 (speakers) renders its
 * save button through `speakerStep`, but both `addDetails.bind` and
 * `speakerStep.bind` were wired to the page's `save()` on the same
 * `[data-action="save"]` delegation root -- one click fired both
 * listeners and sent two `POST /api/add`. `start()` drives the real page
 * against a mocked `fetch`, the same way `test/pages/edit.test.js` does.
 */
import '../helpers/siteFixture.js';
import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { MiniElement } from '../helpers/miniDom.js';
import { withGlobals } from '../helpers/globals.js';
const { start } = await import('../../public/js/pages/add.js');

const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

const OPTIONS = {
  people: [], roles: ['fan'], events: [{ id: 3, name: 'SOLLUNA HAPPY DAY', slug: 'happy', occurredOn: '2026-10-19' }],
  categories: [], clients: [],
};

/** A ready preview: one unmapped marker, step 3 renders its own Save button. */
const PREVIEW = {
  status: 'ready',
  draft: {
    common: { placement: 'event', eventId: 3, categoryName: null, clientName: null, proposal: null },
    subbed: false, markers: [{ marker: 'A', count: 1 }], speakers: {}, memory: {},
  },
  lines: [{ part: 0, line: 0, kind: 'speech', marker: 'A', markers: ['A'], text: 'hello there', fixed: false }],
  unmapped: [],
  media: null,
};

/** The `fetch` the next `withPage` runs with, set by `mockApi`. @type {typeof fetch} */
let currentFetch = /** @type {any} */ (async () => Response.json({}, { status: 404 }));

/**
 * The page's endpoints. `POST /api/add` never returns a `url`, so `save()`
 * never navigates away -- it only matters that it was called once.
 * @returns {{ url: string, method: string, body: any }[]}
 */
function mockApi() {
  /** @type {{ url: string, method: string, body: any }[]} */
  const calls = [];
  currentFetch = /** @type {any} */ (async (/** @type {string} */ url, /** @type {any} */ init) => {
    const method = init?.method ?? 'GET';
    calls.push({ url: String(url), method, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (String(url) === '/api/me') return Response.json({ user: { via: 'x', handle: 'member', isOwner: false, isTranslator: false, needsName: false } });
    if (String(url) === '/api/add/options') return Response.json(OPTIONS);
    if (String(url) === '/api/add/preview' && method === 'POST') return Response.json(PREVIEW);
    if (String(url) === '/api/add' && method === 'POST') return Response.json({ status: 'pending', pending: true });
    return Response.json({}, { status: 404 });
  });
  return calls;
}

/** Runs `body` with the page globals (including the `fetch` `mockApi` set) in place, then restores them. @param {() => Promise<void>} body */
async function withPage(body) {
  const root = new MiniElement('div');
  await withGlobals({
    document: /** @type {any} */ ({
      createElement: (/** @type {any} */ tag) => new MiniElement(tag),
      getElementById: (/** @type {string} */ id) => (id === 'app' ? root : null),
      title: '',
    }),
    window: /** @type {any} */ ({ location: { pathname: '/add', href: 'http://localhost/add', search: '' } }),
    localStorage: /** @type {any} */ ({ getItem: () => null, setItem: () => {}, removeItem: () => {} }),
    fetch: currentFetch,
  }, async () => {
    try {
      await body();
    } finally {
      mock.restoreAll();
    }
  });
}

/** @returns {any} */
function app() {
  return globalThis.document.getElementById('app');
}

/** Drives the page from the pasted link through to step 3 (speakers), where the only Save button lives. */
async function toSpeakersStep() {
  await start();
  const form = app().querySelector('[data-add-form]');
  const input = app().querySelector('[id="c-add-url"]');
  input.value = 'https://example.com/post/1';
  form.dispatchEvent({ type: 'submit', target: form, preventDefault: () => {} });
  await flush();
  app().querySelector('[data-action="next"]').click();
}

test('one save click on the speakers step sends one POST /api/add', async () => {
  const calls = mockApi();
  await withPage(async () => {
    await toSpeakersStep();
    assert.equal(app().querySelectorAll('[data-action="save"]').length, 1, 'only one Save button is on screen');

    app().querySelector('[data-action="save"]').click();
    await flush();

    const saves = calls.filter((call) => call.url === '/api/add' && call.method === 'POST');
    assert.equal(saves.length, 1, `exactly one POST /api/add, got ${saves.length}`);
  });
});
