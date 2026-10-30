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
import { readFileSync, mkdtempSync, rmSync, writeFileSync, cpSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runBuild } from '../../scripts/build.js';
import { findDefinedCssTokens, findUndeclaredFontFamilies, findFontFamilyReferences } from '../../scripts/buildChecks.js';
import { FONT_SPECS } from '../../scripts/buildAssets.js';
import { chromium } from '@playwright/test';

/* global document, getComputedStyle -- only inside page.evaluate, which runs in the browser */

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

test('Styling system Task 12: the filter count and the apply button keep no dark blocks of their own -- the darkened start stop is --gradient-from-strong, whose dark value tokens.css holds in both blocks', () => {
  const header = readFileSync('src/styles/components/header.css', 'utf8');
  assert.match(header, /\.c-header__filter-count\s*\{[^}]*linear-gradient\(90deg, var\(--gradient-from-strong\), var\(--gradient-to\)\)/);
  assert.match(readFileSync('src/styles/primitives/button.css', 'utf8'), /\.btn--primary\s*\{[^}]*var\(--gradient-from-strong\)/);
  for (const file of ['src/styles/components/header.css', 'src/styles/components/filterSheet.css']) {
    assert.ok(!readFileSync(file, 'utf8').includes('prefers-color-scheme'), `${file} has no dark block`);
  }
});

/**
 * The engine's own dark value for `token`, read off `tokens.css`'s
 * forced-dark block (kept identical to the device-dark one by the test
 * above). @param {string} token @returns {string}
 */
function engineDarkValue(token) {
  const decl = declarations(readFileSync('src/styles/tokens.css', 'utf8'), ':root[data-theme="dark"]').find((d) => d.startsWith(`${token}:`));
  assert.ok(decl, `tokens.css's dark block sets ${token}`);
  return decl.slice(token.length + 1).trim();
}

test("Review Focus 1, in a real browser: a site theme's light values on plain :root never leak into dark mode, and its own dark-block overrides still win", async () => {
  // Like the real downstream site/theme.css: light values on a plain :root (0,1,0), plus a
  // dark-block override for --color-label. The engine's dark blocks are (0,2,0); cascade layers
  // are compared before specificity (CSS Cascade 5, "Cascade Layers"), so this only holds while
  // the theme sits in the same layer as tokens.css, after it.
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'fan-archive-theme-cascade-'));
  const browser = await chromium.launch();
  try {
    cpSync('src', path.join(repoRoot, 'src'), { recursive: true });
    cpSync('public/js', path.join(repoRoot, 'public/js'), { recursive: true });
    cpSync('examples/solluna', path.join(repoRoot, 'site'), { recursive: true });
    cpSync('robots.txt', path.join(repoRoot, 'robots.txt'));
    const siteDir = path.join(repoRoot, 'site');
    writeFileSync(
      path.join(siteDir, 'theme.css'),
      ':root {\n  --color-bg: #ffffff;\n  --color-ink: #000000;\n  --color-label: #111111;\n}\n' +
        '@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"]) {\n    --color-label: #eeeeee;\n  }\n}\n' +
        ':root[data-theme="dark"] {\n  --color-label: #eeeeee;\n}\n',
    );

    await runBuild({ repoRoot, siteDir });
    const manifest = JSON.parse(readFileSync(path.join(repoRoot, 'public/build', 'manifest.json'), 'utf8'));
    const css = readFileSync(path.join(repoRoot, 'public/build', manifest.appCss), 'utf8');

    /** @param {'light'|'dark'} colorScheme @param {string|null} dataTheme */
    async function render(colorScheme, dataTheme) {
      const context = await browser.newContext({ colorScheme });
      try {
        const page = await context.newPage();
        const attr = dataTheme ? ` data-theme="${dataTheme}"` : '';
        await page.setContent(`<!doctype html><html${attr}><head><style>${css}</style></head><body><p>x</p></body></html>`);
        return await page.evaluate(([darkBg, darkInk]) => {
          /** @param {string} prop @param {string} value */
          const resolve = (prop, value) => {
            const probe = document.createElement('div');
            probe.style.setProperty(prop, value);
            document.body.append(probe);
            const out = getComputedStyle(probe).getPropertyValue(prop);
            probe.remove();
            return out;
          };
          const body = getComputedStyle(document.body);
          return {
            bg: body.backgroundColor,
            ink: body.color,
            label: getComputedStyle(document.documentElement).getPropertyValue('--color-label').trim(),
            engineDarkBg: resolve('background-color', darkBg),
            engineDarkInk: resolve('color', darkInk),
          };
        }, [engineDarkValue('--color-bg'), engineDarkValue('--color-ink')]);
      } finally {
        await context.close();
      }
    }

    for (const [colorScheme, dataTheme] of /** @type {const} */ ([['dark', null], ['light', 'dark'], ['dark', 'dark']])) {
      const seen = await render(colorScheme, dataTheme);
      const where = `${colorScheme} device, data-theme=${dataTheme}`;
      assert.equal(seen.bg, seen.engineDarkBg, `${where}: body background is the engine's dark --color-bg`);
      assert.equal(seen.ink, seen.engineDarkInk, `${where}: body ink is the engine's dark --color-ink`);
      assert.equal(seen.label, '#eeeeee', `${where}: --color-label is the theme's own dark-block value`);
    }
    for (const [colorScheme, dataTheme] of /** @type {const} */ ([['light', null], ['dark', 'light'], ['light', 'light']])) {
      const seen = await render(colorScheme, dataTheme);
      const where = `${colorScheme} device, data-theme=${dataTheme}`;
      assert.equal(seen.bg, 'rgb(255, 255, 255)', `${where}: the theme's light --color-bg wins`);
      assert.equal(seen.ink, 'rgb(0, 0, 0)', `${where}: the theme's light --color-ink wins`);
      assert.equal(seen.label, '#111111', `${where}: the theme's light --color-label wins`);
    }
  } finally {
    await browser.close();
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

/**
 * The font families `siteDir`'s `theme.css` names that are neither the
 * engine's own (`FONT_SPECS`) nor declared in its `site.json` `fonts`
 * (spec "2b. Fonts a site can choose").
 * @param {string} siteDir @returns {string[]}
 */
function undeclaredThemeFamilies(siteDir) {
  const siteJsonPath = path.join(siteDir, 'site.json');
  const siteFonts = existsSync(siteJsonPath) ? (JSON.parse(readFileSync(siteJsonPath, 'utf8')).fonts ?? []) : [];
  const allowed = [...FONT_SPECS.map((spec) => spec.family), ...siteFonts.map((/** @type {{ family: string }} */ font) => font.family)];
  return findUndeclaredFontFamilies([readFileSync(path.join(siteDir, 'theme.css'), 'utf8')], allowed);
}

test('the bundled example site and this repo\'s own site only name font families the engine ships or their own site.json declares', () => {
  for (const siteDir of ['examples/solluna', 'site']) {
    assert.deepEqual(undeclaredThemeFamilies(siteDir), [], `${siteDir}/theme.css`);
  }
});

test('a site whose theme points a token at a family its site.json fonts declares passes the theme font check; an undeclared one still fails', () => {
  const siteDir = mkdtempSync(path.join(tmpdir(), 'fan-archive-theme-fonts-'));
  try {
    writeFileSync(path.join(siteDir, 'site.json'), JSON.stringify({ fonts: [{ family: 'Site Display', files: [{ path: 'site-display.woff2', weight: 700 }] }] }));
    writeFileSync(path.join(siteDir, 'theme.css'), ":root {\n  --font-heading: 'Site Display', var(--font-body);\n}\n");
    assert.deepEqual(undeclaredThemeFamilies(siteDir), []);

    writeFileSync(path.join(siteDir, 'theme.css'), ":root {\n  --font-heading: 'Not Declared', var(--font-body);\n}\n");
    assert.deepEqual(undeclaredThemeFamilies(siteDir), ['Not Declared']);
  } finally {
    rmSync(siteDir, { recursive: true, force: true });
  }
});
