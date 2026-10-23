// @ts-check
/** Task 10c (f): the theme choice -- stored per browser, shown on <html>, cycled light, dark, follow the device. */
import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import { storedChoice, storeChoice, showChoice, nextChoice, isDark, THEME_KEY } from '../../public/js/core/themeChoice.js';

const g = /** @type {any} */ (globalThis);
afterEach(() => { delete g.localStorage; delete g.document; delete g.window; });

/** @param {Record<string, string>} [items] */
function memoryStorage(items = {}) {
  return { getItem: (/** @type {string} */ k) => items[k] ?? null, setItem: (/** @type {string} */ k, /** @type {string} */ v) => { items[k] = v; }, removeItem: (/** @type {string} */ k) => { delete items[k]; }, items };
}

function fakeRoot() {
  /** @type {Record<string, string>} */
  const attrs = {};
  return { attrs, getAttribute: (/** @type {string} */ k) => attrs[k] ?? null, setAttribute: (/** @type {string} */ k, /** @type {string} */ v) => { attrs[k] = v; }, removeAttribute: (/** @type {string} */ k) => { delete attrs[k]; } };
}

test('the cycle is light, dark, follow the device, and round again', () => {
  assert.equal(nextChoice('light'), 'dark');
  assert.equal(nextChoice('dark'), 'system');
  assert.equal(nextChoice('system'), 'light');
});

test('stored per browser: light/dark are remembered, system forgets; anything else reads as system', () => {
  const storage = memoryStorage();
  g.localStorage = storage;
  storeChoice('dark');
  assert.equal(storage.items[THEME_KEY], 'dark');
  assert.equal(storedChoice(), 'dark');
  storeChoice('system');
  assert.equal(THEME_KEY in storage.items, false);
  storage.items[THEME_KEY] = 'neon';
  assert.equal(storedChoice(), 'system');
});

test('storage that throws (private window, blocked site data) never breaks it', () => {
  g.localStorage = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => { throw new Error('denied'); } };
  assert.equal(storedChoice(), 'system');
  assert.doesNotThrow(() => storeChoice('dark'));
  delete g.localStorage;
  assert.equal(storedChoice(), 'system', 'no localStorage at all');
});

test('showChoice sets data-theme for light/dark and removes it for system; isDark follows it, else the device', () => {
  const root = fakeRoot();
  g.document = { documentElement: root };
  g.window = { matchMedia: () => ({ matches: true }) };
  showChoice('light');
  assert.equal(root.attrs['data-theme'], 'light');
  assert.equal(isDark(), false, 'forced light beats a dark device');
  showChoice('dark');
  assert.equal(isDark(), true);
  showChoice('system');
  assert.equal('data-theme' in root.attrs, false);
  assert.equal(isDark(), true, 'the device decides');
  g.window = { matchMedia: () => ({ matches: false }) };
  assert.equal(isDark(), false);
});
