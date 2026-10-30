// @ts-check
/**
 * Task 10c (f): every dark value is written twice -- for the device's
 * dark mode unless forced light, and for a forced dark -- and the two
 * copies must never drift.
 *
 * Styling system Task 5 (spec "6. Enforcement", "Theme test"): a site
 * `theme.css` may only set custom properties `tokens.css` defines --
 * it overrides, never adds (`tokens.css`'s own doc comment).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, mkdtempSync, rmSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runBuild } from '../../scripts/build.js';
import { findDefinedCssTokens, findUndeclaredFontFamilies, findFontFamilyReferences } from '../../scripts/buildChecks.js';
import { FONT_SPECS } from '../../scripts/buildAssets.js';

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

test('Styling system Task 12: the filter count and the apply button keep no dark blocks of their own -- the darkened start stop is --gradient-from-strong, whose dark value tokens.css holds in both blocks', () => {
  const header = readFileSync('src/styles/components/header.css', 'utf8');
  assert.match(header, /\.c-header__filter-count\s*\{[^}]*linear-gradient\(90deg, var\(--gradient-from-strong\), var\(--gradient-to\)\)/);
  assert.match(readFileSync('src/styles/primitives/button.css', 'utf8'), /\.btn--primary\s*\{[^}]*var\(--gradient-from-strong\)/);
  for (const file of ['src/styles/components/header.css', 'src/styles/components/filterSheet.css']) {
    assert.ok(!readFileSync(file, 'utf8').includes('prefers-color-scheme'), `${file} has no dark block`);
  }
});

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

test('Task 2, Review Focus 2: a site that overrides only --font-latin (and never mentions --font-body) still changes the body font', async () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'fan-archive-font-role-'));
  try {
    cpSync('src', path.join(repoRoot, 'src'), { recursive: true });
    cpSync('public/js', path.join(repoRoot, 'public/js'), { recursive: true });
    cpSync('examples/solluna', path.join(repoRoot, 'site'), { recursive: true });
    cpSync('robots.txt', path.join(repoRoot, 'robots.txt'));
    const siteDir = path.join(repoRoot, 'site');
    writeFileSync(path.join(siteDir, 'theme.css'), ":root {\n  --font-latin: 'X', sans-serif;\n}\n");

    const { runBuild } = await import('../../scripts/build.js');
    await runBuild({ repoRoot, siteDir });
    const manifest = JSON.parse(readFileSync(path.join(repoRoot, 'public/build/manifest.json'), 'utf8'));
    const css = readFileSync(path.join(repoRoot, 'public/build', manifest.appCss), 'utf8');

    assert.match(css, /--font-body:\s*var\(--font-latin\)/, 'the tokens layer still defines --font-body as an alias of --font-latin');
    assert.match(css, /body\{[^}]*font-family:var\(--font-body\)/, 'base.css\'s body rule uses --font-body, not --font-latin directly');
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('a theme setting --made-up fails: a theme.css may only set custom properties tokens.css defines', () => {
  const definedByTokens = findDefinedCssTokens(readFileSync('src/styles/tokens.css', 'utf8'));
  const setByTheme = findDefinedCssTokens(':root {\n  --made-up: 1px;\n}\n');
  const notDefined = [...setByTheme].filter((token) => !definedByTokens.has(token));
  assert.deepEqual(notDefined, ['--made-up']);
});

test('the bundled example site and this repo\'s own site set only tokens that tokens.css defines', () => {
  const definedByTokens = findDefinedCssTokens(readFileSync('src/styles/tokens.css', 'utf8'));
  for (const themeFile of ['examples/solluna/theme.css', 'site/theme.css']) {
    const setByTheme = findDefinedCssTokens(readFileSync(themeFile, 'utf8'));
    const notDefined = [...setByTheme].filter((token) => !definedByTokens.has(token));
    assert.deepEqual(notDefined, [], themeFile);
  }
});

test('Task 14, spec "2b. Fonts a site can choose": a theme naming an undeclared font family fails -- a font token may only name a family the engine ships or site.json declares', () => {
  const engineFamilies = FONT_SPECS.map((spec) => spec.family);

  const madeUp = findUndeclaredFontFamilies(
    [":root {\n  --font-heading: 'Not A Real Font', var(--font-body);\n}\n"],
    engineFamilies,
  );
  assert.deepEqual(madeUp, ['Not A Real Font']);

  const engineOwn = findUndeclaredFontFamilies([`:root {\n  --font-heading: '${engineFamilies[0]}', var(--font-body);\n}\n`], engineFamilies);
  assert.deepEqual(engineOwn, [], 'naming one of the engine\'s own families is never undeclared');

  const declaredBySite = findUndeclaredFontFamilies(
    [":root {\n  --font-heading: 'Site Custom Font', var(--font-body);\n}\n"],
    [...engineFamilies, 'Site Custom Font'],
  );
  assert.deepEqual(declaredBySite, [], 'naming a family site.json itself declares is never undeclared');
});

test('findFontFamilyReferences (Task 14, fix round 1): a declaration with no trailing ; (the last one before the block\'s closing }) is still found', () => {
  const noSemicolon = findFontFamilyReferences([":root { --font-heading: 'Last Declaration' }"]);
  assert.deepEqual([...noSemicolon], ['Last Declaration']);

  const bothStyles = findFontFamilyReferences([":root { --font-body: 'First'; --font-heading: 'Last' }"]);
  assert.deepEqual([...bothStyles].sort(), ['First', 'Last']);
});

test('the bundled example site and this repo\'s own site only name font families the engine ships (neither declares its own fonts yet)', () => {
  const engineFamilies = FONT_SPECS.map((spec) => spec.family);
  for (const themeFile of ['examples/solluna/theme.css', 'site/theme.css']) {
    const undeclared = findUndeclaredFontFamilies([readFileSync(themeFile, 'utf8')], engineFamilies);
    assert.deepEqual(undeclared, [], themeFile);
  }
});
