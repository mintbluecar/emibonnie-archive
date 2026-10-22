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
import { EVENT_PATH_PREFIX, eventHref, slugFromEventPath } from '../../public/js/core/routes.js';

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
