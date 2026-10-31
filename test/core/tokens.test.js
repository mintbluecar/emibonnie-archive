// @ts-check
/**
 * Styling system Task 2 (spec "2. Tokens"): the new spacing, radius,
 * shadow, weight, focus-ring, danger-colour and font-role scales are all
 * defined in `:root`, every new colour token has a value in both dark
 * blocks (test/site/themeTokens.test.js keeps those two blocks in sync),
 * and `--font-body` is a literal alias of `--font-latin` so a site that
 * only overrides `--font-latin` still changes the body font (Review
 * Focus 2; the build-level check lives in test/site/themeTokens.test.js).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOKENS_PATH = fileURLToPath(new URL('../../src/styles/tokens.css', import.meta.url));
const tokens = readFileSync(TOKENS_PATH, 'utf8');

const deviceDarkStart = tokens.indexOf(':root:not([data-theme="light"])');
const forcedDarkStart = tokens.indexOf(':root[data-theme="dark"]');
assert.ok(deviceDarkStart !== -1 && forcedDarkStart !== -1, 'fixture assumption: tokens.css has both dark blocks');

const light = tokens.slice(0, deviceDarkStart);
const deviceDark = tokens.slice(deviceDarkStart, forcedDarkStart);
const forcedDark = tokens.slice(forcedDarkStart);

const NEW_TOKENS = [
  '--space-1', '--space-2', '--space-3', '--space-4', '--space-5', '--space-6', '--space-8',
  '--radius-sm', '--radius-md', '--radius-card', '--radius-pill',
  '--shadow-card', '--shadow-raised',
  '--weight-regular', '--weight-bold', '--weight-heavy',
  '--focus-ring-color', '--focus-ring-width', '--focus-ring-offset',
  '--color-danger', '--color-danger-tint',
  '--font-latin', '--font-body', '--font-heading', '--font-script',
  '--bp-desktop',
];

const COLOUR_TOKENS = ['--color-danger', '--color-danger-tint'];

test('every Task 2 token is defined in :root', () => {
  for (const name of NEW_TOKENS) {
    assert.match(light, new RegExp(`${name}:\\s*[^;]+;`), `:root defines ${name}`);
  }
});

test('every Task 2 colour token has a value in both dark blocks', () => {
  for (const name of COLOUR_TOKENS) {
    assert.match(deviceDark, new RegExp(`${name}:\\s*[^;]+;`), `the device-dark block defines ${name}`);
    assert.match(forcedDark, new RegExp(`${name}:\\s*[^;]+;`), `the forced-dark block defines ${name}`);
  }
});

test('--color-danger (dark) is at least 4.5:1 against the dark --color-card', async () => {
  const { contrastRatio } = await import('../../src/site/contrast.js');
  const darkCard = /--color-card:\s*(#[0-9a-f]{6})/i.exec(deviceDark)?.[1];
  const darkDanger = /--color-danger:\s*(#[0-9a-f]{6})/i.exec(deviceDark)?.[1];
  assert.ok(darkCard && darkDanger, 'both --color-card and --color-danger are plain hex colours in the dark block');
  const ratio = contrastRatio(darkDanger, darkCard);
  assert.ok(ratio >= 4.5, `--color-danger ${darkDanger} on --color-card ${darkCard} is ${ratio.toFixed(2)}:1`);
});

test('--font-body resolves through --font-latin, and --font-heading defaults to --font-body', () => {
  assert.match(light, /--font-body:\s*var\(--font-latin\);/);
  assert.match(light, /--font-heading:\s*var\(--font-body\);/);
});

test('--bp-desktop documents the one allowed media query breakpoint', () => {
  assert.match(light, /--bp-desktop:\s*860px;/);
});

test('--shadow-card and --shadow-raised use values already in use by cards and the line-fix sheet', () => {
  assert.match(light, /--shadow-card:\s*0 2px 0 var\(--color-card-shadow\);/);
  assert.match(light, /--shadow-raised:\s*0 -6px 24px var\(--color-card-shadow\);/);
});

test('base.css: body uses --font-body and h1/h2/h3 use --font-heading', () => {
  const base = readFileSync(path.join(path.dirname(TOKENS_PATH), 'base.css'), 'utf8');
  assert.match(base, /body\s*\{[^}]*font-family:\s*var\(--font-body\)/s);
  assert.match(base, /h1,\s*h2,\s*h3\s*\{[^}]*font-family:\s*var\(--font-heading\)/s);
});
