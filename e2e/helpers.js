// @ts-check
/**
 * The per-page checks both browser specs share (Task 9a item 1):
 * `e2e/smoke.spec.js` (the engine, on the bundled example) and
 * `e2e/site.spec.js` (a site's own pages, URLs discovered from its API).
 *
 * Every page gets the brief's four checks (`checkPage`): a 200 (or the
 * expected status), no console/page/CSP errors, no horizontal scroll, and
 * no serious/critical axe violations -- after `#app[data-ready]`, which
 * every page's first paint sets (`public/js/core/dom.js`'s `mountPage()`),
 * success, 404 or load-error alike (review round 2, C1).
 *
 * Every page also routes `video.twimg.com`/`pbs.twimg.com` to
 * `e2e/fixtures/tiny-clip.webm`/`tiny.png` -- tiny, genuinely decodable,
 * synthetic media (never a real tweet's), committed to the repo (see the
 * fixtures' own README). The engine seed's clip URLs are invented and 404
 * for real, and a site's real ones would make the checks depend on X;
 * this keeps the `sourceGone` fallback from masking a check that has
 * nothing to do with playback (ruling 2).
 *
 * `stubSyntheticMedia`, `gotoReady`, `devServer` and `e2eLockToken` live in
 * scripts/devServerHelpers.js, not here: scripts/screens.js (the screen
 * gallery, Styling system Task 7) reuses them too, and it is a plain
 * script, not a Playwright test -- it must not pull `@playwright/test`
 * (this file's own `expect` import) in just to get them. Re-exported here
 * so every existing import of them from this file keeps working.
 */
import { expect } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { stubSyntheticMedia, gotoReady, devServer, e2eLockToken } from '../scripts/devServerHelpers.js';

export { stubSyntheticMedia, gotoReady, devServer, e2eLockToken };

/** Review round 2, I1: dark-mode projects only run the per-page checks, not the engine smoke's extras. */
export const DARK_PROJECTS = ['phone-dark', 'desktop-dark'];

/**
 * Collects console `error`s, uncaught page errors, and -- explicitly,
 * not just by scraping console text -- CSP violations (review round 2,
 * C2: scripts/dev.js sends the real CSP header, so a violation can
 * actually happen). `addInitScript` runs before any page script, so the
 * listener is in place for the very first navigation.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<string[]>}
 */
export async function trackErrors(page) {
  /** @type {string[]} */
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(String(err)));
  await page.exposeFunction('__onCspViolation', (/** @type {string} */ detail) => errors.push(`securitypolicyviolation: ${detail}`));
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      // @ts-expect-error -- exposed by trackErrors() above, not declared on window
      window.__onCspViolation(`${e.violatedDirective} blocked ${e.blockedURI}`);
    });
  });
  return errors;
}

/** @param {import('@playwright/test').Page} page @returns {Promise<void>} */
async function assertNoHorizontalScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

/** @param {import('@playwright/test').Page} page @returns {Promise<void>} */
export async function assertNoSeriousA11yViolations(page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const details = serious.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.target) }));
  expect(serious, JSON.stringify(details, null, 2)).toEqual([]);
}

/**
 * `el`'s own box, or -- for a checkbox/radio, which WCAG 2.2 SC 2.5.8
 * measures on its label (styling system spec, "6. Enforcement") -- its
 * associated `<label>`'s box: an ancestor `<label>`, falling back to
 * `label[for="<id>"]` when the control sits outside one. Returns `null`
 * when a checkbox/radio has neither (the control's own tiny box is then
 * the real target, and callers measure that directly).
 * @param {import('@playwright/test').Locator} el @returns {Promise<import('@playwright/test').Locator|null>}
 */
async function labelFor(el) {
  const ancestor = el.locator('xpath=ancestor::label[1]');
  if (await ancestor.count() > 0) return ancestor.first();
  const id = await el.getAttribute('id');
  if (id) {
    const byFor = el.page().locator(`label[for="${id}"]`);
    if (await byFor.count() > 0) return byFor.first();
  }
  return null;
}

/**
 * Every visible `button, input, select, textarea` is at least 24x24 CSS
 * px (WCAG 2.2 SC 2.5.8, Target Size (Minimum)) -- a checkbox or radio
 * measured on its label when it has one, since that's the real clickable
 * target; its own box otherwise. Playwright's `isVisible()` already
 * excludes zero-size, `display:none` and `visibility:hidden` controls.
 * @param {import('@playwright/test').Page} page @returns {Promise<void>}
 */
async function assertTargetSizes(page) {
  const controls = page.locator('button, input, select, textarea');
  const n = await controls.count();
  for (let i = 0; i < n; i += 1) {
    const control = controls.nth(i);
    if (!(await control.isVisible())) continue;
    const type = await control.getAttribute('type');
    const isBoxy = type === 'checkbox' || type === 'radio';
    const target = isBoxy ? (await labelFor(control)) ?? control : control;
    const box = await target.boundingBox();
    const what = await control.evaluate((el) => `${el.tagName.toLowerCase()}${el.getAttribute('class') ? `.${el.getAttribute('class')}` : ''}`);
    expect(box, what).not.toBeNull();
    const { width, height } = /** @type {{ width: number, height: number }} */ (box);
    expect(width, `${what} target width`).toBeGreaterThanOrEqual(24);
    expect(height, `${what} target height`).toBeGreaterThanOrEqual(24);
  }
}

/**
 * Every visible `button, input, select, textarea` uses the body's font
 * family (spec "6. Enforcement"; Review Focus 2's build-level half is
 * Task 2, this is the browser half for every real page).
 * @param {import('@playwright/test').Page} page @returns {Promise<void>}
 */
async function assertControlsUseBodyFont(page) {
  const bodyFont = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  const controls = page.locator('button, input, select, textarea');
  const n = await controls.count();
  for (let i = 0; i < n; i += 1) {
    const control = controls.nth(i);
    if (!(await control.isVisible())) continue;
    const font = await control.evaluate((el) => getComputedStyle(el).fontFamily);
    const what = await control.evaluate((el) => `${el.tagName.toLowerCase()}${el.getAttribute('class') ? `.${el.getAttribute('class')}` : ''}`);
    expect(font, what).toBe(bodyFont);
  }
}

/**
 * Every `<table>` has a `<thead><th>` (spec "6. Enforcement").
 * @param {import('@playwright/test').Page} page @returns {Promise<void>}
 */
async function assertTablesHaveHeadings(page) {
  const tables = page.locator('table');
  const n = await tables.count();
  for (let i = 0; i < n; i += 1) {
    const table = tables.nth(i);
    const classAttr = await table.getAttribute('class');
    await expect(table.locator('thead th').first(), `table${classAttr ? `.${classAttr}` : ''} has a thead th`).toBeAttached();
  }
}

/**
 * Statically reads `--color-bg`'s declared value off the one rule whose
 * `selectorText` is exactly `selector`, anywhere in the page's CSSOM --
 * recursing into grouping rules (`@layer`, `@media`, ...), since the
 * build wraps every source file in its own `@layer` (spec "1. Layers,
 * applied by the build") and the engine's two dark blocks each sit
 * inside `@media (prefers-color-scheme: dark)` or a plain attribute
 * selector. This reads the rule as authored, independent of which rule
 * is actually winning the live cascade right now -- see
 * `assertDarkBodyBackground` for why that independence matters.
 * @param {import('@playwright/test').Page} page @param {string} selector @returns {Promise<string|null>}
 */
function colorBgDeclaredOn(page, selector) {
  return page.evaluate((sel) => {
    /** @param {CSSRuleList} rules @returns {string|null} */
    function search(rules) {
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSStyleRule && rule.selectorText === sel) {
          const v = rule.style.getPropertyValue('--color-bg').trim();
          if (v) return v;
        }
        if ('cssRules' in rule && rule.cssRules) {
          const nested = search(rule.cssRules);
          if (nested) return nested;
        }
      }
      return null;
    }
    for (const sheet of Array.from(document.styleSheets)) {
      let rules;
      try { rules = sheet.cssRules; } catch { continue; }
      const found = search(rules);
      if (found) return found;
    }
    return null;
  }, selector);
}

/**
 * Review Focus 1's browser half: in a browser emulating dark mode,
 * `body`'s rendered background must be the engine's dark `--color-bg`
 * from `tokens.css`, never the light value a site's `theme.css` sets
 * on a plain `:root` (the bundled example's theme sets `--color-bg` there
 * for exactly this reason). That holds because the build puts the theme
 * in the tokens layer, right after `tokens.css` (spec "1. Layers, applied
 * by the build"); a separate, later layer would let it win. No-op
 * outside dark mode.
 *
 * Both the expected light *and* dark values are read statically off
 * their own source rules via the CSSOM, never off the live cascade
 * (fix round 1, Critical): reading the "expected dark" value live, off
 * `document.documentElement`, made the first assertion true by
 * construction -- `body`'s own background is `var(--color-bg)` with
 * nothing redeclaring it in between, so it always equals whatever
 * `--color-bg` resolves to live, dark value or a leaked light one
 * alike. Worse, if a leak made the live value equal the light one, the
 * second assertion's `resolvedLight !== resolvedDark` guard went false
 * and skipped it too -- exactly the case it exists to catch. Sourcing
 * both independently of the live cascade breaks the circularity: now
 * "the dark value" means what the engine's own dark rule declares, not
 * whatever happens to be cascading.
 * @param {import('@playwright/test').Page} page @returns {Promise<void>}
 */
async function assertDarkBodyBackground(page) {
  const isDark = await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches);
  if (!isDark) return;

  // A visitor who explicitly forced light (`data-theme="light"`) really
  // does see light, whatever the OS/emulated preference -- that's the
  // switch working, not a leak -- so there is no engine dark rule in
  // effect here to compare against (`docs/site-settings.md`, "Light and
  // dark": `:root:not([data-theme="light"])` -- note `:not` -- is the
  // device/media-query block, and only `:root[data-theme="dark"]` is the
  // visitor's own forced-dark choice).
  const explicitTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  if (explicitTheme === 'light') return;

  const lightValue = await colorBgDeclaredOn(page, ':root');
  expect(lightValue, 'found the engine light --color-bg declaration').not.toBeNull();

  // Whichever of the two kept-in-sync dark blocks actually governs here:
  // the visitor's own forced-dark choice if they made one, else the
  // device/media-query block that otherwise shows dark mode.
  const darkSelector = explicitTheme === 'dark' ? ':root[data-theme="dark"]' : ':root:not([data-theme="light"])';
  const darkValue = await colorBgDeclaredOn(page, darkSelector);
  expect(darkValue, `found the engine dark --color-bg declaration (${darkSelector})`).not.toBeNull();

  // Resolve both token values the way the browser would, via a probe
  // element (CSSOM, never a `style=` attribute -- the CSP allows this),
  // so colours compare as the same serialisation `body`'s own computed
  // style uses.
  const resolve = (/** @type {string} */ value) => page.evaluate((v) => {
    const probe = document.createElement('div');
    probe.style.setProperty('background-color', v);
    document.body.append(probe);
    const out = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return out;
  }, value);
  const resolvedDark = await resolve(/** @type {string} */ (darkValue));
  const resolvedLight = await resolve(/** @type {string} */ (lightValue));

  const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bodyBg, 'body background is the dark --color-bg').toBe(resolvedDark);
  if (resolvedLight !== resolvedDark) {
    expect(bodyBg, 'body background is not the light --color-bg leaking into dark mode').not.toBe(resolvedLight);
  }
}

/**
 * The structure every page must have (spec "6. Enforcement"): a
 * `<header>` and `main.container` from the shell (Task 6, "the shell is
 * not optional"); every visible button/input/select/textarea in the
 * body font, at least a 24x24 target (checkbox/radio by label); every
 * table with a header row; and, in dark mode, the engine's dark
 * `--color-bg`, never a site's light value (Review Focus 1).
 * @param {import('@playwright/test').Page} page @returns {Promise<void>}
 */
export async function assertPageStructure(page) {
  // The shell's `<header>` only -- a page section (the import review's
  // job/card headings) can have its own `<header>` too, but nested
  // inside sectioning content it carries no `banner` landmark role, so
  // this stays a single match (HTML spec, "The header element").
  await expect(page.getByRole('banner')).toBeVisible();
  await expect(page.locator('main.container')).toBeVisible();
  await assertControlsUseBodyFont(page);
  await assertTargetSizes(page);
  await assertTablesHaveHeadings(page);
  await assertDarkBodyBackground(page);
}

/**
 * A console error Chromium logs for the top-level navigation itself
 * returning a non-2xx status -- unavoidable on the 404 page, which by
 * definition really does answer 404 (ruling 3: an allowlist kept to an
 * exact message, with this comment, since routing it away via page.route
 * would mean no longer testing the real 404 response).
 */
const EXPECTED_404_NAVIGATION_ERROR = 'Failed to load resource: the server responded with a status of 404 (Not Found)';

/**
 * The checks every page gets: a 200 (or `status`), no console/page/CSP
 * errors, no horizontal scroll, no serious/critical axe violations, and
 * -- Styling system Task 8 -- the page's structure (`assertPageStructure`).
 * @param {import('@playwright/test').Page} page @param {string} path @param {{ status?: number }} [options]
 * @returns {Promise<void>}
 */
export async function checkPage(page, path, { status = 200 } = {}) {
  await stubSyntheticMedia(page);
  const errors = await trackErrors(page);
  const response = await gotoReady(page, path);
  expect(response?.status(), path).toBe(status);
  await assertNoHorizontalScroll(page);
  await assertNoSeriousA11yViolations(page);
  await assertPageStructure(page);
  expect(errors.filter((e) => !(status === 404 && e === EXPECTED_404_NAVIGATION_ERROR)), path).toEqual([]);
}

/**
 * Signs the page's browser context in as `as`, through a page on the
 * origin the app uses -- the me page's own signed-out screen, which loads
 * no media, so nothing from a richer page is still in flight when the
 * caller's checks start. The caller navigates next, so `checkPage` sees a
 * fresh load with the session already in place. `POST /api/auth/dev`
 * (src/routes/authDev.js) only exists when the dev server runs with
 * `DEV_SIGN_IN=1` (this file's re-exported `devServer`); it is a 404 in production.
 * @param {import('@playwright/test').Page} page
 * @param {'owner'|'member'|'google'|'translator'} as
 * @returns {Promise<void>}
 */
export async function signInAs(page, as) {
  await gotoReady(page, '/me');
  const status = await page.evaluate(async (who) => {
    const res = await fetch('/api/auth/dev', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ as: who }),
    });
    return res.status;
  }, as);
  expect(status, 'the dev-only sign-in route answered').toBe(200);
}

/** The four browser projects both specs run: the brief's two widths, light and dark (review round 2, I1). */
export const PROJECTS = [
  { name: 'phone', use: { browserName: /** @type {const} */ ('chromium'), viewport: { width: 390, height: 844 }, colorScheme: /** @type {const} */ ('light') } },
  { name: 'desktop', use: { browserName: /** @type {const} */ ('chromium'), viewport: { width: 1280, height: 800 }, colorScheme: /** @type {const} */ ('light') } },
  { name: 'phone-dark', use: { browserName: /** @type {const} */ ('chromium'), viewport: { width: 390, height: 844 }, colorScheme: /** @type {const} */ ('dark') } },
  { name: 'desktop-dark', use: { browserName: /** @type {const} */ ('chromium'), viewport: { width: 1280, height: 800 }, colorScheme: /** @type {const} */ ('dark') } },
];
