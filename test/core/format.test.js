// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { monthLabel, dayLabel, timePair, cityOf } from '../../public/js/core/format.js';

test('labels', () => {
  assert.equal(monthLabel('2026-10'), 'october 2026');
  assert.equal(dayLabel('2026-10-14'), '14 Oct 2026');
});

test('dayLabel: no leading zero on the day', () => {
  assert.equal(dayLabel('2026-01-02'), '2 Jan 2026');
});

test('cityOf: last segment, lowercased, underscores to spaces', () => {
  assert.equal(cityOf('Asia/Bangkok'), 'bangkok');
  assert.equal(cityOf('America/Los_Angeles'), 'los angeles');
});

test('timePair', () => {
  assert.equal(timePair('2026-02-12T15:00:00Z', 'Asia/Bangkok', 'Europe/Paris'), '4:00 pm paris · 10:00 pm bangkok');
  assert.equal(timePair('2026-02-12T15:00:00Z', 'Asia/Bangkok', 'Asia/Bangkok'), '10:00 pm bangkok');
});

test('timePair: defaults the viewer zone to the runtime zone', () => {
  const runtimeTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  assert.equal(timePair('2026-02-12T15:00:00Z', runtimeTz), timePair('2026-02-12T15:00:00Z', runtimeTz, runtimeTz));
});
