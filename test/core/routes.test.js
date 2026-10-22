// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EVENT_PATH_PREFIX, eventUrl } from '../../public/js/core/routes.js';

test('EVENT_PATH_PREFIX matches src/pages.js\'s event route', () => {
  assert.equal(EVENT_PATH_PREFIX, '/e/');
});

test('eventUrl: builds the event page path, encoding the slug', () => {
  assert.equal(eventUrl('solluna-happy-day-2026-10-19'), '/e/solluna-happy-day-2026-10-19');
  assert.equal(eventUrl('a b'), '/e/a%20b');
});
