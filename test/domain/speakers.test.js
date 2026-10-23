// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveSpeakers, missingMarkers, personIdsFrom } from '../../src/domain/speakers.js';

const SOL = 1;
const LUNA = 2;
const PEOPLE = [
  { id: SOL, igHandle: 'solsunny' },
  { id: LUNA, igHandle: 'lunamoon' },
];

/** @param {string[]} markers */
function used(markers) {
  return markers.map((marker) => ({ marker, count: 1 }));
}

test('layering: defaults, then remembered, then chosen', () => {
  const map = resolveSpeakers({
    defaults: { '☀️': { personHandle: 'solsunny' }, '🌙': { personHandle: 'lunamoon' }, '💬': { role: 'fan' } },
    people: PEOPLE,
    remembered: { '🌙': { person: SOL }, '🦁': { role: 'host' } },
    chosen: { '🦁': { person: LUNA } },
  });
  assert.deepEqual(map, {
    '☀️': { person: SOL },
    '🌙': { person: SOL },
    '💬': { role: 'fan' },
    '🦁': { person: LUNA },
  });
});

test('a default handle matches case-insensitively and with a leading @', () => {
  const map = resolveSpeakers({ defaults: { '☀️': { personHandle: '@SolSunny' } }, people: PEOPLE });
  assert.deepEqual(map, { '☀️': { person: SOL } });
});

test('unknown default handles are skipped', () => {
  const map = resolveSpeakers({ defaults: { '⭐': { personHandle: 'nobody' }, '🌙': { personHandle: 'lunamoon' } }, people: PEOPLE });
  assert.deepEqual(map, { '🌙': { person: LUNA } });
});

test('missingMarkers: the used markers with no entry in the map, in order', () => {
  const missing = missingMarkers(used(['🦁', '☀️', '🐱']), { '☀️': { person: SOL } });
  assert.deepEqual(missing.map((m) => m.marker), ['🦁', '🐱']);
});

test('personIdsFrom: only the used markers, unique, roles ignored', () => {
  const map = { '☀️': { person: SOL }, '🌞': { person: SOL }, '🌙': { person: LUNA }, '💬': { role: /** @type {const} */ ('fan') } };
  assert.deepEqual(personIdsFrom(map, used(['☀️', '🌞', '💬'])), [SOL]);
});
