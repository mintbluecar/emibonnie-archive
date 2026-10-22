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
