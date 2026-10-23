// @ts-check
/**
 * Task 9a item 9: accent *text* (section and month headings, the active
 * tab, result-card event names, open-profile and contact links) uses its
 * own `--color-label` token, so a site can keep its exact brand gradient
 * and still pick a readable label colour. Gradients and backgrounds keep
 * `--gradient-from`/`--gradient-to`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const STYLES = fileURLToPath(new URL('../../src/styles/', import.meta.url));

/** @param {string} dir @returns {string[]} */
const cssFiles = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (
  e.isDirectory() ? cssFiles(path.join(dir, e.name)) : e.name.endsWith('.css') ? [path.join(dir, e.name)] : []
));

test('no engine text colour uses a gradient token: they go through --color-label', () => {
  const offenders = cssFiles(STYLES).flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/(?:^|[;{\s])color:\s*([^;}]*)/g)]
    .filter((m) => /--gradient-(?:from|to)/.test(m[1])).map((m) => `${path.basename(file)}: color: ${m[1].trim()}`));
  assert.deepEqual(offenders, []);
});

test('--color-label is defined for light and dark mode, defaulting to --gradient-to, and used for every accent label', () => {
  const tokens = readFileSync(path.join(STYLES, 'tokens.css'), 'utf8');
  const [light, dark] = tokens.split('@media (prefers-color-scheme: dark)');
  assert.match(light, /--color-label:\s*var\(--gradient-to\);/);
  assert.match(dark, /--color-label:\s*var\(--gradient-to\);/);
  const uses = cssFiles(path.join(STYLES, 'components')).flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/([^{}]+)\{[^}]*color:\s*var\(--color-label\)/g)]
    .flatMap((m) => m[1].replace(/\/\*[\s\S]*?\*\//g, '').split(',').map((s) => s.trim())));
  for (const selector of ['.c-home-month__label', '.c-hub-group__label', '.c-tabbar__item--on', '.c-result-card__event',
    '.c-account__open-profile', '.c-static__contact a']) {
    assert.ok(uses.includes(selector), `${selector} uses --color-label (got ${uses.join(', ')})`);
  }
});

/** @param {string} css @param {string} name @returns {string|undefined} */
const tokenIn = (css, name) => new RegExp(`${name}:\\s*([^;]+);`).exec(css)?.[1].trim();

test('Task 9b: a pale --color-highlight is defined for light and dark mode, and ink text on it passes AA in both', async () => {
  const { contrastRatio } = await import('../../src/site/contrast.js');
  const tokens = readFileSync(path.join(STYLES, 'tokens.css'), 'utf8');
  const [light, dark] = tokens.split('@media (prefers-color-scheme: dark)');
  for (const [mode, css] of [['light', light], ['dark', dark]]) {
    const highlight = tokenIn(css, '--color-highlight');
    const ink = tokenIn(css, '--color-ink');
    assert.ok(highlight && ink, `${mode}: --color-highlight and --color-ink are plain colours`);
    assert.ok(contrastRatio(highlight, ink) >= 4.5, `${mode}: ink on ${highlight} is ${contrastRatio(highlight, ink).toFixed(2)}:1`);
  }
  assert.match(readFileSync(path.join(STYLES, 'components/resultCard.css'), 'utf8'), /mark\s*\{[^}]*background:\s*var\(--color-highlight\)/);
});

test('Task 9b: the label tint tokens derive from --color-label (so a site that sets it gets matching badges), and the badges, segmented control and active filter chips use them', () => {
  const tokens = readFileSync(path.join(STYLES, 'tokens.css'), 'utf8');
  assert.match(tokens, /--color-label-tint:\s*color-mix\(in srgb, var\(--color-label\) \d+%, var\(--color-card\)\);/);
  assert.match(tokens, /--color-label-on-tint:\s*color-mix\(in srgb, var\(--color-label\) \d+%, var\(--color-ink\)\);/);
  const uses = (/** @type {string} */ file, /** @type {string} */ selector) => {
    const css = readFileSync(path.join(STYLES, 'components', file), 'utf8');
    const block = css.slice(css.indexOf(`${selector} {`));
    return block.slice(0, block.indexOf('}'));
  };
  for (const [file, selector] of [['eventCard.css', '.c-event-card__count'], ['hub.css', '.c-hub__seg .c-chips .c-chips__chip--on'],
    ['inlineSearch.css', '.c-search__active-chip']]) {
    const block = uses(file, selector);
    assert.match(block, /background:\s*var\(--color-label-tint\)/, `${selector} background`);
    assert.match(block, /color:\s*var\(--color-label-on-tint\)/, `${selector} text`);
  }
});
