// @ts-check
/**
 * Task 10c (f): every dark value is written twice -- for the device's
 * dark mode unless forced light, and for a forced dark -- and the two
 * copies must never drift.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

/** The declarations inside the first `{…}` after `selector`, comments dropped, whitespace normalised. @param {string} css @param {string} selector */
function declarations(css, selector) {
  const start = css.indexOf(selector);
  assert.ok(start !== -1, `no ${selector}`);
  const open = css.indexOf('{', start);
  const body = css.slice(open + 1, css.indexOf('}', open));
  return body.replace(/\/\*[\s\S]*?\*\//g, '').split(';').map((d) => d.trim()).filter(Boolean);
}

for (const [file, selector] of [
  ['src/styles/tokens.css', ':root'],
  ['examples/solluna/theme.css', ':root'],
  ['src/styles/components/header.css', ':root .c-header__filter-count'],
  ['src/styles/components/filterSheet.css', ':root .c-filter-sheet__apply'],
]) {
  test(`${file}: the device-dark block (unless forced light) and the forced-dark block hold the same declarations`, () => {
    const css = readFileSync(file, 'utf8');
    const [root, rest] = selector.split(' ');
    const deviceSel = `${root}:not([data-theme="light"])${rest ? ` ${rest}` : ''}`;
    const forcedSel = `${root}[data-theme="dark"]${rest ? ` ${rest}` : ''}`;
    assert.ok(css.indexOf('@media (prefers-color-scheme: dark)') < css.indexOf(deviceSel), 'the device block is inside the media query');
    assert.deepEqual(declarations(css, forcedSel), declarations(css, deviceSel));
    assert.ok(!/@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{/.test(css), 'no unguarded dark block left');
  });
}
