// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ROLES, PLACEMENTS, REVIEW_STATES, LIVE_WINDOW_DAYS, LIVE_PATTERNS } from '../../src/domain/constants.js';

test('ROLES is unchanged by extending the file', () => {
  assert.deepEqual(ROLES, ['host', 'fan', 'speaker', 'crowd']);
});

test('PLACEMENTS lists the four placements', () => {
  assert.deepEqual(PLACEMENTS, ['event', 'shared_story', 'post', 'unsorted']);
});

test('REVIEW_STATES lists the three review states', () => {
  assert.deepEqual(REVIEW_STATES, ['pending', 'published', 'rejected']);
});

test('LIVE_WINDOW_DAYS is 1', () => {
  assert.equal(LIVE_WINDOW_DAYS, 1);
});

test('LIVE_PATTERNS has the four built-in platform phrases', () => {
  assert.deepEqual(
    LIVE_PATTERNS.map((p) => [p.code, p.platformCode]),
    [
      ['tiktok live', 'tiktok'],
      ['ig live', 'instagram'],
      ['youtube live', 'youtube'],
      ['x space', 'x'],
    ],
  );
  assert.ok(LIVE_PATTERNS.every((p) => p.pattern instanceof RegExp));
});

test('LIVE_PATTERNS entries match the phrases they name', () => {
  assert.ok(LIVE_PATTERNS[0].pattern.test('TikTok Live'));
  assert.ok(LIVE_PATTERNS[1].pattern.test('IG live'));
  assert.ok(LIVE_PATTERNS[1].pattern.test('instagram Live'));
  assert.ok(LIVE_PATTERNS[2].pattern.test('YouTube live'));
  assert.ok(LIVE_PATTERNS[3].pattern.test('X Space'));
  assert.ok(LIVE_PATTERNS[3].pattern.test('Twitter Space'));
});
