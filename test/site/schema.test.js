// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { validateSite } from '../../src/site/schema.js';

/** @returns {any} */
function readFixture(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

test('validateSite: the example site (examples/solluna) validates', () => {
  const result = validateSite(readFixture('examples/solluna/site.json'));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.site.name, 'solluna archive');
  assert.equal(result.site.featuredPeople.length, 2);
  assert.equal(result.site.region, 'sin1');
});

test('validateSite: a second fixture site validates', () => {
  const result = validateSite(readFixture('test/fixtures/site-alt/site.json'));
  assert.equal(result.ok, true);
});

test('validateSite: applies documented defaults when fields are omitted', () => {
  const raw = readFixture('examples/solluna/site.json');
  delete raw.lowercaseNames;
  delete raw.extraLivePatterns;
  delete raw.categories;
  const result = validateSite(raw);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.site.lowercaseNames, false);
  assert.deepEqual(result.site.extraLivePatterns, []);
  assert.deepEqual(result.site.categories, ['show / interview', 'fan meet / fan day', 'live']);
});

test('validateSite: errors name the field for a bad colour', () => {
  const raw = readFixture('examples/solluna/site.json');
  raw.featuredPeople[0].colour = 'orange';
  const result = validateSite(raw);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.errors.some((e) => e.startsWith('featuredPeople[0].colour:')));
});

test('validateSite: errors on a featured colour below 3:1 contrast', () => {
  const raw = readFixture('examples/solluna/site.json');
  raw.featuredPeople[0].colour = '#fffefd'; // near-white: fails contrast against the light card
  const result = validateSite(raw);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.errors.some((e) => e.includes('featuredPeople[0].colour') && e.includes('contrast')));
});

test('validateSite: errors on an unknown marker handle', () => {
  const raw = readFixture('examples/solluna/site.json');
  raw.defaultMarkers['🧡'] = { personHandle: 'nobody' };
  const result = validateSite(raw);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.errors.some((e) => e.includes("defaultMarkers.🧡") && e.includes('nobody')));
});

test('validateSite: errors when featuredPeople is missing', () => {
  const raw = readFixture('examples/solluna/site.json');
  delete raw.featuredPeople;
  const result = validateSite(raw);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.errors.some((e) => e.startsWith('featuredPeople:')));
});

test("validateSite: errors on timezone 'Mars/Olympus'", () => {
  const raw = readFixture('examples/solluna/site.json');
  raw.timezone = 'Mars/Olympus';
  const result = validateSite(raw);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.errors.some((e) => e.startsWith('timezone:') && e.includes('Mars/Olympus')));
});

test('validateSite: errors when contactUrl is missing', () => {
  const raw = readFixture('examples/solluna/site.json');
  delete raw.contactUrl;
  const result = validateSite(raw);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.errors.some((e) => e.startsWith('contactUrl:')));
});
