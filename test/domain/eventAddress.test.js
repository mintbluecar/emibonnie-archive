// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addressOf, addressPath, addressTagOf, defaultAddressTag, slugPart, withClashSuffix } from '../../src/domain/eventAddress.js';

test('addressOf: the date, then the tag slugified', () => {
  assert.equal(addressOf({ occurredOn: '2025-12-04', addressTag: 'juniper tiktok live' }), '2025-12-04/juniper-tiktok-live');
  assert.equal(addressOf({ occurredOn: '2025-10-04', addressTag: 'MoonFest26xJuniperTomas' }), '2025-10-04/moonfest26xjunipertomas');
});

test('addressOf: a tag with no Latin letters falls back to "event"', () => {
  assert.equal(addressOf({ occurredOn: '2025-12-04', addressTag: 'ไลฟ์' }), '2025-12-04/event');
});

test('withClashSuffix: numbers the tag half, "-2", "-3"…', () => {
  assert.equal(withClashSuffix('2025-12-04/event', new Set(['2025-12-04/event'])), '2025-12-04/event-2');
  assert.equal(withClashSuffix('d/x', new Set(['d/x', 'd/x-2'])), 'd/x-3');
});

test('withClashSuffix: an address not taken is returned unchanged', () => {
  assert.equal(withClashSuffix('2025-12-04/event', new Set()), '2025-12-04/event');
});

test('defaultAddressTag: the first hashtag, else the name', () => {
  assert.equal(defaultAddressTag({ hashtags: [], name: 'juniper tiktok live' }), 'juniper tiktok live');
  assert.equal(defaultAddressTag({ hashtags: ['ANY', 'JuniperAny'], name: 'juniper tiktok live' }), 'ANY');
});

test('addressTagOf: the part after the slash, or null for a one-part slug', () => {
  assert.equal(addressTagOf('2025-12-04/x'), 'x');
  assert.equal(addressTagOf('old-slug'), null);
});

test('slugPart: lower-cases, strips diacritics, collapses runs of non-alphanumerics', () => {
  assert.equal(slugPart('Juniper Tiktok Live'), 'juniper-tiktok-live');
  assert.equal(slugPart('Café!!'), 'cafe');
});

test('slugPart: nothing left (e.g. all Thai) falls back to "event"', () => {
  assert.equal(slugPart('ไลฟ์'), 'event');
});

test('addressPath: each part of a slug encoded, the slash between them kept', () => {
  assert.equal(addressPath('2025-12-04/juniper-tiktok-live'), '2025-12-04/juniper-tiktok-live');
  assert.equal(addressPath('2025-12-04/a b'), '2025-12-04/a%20b');
  assert.equal(addressPath('2025-12-04/a/b'), '2025-12-04/a%2Fb', 'only the first / separates');
});
