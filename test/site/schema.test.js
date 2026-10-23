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
  assert.deepEqual(result.site.featuredPeople[0].otherAccounts, [{ platform: 'x', handle: 'solsunny_x' }]);
  assert.deepEqual(result.site.featuredPeople[1].otherAccounts, []);
});

test('validateSite: a featured person\'s otherAccounts handle is normalised (@ stripped, lowercased)', () => {
  const raw = readFixture('examples/solluna/site.json');
  raw.featuredPeople[0].otherAccounts = [{ platform: 'instagram', handle: '@SolSunny_IG' }];
  const result = validateSite(raw);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.site.featuredPeople[0].otherAccounts, [
    { platform: 'instagram', handle: 'solsunny_ig' },
  ]);
});

test('validateSite: errors name the field for a bad otherAccounts platform', () => {
  const raw = readFixture('examples/solluna/site.json');
  raw.featuredPeople[0].otherAccounts = [
    { platform: 'x', handle: 'solsunny_x' },
    { platform: 'myspace', handle: 'solsunny' },
  ];
  const result = validateSite(raw);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.errors.some((e) => e.startsWith('featuredPeople[0].otherAccounts[1].platform:')));
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
  delete raw.embedSources;
  const result = validateSite(raw);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.site.lowercaseNames, false);
  assert.equal(result.site.embedSources, false, 'embedSources: off unless a site opts in (Task 10b)');
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

test('validateSite: warns (doesn\'t fail) on a featured colour below 3:1 contrast, naming the colour and its ratio (review round 2, fix round 2, item 2)', () => {
  const raw = readFixture('examples/solluna/site.json');
  raw.featuredPeople[0].colour = '#fffefd'; // near-white: fails contrast against the light card
  const result = validateSite(raw);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.warnings.some((w) => w.includes('featuredPeople[0].colour') && w.includes('#fffefd') && w.includes('contrast')));
  assert.equal(result.site.featuredPeople[0].colour, '#fffefd');
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

test('ALLOWED_REGIONS: Vercel\'s 19 compute regions (vercel.com/docs/regions, checked 2026-10-23), re-exported by schema.js', async () => {
  const { ALLOWED_REGIONS } = await import('../../src/site/schema.js');
  const { ALLOWED_REGIONS: own } = await import('../../src/site/regions.js');
  assert.equal(ALLOWED_REGIONS, own);
  assert.equal(own.length, 19);
  assert.ok(own.includes('yul1'), 'Montréal, added since the first list');
  const raw = readFixture('examples/solluna/site.json');
  assert.equal(validateSite({ ...raw, region: 'yul1' }).ok, true);
  assert.equal(validateSite({ ...raw, region: 'dev1' }).ok, false, 'the local-dev pseudo-region is not a deploy target');
});

test('validateSite (Task 10b): embedSources is an optional boolean -- true is kept, a non-boolean names the field', () => {
  const on = readFixture('examples/solluna/site.json');
  on.embedSources = true;
  const okResult = validateSite(on);
  assert.equal(okResult.ok, true);
  if (okResult.ok) assert.equal(okResult.site.embedSources, true);

  const bad = readFixture('examples/solluna/site.json');
  bad.embedSources = 'yes';
  const badResult = validateSite(bad);
  assert.equal(badResult.ok, false);
  if (!badResult.ok) assert.ok(badResult.errors.includes('embedSources: must be a boolean'), badResult.errors.join('\n'));
});
