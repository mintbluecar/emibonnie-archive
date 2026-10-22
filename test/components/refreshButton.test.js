// @ts-check
import '../helpers/siteFixture.js';
import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { MiniElement, fakeDocument } from '../helpers/miniDom.js';
import { mount } from '../../public/js/core/dom.js';
// Dynamic import: see test/components/header.test.js for why.
const { render, bind } = await import('../../public/js/components/refreshButton.js');

const NOW = new Date('2026-10-19T08:00:00.000Z');
const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

/** A tiny fake localStorage, so tests don't depend on a real browser's. */
function fakeStorage() {
  const map = new Map();
  return {
    getItem: (/** @type {string} */ k) => map.get(k) ?? null,
    setItem: (/** @type {string} */ k, /** @type {string} */ v) => map.set(k, v),
    removeItem: (/** @type {string} */ k) => map.delete(k),
  };
}

test('render: shown only while editOpenUntil is in the future', () => {
  assert.match(String(render({ editOpenUntil: '2026-10-19T09:00:00.000Z', now: NOW })), /c-refresh__btn/);
  assert.equal(String(render({ editOpenUntil: '2026-10-19T07:00:00.000Z', now: NOW })), '');
  assert.equal(String(render({ editOpenUntil: null, now: NOW })), '');
});

test('render: shows "editable until" via timePair', () => {
  const markup = String(render({ editOpenUntil: '2026-10-19T09:00:00.000Z', now: NOW }));
  assert.match(markup, /editable until/);
});

/** @returns {{ root: any, fetchCalls: string[] }} */
function setUp(editOpenUntil = '2026-10-19T09:00:00.000Z') {
  const root = new MiniElement('div');
  mount(root, render({ editOpenUntil, now: NOW }));
  globalThis.document = fakeDocument();
  /** @type {string[]} */
  const fetchCalls = [];
  return { root, fetchCalls };
}

test('bind: a press POSTs to the refresh endpoint and calls onUpdated when updated > 0', async () => {
  const { root, fetchCalls } = setUp();
  (/** @type {any} */ (globalThis)).localStorage = fakeStorage();
  mock.method(globalThis, 'fetch', async (/** @type {string} */ url, /** @type {any} */ opts) => {
    fetchCalls.push(`${opts.method} ${url}`);
    return new Response(JSON.stringify({ updated: 2, editOpenUntil: null }), { status: 200 });
  });
  /** @type {any[]} */
  const updates = [];
  try {
    bind(root, { kind: 'translation', sourceId: '1900000000000000011' }, (r) => updates.push(r));
    const btn = /** @type {any} */ (root.querySelector('.c-refresh__btn'));
    btn.click();
    await flush();
    assert.deepEqual(fetchCalls, ['POST /api/item/translation/1900000000000000011/refresh']);
    assert.deepEqual(updates, [{ updated: 2, editOpenUntil: null }]);
  } finally {
    mock.restoreAll();
    delete (/** @type {any} */ (globalThis)).document;
    delete (/** @type {any} */ (globalThis)).localStorage;
  }
});

test('bind: the button locks after a press and disables itself', async () => {
  const { root } = setUp();
  (/** @type {any} */ (globalThis)).localStorage = fakeStorage();
  mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ updated: 0, editOpenUntil: null, throttled: true }), { status: 200 }));
  try {
    bind(root, { kind: 'translation', sourceId: '1900000000000000012' }, () => {});
    const btn = /** @type {any} */ (root.querySelector('.c-refresh__btn'));
    assert.equal(btn.disabled, false);
    btn.click();
    assert.equal(btn.disabled, true, 'locks immediately, before the fetch even resolves');
    await flush();
  } finally {
    mock.restoreAll();
    delete (/** @type {any} */ (globalThis)).document;
    delete (/** @type {any} */ (globalThis)).localStorage;
  }
});

test('bind: a disabled (locked) button ignores further clicks', async () => {
  const { root } = setUp();
  (/** @type {any} */ (globalThis)).localStorage = fakeStorage();
  let fetchCount = 0;
  mock.method(globalThis, 'fetch', async () => { fetchCount += 1; return new Response(JSON.stringify({ updated: 0, editOpenUntil: null }), { status: 200 }); });
  try {
    bind(root, { kind: 'translation', sourceId: '1900000000000000013' }, () => {});
    const btn = /** @type {any} */ (root.querySelector('.c-refresh__btn'));
    btn.click();
    await flush();
    btn.click();
    await flush();
    assert.equal(fetchCount, 1);
  } finally {
    mock.restoreAll();
    delete (/** @type {any} */ (globalThis)).document;
    delete (/** @type {any} */ (globalThis)).localStorage;
  }
});

test('bind: a 409 removes the button', async () => {
  const { root } = setUp();
  (/** @type {any} */ (globalThis)).localStorage = fakeStorage();
  mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ error: 'edit_window_closed' }), { status: 409 }));
  try {
    bind(root, { kind: 'translation', sourceId: '1900000000000000014' }, () => {});
    const btn = /** @type {any} */ (root.querySelector('.c-refresh__btn'));
    btn.click();
    await flush();
    assert.equal(root.querySelector('.c-refresh'), null);
  } finally {
    mock.restoreAll();
    delete (/** @type {any} */ (globalThis)).document;
    delete (/** @type {any} */ (globalThis)).localStorage;
  }
});

test('bind: localStorage throwing falls back to in-memory state without crashing', async () => {
  const { root } = setUp();
  (/** @type {any} */ (globalThis)).localStorage = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
  };
  mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ updated: 0, editOpenUntil: null }), { status: 200 }));
  try {
    bind(root, { kind: 'translation', sourceId: '1900000000000000015' }, () => {});
    const btn = /** @type {any} */ (root.querySelector('.c-refresh__btn'));
    assert.doesNotThrow(() => btn.click());
    await flush();
  } finally {
    mock.restoreAll();
    delete (/** @type {any} */ (globalThis)).document;
    delete (/** @type {any} */ (globalThis)).localStorage;
  }
});
