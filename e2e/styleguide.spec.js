// @ts-check
/**
 * Styling system Task 3 brief, Step 1: the dev-only style guide at
 * `/dev/styleguide` (`scripts/dev.js`, `scripts/styleguide.js`). Runs in
 * all four `PROJECTS` (phone/desktop, light/dark, playwright.config.js),
 * since the on-brand defaults and the focus ring (Review Focus 4) must
 * hold in both themes. This page is never deployed and renders no
 * `#app`, so it doesn't use `gotoReady`/`checkPage` from `e2e/helpers.js`.
 */
import { test, expect } from '@playwright/test';

/** `#elements`' bare controls, in DOM/tab order. */
const ELEMENT_SELECTORS = [
  'button',
  'input[type="text"]',
  'input[type="search"]',
  'select',
  'textarea',
  'input[type="checkbox"]',
  'input[type="radio"]',
  'a',
];

/**
 * A `tokens.css` custom property's resolved value, as the browser sees it.
 * @param {import('@playwright/test').Page} page @param {string} name @returns {Promise<string>}
 */
function tokenValue(page, name) {
  return page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
}

test.describe('style guide (/dev/styleguide): #elements', () => {
  test('bare controls use the body font', async ({ page }) => {
    await page.goto('/dev/styleguide');
    const bodyFont = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    for (const selector of ELEMENT_SELECTORS) {
      const font = await page.locator(`#elements ${selector}`).first().evaluate((el) => getComputedStyle(el).fontFamily);
      expect(font, selector).toBe(bodyFont);
    }
  });

  test('bare controls look like controls', async ({ page }) => {
    await page.goto('/dev/styleguide');
    const radiusMd = await tokenValue(page, '--radius-md');
    const space2 = parseFloat(await tokenValue(page, '--space-2'));

    const button = await page.locator('#elements button').first().evaluate((el) => {
      const s = getComputedStyle(el);
      return { borderColor: s.borderTopColor, borderWidth: parseFloat(s.borderTopWidth), borderRadius: s.borderTopLeftRadius };
    });
    expect(button.borderColor, 'button border colour is not transparent').not.toMatch(/^rgba\(.*, 0\)$/);
    expect(button.borderWidth).toBeGreaterThan(0);
    expect(button.borderRadius).toBe(radiusMd);

    for (const selector of ['input[type="text"]', 'input[type="search"]', 'select', 'textarea']) {
      const field = await page.locator(`#elements ${selector}`).first().evaluate((el) => {
        const s = getComputedStyle(el);
        return {
          paddingTop: parseFloat(s.paddingTop),
          paddingLeft: parseFloat(s.paddingLeft),
          borderWidth: parseFloat(s.borderTopWidth),
          borderColor: s.borderTopColor,
          borderRadius: s.borderTopLeftRadius,
        };
      });
      expect(Math.min(field.paddingTop, field.paddingLeft), selector).toBeGreaterThanOrEqual(space2);
      expect(field.borderWidth, selector).toBeGreaterThan(0);
      expect(field.borderColor, selector).not.toMatch(/^rgba\(.*, 0\)$/);
      expect(field.borderRadius, selector).toBe(radiusMd);
    }

    const select = await page.locator('#elements select').first().evaluate((el) => {
      const s = getComputedStyle(el);
      return { appearance: s.appearance, backgroundImage: s.backgroundImage };
    });
    expect(select.appearance).toBe('none');
    expect(select.backgroundImage, 'a visible chevron drawn as a background').not.toBe('none');

    const thWeight = await page.locator('#elements th').first().evaluate((el) => Number(getComputedStyle(el).fontWeight));
    expect(thWeight).toBeGreaterThanOrEqual(700);
  });

  test('focus is visible: tabbing to every control shows a ring from the focus tokens', async ({ page }) => {
    await page.goto('/dev/styleguide');
    const ringWidth = await tokenValue(page, '--focus-ring-width');

    for (const selector of ELEMENT_SELECTORS) {
      await page.keyboard.press('Tab');
      const onTarget = await page.evaluate((sel) => document.activeElement?.matches(`#elements ${sel}`) ?? false, selector);
      expect(onTarget, `Tab landed on ${selector}`).toBe(true);
      const outline = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el) return null;
        const s = getComputedStyle(el);
        return { style: s.outlineStyle, width: s.outlineWidth };
      });
      expect(outline?.style, selector).not.toBe('none');
      expect(outline?.width, selector).toBe(ringWidth);
    }
  });

  test('targets are at least 24px: a checkbox/radio\'s own box is small, but its label is at least 24x24', async ({ page }) => {
    await page.goto('/dev/styleguide');
    // The label's box depends on the line's font metrics: wait for the
    // self-hosted font to actually swap in (font-display: swap can still
    // be on the fallback font right after load under heavy parallel load),
    // so the measurement is never taken mid-swap.
    await page.evaluate(() => document.fonts.ready);
    for (const type of ['checkbox', 'radio']) {
      const label = page.locator(`#elements label:has(input[type="${type}"])`).first();
      const box = await label.boundingBox();
      expect(box, type).not.toBeNull();
      const { width, height } = /** @type {{ width: number, height: number }} */ (box);
      expect(width, `${type} label width`).toBeGreaterThanOrEqual(24);
      expect(height, `${type} label height`).toBeGreaterThanOrEqual(24);
    }
  });
});
