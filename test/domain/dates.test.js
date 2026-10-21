// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { localDate, localYear, daysBetween } from '../../src/domain/dates.js';

test('localDate: 17:30 UTC crosses into the next Bangkok (+7) day', () => {
  assert.equal(localDate('2026-02-12T17:30:00Z', 'Asia/Bangkok'), '2026-02-13');
});

test('localDate: 16:59 UTC is still the same Bangkok day', () => {
  assert.equal(localDate('2026-02-12T16:59:00Z', 'Asia/Bangkok'), '2026-02-12');
});

test('daysBetween: across a month boundary', () => {
  assert.equal(daysBetween('2026-01-31', '2026-02-01'), 1);
  assert.equal(daysBetween('2026-02-01', '2026-01-31'), -1);
});

test('daysBetween: same date is zero', () => {
  assert.equal(daysBetween('2026-02-12', '2026-02-12'), 0);
});

test('localYear: New Year\'s Eve UTC evening is already New Year in Bangkok', () => {
  assert.equal(localYear('2025-12-31T18:00:00Z', 'Asia/Bangkok'), 2026);
  assert.equal(localYear('2025-12-31T18:00:00Z', 'UTC'), 2025);
});
