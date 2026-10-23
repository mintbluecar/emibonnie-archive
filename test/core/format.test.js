// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { monthLabel, dayLabel } from '../../public/js/core/format.js';

test('labels', () => {
  assert.equal(monthLabel('2026-10'), 'october 2026');
  assert.equal(dayLabel('2026-10-14'), '14 Oct 2026');
});

test('dayLabel: no leading zero on the day', () => {
  assert.equal(dayLabel('2026-01-02'), '2 Jan 2026');
});
