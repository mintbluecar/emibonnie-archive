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

test('validateSite (Task 10c): roleEmoji defaults to {}, keeps fan/host/speaker overrides, and refuses crowd, unknown roles and empty values', () => {
  const raw = readFixture('examples/solluna/site.json');
  const plain = validateSite(raw);
  assert.ok(plain.ok);
  if (plain.ok) assert.deepEqual(plain.site.roleEmoji, {});
  const ok = validateSite({ ...raw, roleEmoji: { host: '🎙️' } });
  assert.ok(ok.ok);
  if (ok.ok) assert.deepEqual(ok.site.roleEmoji, { host: '🎙️' });
  const bad = validateSite({ ...raw, roleEmoji: { crowd: '📢', fan: '', mc: '🎤' } });
  assert.equal(bad.ok, false);
  if (bad.ok) return;
  assert.ok(bad.errors.some((e) => e.startsWith('roleEmoji.crowd:')), bad.errors.join('\n'));
  assert.ok(bad.errors.some((e) => e.startsWith('roleEmoji.fan:')), bad.errors.join('\n'));
  assert.ok(bad.errors.some((e) => e.startsWith('roleEmoji.mc:')), bad.errors.join('\n'));
  assert.equal(validateSite({ ...raw, roleEmoji: ['💬'] }).ok, false);
});

test('validateSite (Task 10c j): favicon is an optional relative .png/.svg path inside the site folder; anything else names the field', () => {
  const raw = readFixture('examples/solluna/site.json');
  const plain = validateSite(raw);
  assert.ok(plain.ok && plain.site.favicon === null);
  const ok = validateSite({ ...raw, favicon: 'icons/fav.png' });
  assert.ok(ok.ok && ok.site.favicon === 'icons/fav.png');
  for (const bad of ['/etc/fav.png', '../fav.png', 'icons/../../x.svg', 'fav.ico', 'https://x.example/f.png', 42]) {
    const result = validateSite({ ...raw, favicon: bad });
    assert.equal(result.ok, false, String(bad));
    if (!result.ok) assert.ok(result.errors.some((e) => e.startsWith('favicon:')), String(bad));
  }
});

test('validateSite (Task 14): fonts defaults to [] when left out', () => {
  const raw = readFixture('examples/solluna/site.json');
  const result = validateSite(raw);
  assert.ok(result.ok);
  if (result.ok) assert.deepEqual(result.site.fonts, []);
});

test('validateSite (Task 14): a package-shape font is accepted and normalised', () => {
  const raw = readFixture('examples/solluna/site.json');
  raw.fonts = [{ family: 'Some Display', package: '@fontsource/some-display', subsets: ['latin'], weights: [400, 700] }];
  const result = validateSite(raw);
  assert.ok(result.ok, !result.ok && result.errors.join('\n'));
  if (!result.ok) return;
  assert.deepEqual(result.site.fonts, [
    { family: 'Some Display', style: 'normal', package: '@fontsource/some-display', subsets: ['latin'], weights: [400, 700] },
  ]);
});

test('validateSite (Task 14): a files-shape font is accepted, and its top-level weights is derived from its files', () => {
  const raw = readFixture('examples/solluna/site.json');
  raw.fonts = [
    {
      family: 'Our Own Font',
      files: [
        { path: 'our-own-font-regular.woff2', weight: 400 },
        { path: 'our-own-font-bold.woff2', weight: 700, style: 'normal', unicodeRange: 'U+0000-00FF' },
      ],
    },
  ];
  const result = validateSite(raw);
  assert.ok(result.ok, !result.ok && result.errors.join('\n'));
  if (!result.ok) return;
  assert.deepEqual(result.site.fonts, [
    {
      family: 'Our Own Font',
      style: 'normal',
      weights: [400, 700],
      files: [
        { path: 'our-own-font-regular.woff2', weight: 400, style: 'normal' },
        { path: 'our-own-font-bold.woff2', weight: 700, style: 'normal', unicodeRange: 'U+0000-00FF' },
      ],
    },
  ]);
});

test('validateSite (Task 14): a font missing family is an error', () => {
  const raw = readFixture('examples/solluna/site.json');
  raw.fonts = [{ package: '@fontsource/some-display', subsets: ['latin'], weights: [400] }];
  const result = validateSite(raw);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.errors.some((e) => e.startsWith('fonts[0].family:')), result.errors.join('\n'));
});

test('validateSite (Task 14): a files entry naming a non-woff2 file is an error', () => {
  const raw = readFixture('examples/solluna/site.json');
  raw.fonts = [{ family: 'Our Own Font', files: [{ path: 'our-own-font.ttf', weight: 400 }] }];
  const result = validateSite(raw);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.errors.some((e) => e.startsWith('fonts[0].files[0].path:')), result.errors.join('\n'));
});

test('validateSite (Task 14): a weight outside 100-900 is an error, for both shapes', () => {
  const raw = readFixture('examples/solluna/site.json');
  raw.fonts = [
    { family: 'Package Font', package: '@fontsource/package-font', subsets: ['latin'], weights: [950] },
    { family: 'File Font', files: [{ path: 'file-font.woff2', weight: 50 }] },
  ];
  const result = validateSite(raw);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.errors.some((e) => e.startsWith('fonts[0].weights[0]:')), result.errors.join('\n'));
  assert.ok(result.errors.some((e) => e.startsWith('fonts[1].files[0].weight:')), result.errors.join('\n'));
});

test('validateSite (Task 14): a font naming neither package nor files (or both) is an error', () => {
  const raw = readFixture('examples/solluna/site.json');
  raw.fonts = [{ family: 'Neither' }];
  const neither = validateSite(raw);
  assert.equal(neither.ok, false);
  if (!neither.ok) assert.ok(neither.errors.some((e) => e.startsWith('fonts[0]:')), neither.errors.join('\n'));

  raw.fonts = [{ family: 'Both', package: '@fontsource/both', subsets: ['latin'], weights: [400], files: [{ path: 'x.woff2', weight: 400 }] }];
  const both = validateSite(raw);
  assert.equal(both.ok, false);
  if (!both.ok) assert.ok(both.errors.some((e) => e.startsWith('fonts[0]:')), both.errors.join('\n'));
});
