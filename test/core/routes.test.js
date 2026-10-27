// @ts-check
/**
 * `public/js/core/routes.js` is the front-end's one copy of the event
 * path prefix; this test (crossing layers -- tests may import both
 * `src/**` and `public/js/**`, unlike runtime code) pins it against
 * `src/pages.js`'s real `/e/:slug` route, so the two can't silently
 * drift apart (review round 2).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pages } from '../../src/pages.js';
import {
  EVENT_PATH_PREFIX, eventHref, slugFromEventPath,
  PERSON_PATH_PREFIX, personHref, igFromPersonPath,
  ACCOUNT_PATH_PREFIX, accountHref, accountFromAccountPath,
  EDIT_PATH_PREFIX, editHref,
} from '../../public/js/core/routes.js';

test('EVENT_PATH_PREFIX matches the /e/:slug page route in src/pages.js', () => {
  const eventPage = pages.find((p) => p.path === '/e/:slug');
  assert.ok(eventPage, 'src/pages.js lists an /e/:slug route');
  assert.ok(eventPage?.path.startsWith(EVENT_PATH_PREFIX), `${eventPage?.path} should start with ${EVENT_PATH_PREFIX}`);
  assert.equal(EVENT_PATH_PREFIX, '/e/');
});

test('eventHref: builds the event page path, encoding the slug', () => {
  assert.equal(eventHref('solluna-happy-day-2026-10-19'), '/e/solluna-happy-day-2026-10-19');
  assert.equal(eventHref('a b'), '/e/a%20b');
});

test('slugFromEventPath: reads the slug back out of an event page pathname, else null', () => {
  assert.equal(slugFromEventPath('/e/solluna-happy-day-2026-10-19'), 'solluna-happy-day-2026-10-19');
  assert.equal(slugFromEventPath('/e/a%20b'), 'a b');
  assert.equal(slugFromEventPath('/e/a-slug/extra'), 'a-slug', 'stops at the next /');
  assert.equal(slugFromEventPath('/t/123'), null);
  assert.equal(slugFromEventPath('/'), null);
});

test('eventHref and slugFromEventPath round-trip', () => {
  assert.equal(slugFromEventPath(eventHref('some-event-2026-01-01')), 'some-event-2026-01-01');
});

test('PERSON_PATH_PREFIX matches the /p/:ig page route in src/pages.js', () => {
  const personPage = pages.find((p) => p.path === '/p/:ig');
  assert.ok(personPage, 'src/pages.js lists a /p/:ig route');
  assert.ok(personPage?.path.startsWith(PERSON_PATH_PREFIX), `${personPage?.path} should start with ${PERSON_PATH_PREFIX}`);
  assert.equal(PERSON_PATH_PREFIX, '/p/');
});

test('ACCOUNT_PATH_PREFIX matches the /tl/:handle page route in src/pages.js', () => {
  const accountPage = pages.find((p) => p.path === '/tl/:handle');
  assert.ok(accountPage, 'src/pages.js lists a /tl/:handle route');
  assert.ok(accountPage?.path.startsWith(ACCOUNT_PATH_PREFIX), `${accountPage?.path} should start with ${ACCOUNT_PATH_PREFIX}`);
  assert.equal(ACCOUNT_PATH_PREFIX, '/tl/');
});

test('EDIT_PATH_PREFIX matches the /edit/:kind/:sourceId page route in src/pages.js', () => {
  const editPage = pages.find((p) => p.path === '/edit/:kind/:sourceId');
  assert.ok(editPage, 'src/pages.js lists an /edit/:kind/:sourceId route');
  assert.ok(editPage?.path.startsWith(EDIT_PATH_PREFIX), `${editPage?.path} should start with ${EDIT_PATH_PREFIX}`);
  assert.equal(EDIT_PATH_PREFIX, '/edit/');
});

test('editHref: builds the edit page path, encoding the kind and the source id', () => {
  assert.equal(editHref('translation', '123'), '/edit/translation/123');
  assert.equal(editHref('translation', 'a b'), '/edit/translation/a%20b');
});

test('personHref/igFromPersonPath: builds and parses the person page path, encoding/decoding the handle', () => {
  assert.equal(personHref('lunamoon'), '/p/lunamoon');
  assert.equal(personHref('a b'), '/p/a%20b');
  assert.equal(igFromPersonPath('/p/lunamoon'), 'lunamoon');
  assert.equal(igFromPersonPath('/p/a%20b'), 'a b');
  assert.equal(igFromPersonPath('/p/a-ig/extra'), 'a-ig', 'stops at the next /');
  assert.equal(igFromPersonPath('/tl/tl_alpha'), null);
  assert.equal(igFromPersonPath('/'), null);
  assert.equal(igFromPersonPath(personHref('lunamoon')), 'lunamoon');
});

test('accountHref/accountFromAccountPath: builds and parses the translator page path, encoding/decoding the handle', () => {
  assert.equal(accountHref('tl_alpha'), '/tl/tl_alpha');
  assert.equal(accountFromAccountPath('/tl/tl_alpha'), 'tl_alpha');
  assert.equal(accountFromAccountPath('/tl/tl_alpha/extra'), 'tl_alpha', 'stops at the next /');
  assert.equal(accountFromAccountPath('/p/lunamoon'), null);
  assert.equal(accountFromAccountPath(accountHref('tl_alpha')), 'tl_alpha');
});

test('Task 10b: every static page path in routes.js is exactly a src/pages.js route -- no trailing slash', async () => {
  const routes = await import('../../public/js/core/routes.js');
  const paths = new Set(pages.map((p) => p.path));
  for (const name of ['HOME_PATH', 'ABOUT_PATH', 'PRIVACY_PATH', 'TAKEDOWN_PATH', 'ADD_PATH', 'ME_PATH']) {
    const value = /** @type {any} */ (routes)[name];
    assert.ok(paths.has(value), `${name} (${value}) is a src/pages.js route`);
    assert.ok(value === '/' || !value.endsWith('/'), `${name} has no trailing slash`);
  }
});

test('Task 10d: no SEARCH_PATH or searchHref any more; withQuery puts a query on any page path', async () => {
  const routes = await import('../../public/js/core/routes.js');
  assert.equal(/** @type {any} */ (routes).SEARCH_PATH, undefined);
  assert.ok(!pages.some((p) => p.path === '/search'), '/search is not a page');
  assert.equal(/** @type {any} */ (routes).searchHref, undefined);
  assert.equal(routes.withQuery('/', new URLSearchParams({ q: 'a b' })), '/?q=a+b');
  assert.equal(routes.withQuery('/e/x', 'q=hi'), '/e/x?q=hi');
  assert.equal(routes.withQuery('/p/y', new URLSearchParams()), '/p/y');
});
