// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchRoute, unnamedSource } from '../../src/http/router.js';

test('matchRoute extracts params and method', () => {
  const routes = [
    { method: 'GET', path: '/api/event/:slug' },
    { method: 'POST', path: '/api/report' },
  ];
  const match = matchRoute(routes, 'GET', '/api/event/abc-2026-01-01');
  assert.deepEqual(match?.params, { slug: 'abc-2026-01-01' });
  assert.equal(matchRoute(routes, 'GET', '/api/report'), null);
});

test('matchRoute returns null when nothing matches', () => {
  const routes = [{ method: 'GET', path: '/api/event/:slug' }];
  assert.equal(matchRoute(routes, 'GET', '/api/nope'), null);
  assert.equal(matchRoute(routes, 'GET', '/api/event/a/b'), null);
});

test('matchRoute is strict about the method', () => {
  const routes = [{ method: 'GET', path: '/api/ping' }];
  assert.equal(matchRoute(routes, 'POST', '/api/ping'), null);
});

test('unnamedSource turns every :param into an unnamed group, so Vercel adds no query params', () => {
  assert.equal(unnamedSource('/e/:slug'), '/e/(.*)');
  assert.equal(unnamedSource('/t/:sourceId'), '/t/(.*)');
  assert.equal(unnamedSource('/a/:x/b/:y'), '/a/(.*)/b/(.*)');
  assert.equal(unnamedSource('/search'), '/search');
});
