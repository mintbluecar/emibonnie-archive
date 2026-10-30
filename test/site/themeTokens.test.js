// @ts-check
/**
 * Task 10c (f): every dark value is written twice -- for the device's
 * dark mode unless forced light, and for a forced dark -- and the two
 * copies must never drift.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, mkdtempSync, rmSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runBuild } from '../../scripts/build.js';

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

/**
 * A crude (id, class-equivalent, type) specificity count, good enough for
 * this engine's `:root`/`[data-theme=...]`/`:not(...)` selectors -- not a
 * general CSS selector parser. `:not()` itself adds nothing; only its
 * argument's specificity does (CSS Selectors Level 4 §17.1), so its
 * wrapper is stripped before counting.
 * @param {string} selector @returns {[number, number, number]}
 */
function specificity(selector) {
  const flattened = selector.replace(/:not\(/g, '').replace(/\)/g, '');
  const ids = (flattened.match(/#[\w-]+/g) ?? []).length;
  const classLike = (flattened.match(/\.[\w-]+|\[[^\]]*\]|:[\w-]+/g) ?? []).length;
  const typeLike = (flattened.match(/(^|[\s>+~])[a-zA-Z][\w-]*/g) ?? []).length;
  return [ids, classLike, typeLike];
}

test("dark blocks still outrank a site's light :root (Task 1 build-level guard, Review Focus 1)", async () => {
  // examples/solluna, but with a theme that -- like today's real site/theme.css -- sets a light
  // value on a plain, unlayered-looking :root. If the theme ever ended up unlayered in app.css,
  // this would beat the engine's two dark blocks whatever their specificity (an unlayered rule
  // always outranks a layered one), forcing the site's light --color-bg into dark mode.
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'fan-archive-theme-layer-'));
  try {
    cpSync('src', path.join(repoRoot, 'src'), { recursive: true });
    cpSync('public/js', path.join(repoRoot, 'public/js'), { recursive: true });
    cpSync('examples/solluna', path.join(repoRoot, 'site'), { recursive: true });
    cpSync('robots.txt', path.join(repoRoot, 'robots.txt'));
    const siteDir = path.join(repoRoot, 'site');
    writeFileSync(path.join(siteDir, 'theme.css'), ':root {\n  --color-bg: #ffffff;\n}\n');

    await runBuild({ repoRoot, siteDir });
    const manifest = JSON.parse(readFileSync(path.join(repoRoot, 'public/build/manifest.json'), 'utf8'));
    const css = readFileSync(path.join(repoRoot, 'public/build', manifest.appCss), 'utf8');

    const tokensStart = css.indexOf('@layer tokens{');
    const baseStart = css.indexOf('@layer base{');
    assert.ok(tokensStart !== -1 && baseStart !== -1 && tokensStart < baseStart, 'app.css has a tokens layer, before base');

    const deviceDarkSelector = ':root:not([data-theme=light])';
    const forcedDarkSelector = ':root[data-theme=dark]';
    const deviceIdx = css.indexOf(deviceDarkSelector);
    const forcedIdx = css.indexOf(forcedDarkSelector);
    assert.ok(deviceIdx > tokensStart && deviceIdx < baseStart, 'the device-dark selector is inside @layer tokens, not some other layer');
    assert.ok(forcedIdx > tokensStart && forcedIdx < baseStart, 'the forced-dark selector is inside @layer tokens, not some other layer');
    assert.deepEqual(specificity(deviceDarkSelector), [0, 2, 0]);
    assert.deepEqual(specificity(forcedDarkSelector), [0, 2, 0]);

    assert.ok(css.includes('@layer theme{:root{--color-bg: #ffffff}}'), 'the site theme\'s :root override is inside @layer theme, never unlayered');
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});
