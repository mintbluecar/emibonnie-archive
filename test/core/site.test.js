// @ts-check
/**
 * `public/js/core/site.js` imports the absolute specifier `/site/site.js`
 * (the file `scripts/build.js` writes into `public/site/`, served at that
 * path; see docs/site-settings.md). Node has no such file on disk, so a
 * synchronous resolve hook redirects just that one specifier to a fixture
 * before the module is ever imported, letting this test exercise the real
 * module (not a reimplementation of its logic).
 */
import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '/site/site.js') {
      return { url: new URL('../fixtures/core/site.js', import.meta.url).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const { site, t, tCount } = await import('../../public/js/core/site.js');

test('site: re-exports the public site object from /site/site.js', () => {
  assert.equal(site.name, 'fixture archive');
  assert.equal(site.timezone, 'Asia/Bangkok');
});

test('t: looks up a known copy key', () => {
  assert.equal(t('nav.home'), 'home');
});

test('t: substitutes {vars} into the template', () => {
  assert.equal(t('search.showN', { n: 3 }), 'show 3');
});

test('tCount: picks .one for n === 1, .other otherwise, and n is always available as {n} (review round 1, M1)', () => {
  assert.equal(tCount('demo.count', 1), '1 thing');
  assert.equal(tCount('demo.count', 0), '0 things');
  assert.equal(tCount('demo.count', 2), '2 things');
});

test('tCount: extra vars are merged alongside n', () => {
  assert.equal(tCount('demo.count', 1, { ignored: 'x' }), '1 thing');
});

test('t: a missing key warns on the console and returns the key itself', () => {
  mock.method(console, 'warn', () => {});
  try {
    assert.equal(t('nope.missing'), 'nope.missing');
    assert.equal(console.warn.mock.calls.length, 1);
  } finally {
    mock.restoreAll();
  }
});
