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

/**
 * A CSS value as the browser computes it for `property`, from a probe
 * element given `value` (e.g. a token's `var()`) -- so a primitive's
 * computed style can be compared with what its token resolves to in the
 * same serialisation. CSSOM (`el.style`), not a `style` attribute, so
 * the CSP's `style-src 'self'` is no obstacle.
 * @param {import('@playwright/test').Page} page @param {string} property @param {string} value @returns {Promise<string>}
 */
function resolved(page, property, value) {
  return page.evaluate(([prop, val]) => {
    const probe = document.createElement('div');
    probe.style.setProperty(prop, val);
    document.body.append(probe);
    const out = getComputedStyle(probe).getPropertyValue(prop);
    probe.remove();
    return out;
  }, [property, value]);
}

/**
 * The computed value of `property` on the first match of `selector`.
 * @param {import('@playwright/test').Page} page @param {string} selector @param {string} property @param {string} [pseudo] @returns {Promise<string>}
 */
function computed(page, selector, property, pseudo) {
  return page.locator(selector).first().evaluate((el, [prop, ps]) => getComputedStyle(el, ps || null).getPropertyValue(prop), [property, pseudo ?? '']);
}

/** The primitive sections (Task 4), in page order. */
const PRIMITIVE_SECTIONS = ['#button', '#field', '#card', '#table', '#chip', '#badge', '#notice', '#segmented', '#text', '#spacing'];

/**
 * WCAG contrast of two computed colours (opaque): `rgb(r, g, b)` with
 * 0-255 channels, or -- what a color-mix() token computes to --
 * `color(srgb r g b)` with 0-1 channels.
 * @param {string} a @param {string} b @returns {number}
 */
function contrastOf(a, b) {
  const lum = (/** @type {string} */ c) => {
    const scale = c.startsWith('color(srgb') ? 1 : 255;
    const [r, g, bl] = (c.replace(/^color\(srgb/, '').match(/[\d.]+/g) ?? []).slice(0, 3).map(Number).map((v) => {
      const s = v / scale;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test.describe('style guide (/dev/styleguide): primitives', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dev/styleguide');
    await page.evaluate(() => document.fonts.ready);
  });

  test('every primitive has its section', async ({ page }) => {
    for (const id of PRIMITIVE_SECTIONS) await expect(page.locator(`section${id}`), id).toHaveCount(1);
  });

  test('button: primary is the gradient, quiet is text-like, danger is the danger colour, sizes from tokens', async ({ page }) => {
    expect(await computed(page, '#button .btn--primary', 'background-image')).toContain('linear-gradient');
    expect(await computed(page, '#button .btn--primary', 'color')).toBe(await resolved(page, 'color', 'var(--color-accent-text)'));

    expect(await computed(page, '#button .btn--secondary', 'background-color')).toBe(await resolved(page, 'background-color', 'var(--color-card)'));
    expect(await computed(page, '#button .btn:not([class*="btn--"])', 'background-color')).toBe(await resolved(page, 'background-color', 'var(--color-card)'));

    expect(await computed(page, '#button .btn--quiet', 'background-color')).toBe('rgba(0, 0, 0, 0)');
    expect(await computed(page, '#button .btn--quiet', 'border-top-color')).toBe('rgba(0, 0, 0, 0)');
    expect(await computed(page, '#button .btn--quiet', 'color')).toBe(await resolved(page, 'color', 'var(--color-label)'));

    expect(await computed(page, '#button .btn--danger', 'color')).toBe(await resolved(page, 'color', 'var(--color-danger)'));

    const tap = parseFloat(await resolved(page, 'height', 'var(--tap-target)'));
    const box = async (/** @type {string} */ sel) => /** @type {{ width: number, height: number }} */ (await page.locator(sel).first().boundingBox());
    expect((await box('#button .btn--primary')).height).toBeGreaterThanOrEqual(tap);
    const sm = await box('#button .btn--sm:not(.btn--icon)');
    expect(sm.height).toBeGreaterThanOrEqual(32);
    expect(sm.height).toBeLessThan(tap);

    const icon = await box('#button .btn--icon:not(.btn--sm)');
    expect(icon.width).toBeCloseTo(icon.height, 0);
    expect(await page.locator('#button .btn--icon:not([aria-label])')).toHaveCount(0);

    // A toggle (aria-pressed): pressed takes the label tint and colour, not pressed stays secondary.
    expect(await computed(page, '#button .btn[aria-pressed="true"]', 'background-color')).toBe(await resolved(page, 'background-color', 'var(--color-label-tint)'));
    expect(await computed(page, '#button .btn[aria-pressed="true"]', 'color')).toBe(await resolved(page, 'color', 'var(--color-label-on-tint)'));
    expect(await computed(page, '#button .btn[aria-pressed="false"]', 'background-color')).toBe(await resolved(page, 'background-color', 'var(--color-card)'));
    // A quiet toggle stays text: muted when off, the label colour (no tint) when on.
    expect(await computed(page, '#button .btn--quiet[aria-pressed="false"]', 'color')).toBe(await resolved(page, 'color', 'var(--color-ink-muted)'));
    expect(await computed(page, '#button .btn--quiet[aria-pressed="true"]', 'color')).toBe(await resolved(page, 'color', 'var(--color-label)'));
    expect(await computed(page, '#button .btn--quiet[aria-pressed="true"]', 'background-color')).toBe('rgba(0, 0, 0, 0)');

    const block = await box('#button .btn--block');
    const parent = await page.locator('#button .btn--block').first().evaluate((el) => /** @type {HTMLElement} */ (el.parentElement).clientWidth);
    expect(block.width).toBeCloseTo(parent, 0);
  });

  test('field: label, control, hint and error stack; one chevron on field__select; error in the danger colour', async ({ page }) => {
    expect(await computed(page, '#field .field', 'display')).toBe('flex');
    expect(await computed(page, '#field .field', 'flex-direction')).toBe('column');
    expect(await computed(page, '#field .field__error', 'color')).toBe(await resolved(page, 'color', 'var(--color-danger)'));
    expect(await computed(page, '#field .field__hint', 'color')).toBe(await resolved(page, 'color', 'var(--color-ink-muted)'));

    const tap = parseFloat(await resolved(page, 'height', 'var(--tap-target)'));
    for (const sel of ['#field .field input[type="text"]', '#field .field__select select', '#field .field textarea']) {
      const { height } = /** @type {{ height: number }} */ (await page.locator(sel).first().boundingBox());
      expect(height, sel).toBeGreaterThanOrEqual(tap);
    }

    // base.css's select chevron is the one chevron (controller ruling): the wrapper draws none.
    expect(await computed(page, '#field .field__select select', 'background-image')).not.toBe('none');
    expect(await computed(page, '#field .field__select', 'content', '::after')).toMatch(/^(none|normal)$/);
    const wrapper = /** @type {{ width: number }} */ (await page.locator('#field .field__select').first().boundingBox());
    const select = /** @type {{ width: number }} */ (await page.locator('#field .field__select select').first().boundingBox());
    expect(select.width).toBeCloseTo(wrapper.width, 0);
  });

  test('card: the card surface, shadow and radius from tokens, padding sizes', async ({ page }) => {
    expect(await computed(page, '#card .card', 'box-shadow')).toBe(await resolved(page, 'box-shadow', 'var(--shadow-card)'));
    expect(await computed(page, '#card .card', 'border-top-left-radius')).toBe(await resolved(page, 'border-top-left-radius', 'var(--radius-card)'));
    expect(await computed(page, '#card .card', 'background-color')).toBe(await resolved(page, 'background-color', 'var(--color-card)'));
    expect(await computed(page, '#card .card--compact', 'padding-top')).toBe(await resolved(page, 'padding-top', 'var(--space-3)'));
    expect(await computed(page, '#card .card--roomy', 'padding-top')).toBe(await resolved(page, 'padding-top', 'var(--space-5)'));
  });

  test('table: header row, numeric and actions columns right-aligned; table--stack stacks below 860px with each cell\'s column name', async ({ page }) => {
    await expect(page.locator('#table table.table thead th').first()).toBeVisible();
    expect(await computed(page, '#table .table__num', 'text-align')).toBe('right');
    expect(await computed(page, '#table td.table__actions', 'text-align')).toBe('right');
    await expect(page.locator('#table td.table__actions .cluster .btn').first()).toBeVisible();

    const phone = /** @type {{ width: number }} */ (page.viewportSize()).width < 860;
    const row = '#table .table--stack tbody tr';
    const cell = '#table .table--stack tbody td[data-label]';
    const label = await page.locator(cell).first().getAttribute('data-label');
    if (phone) {
      expect(await computed(page, row, 'display')).toBe('block');
      expect(await computed(page, cell, 'content', '::before')).toBe(`"${label}"`);
      // Visually hidden, still there for screen readers.
      const head = /** @type {{ width: number, height: number }} */ (await page.locator('#table .table--stack thead').boundingBox());
      expect(head.width * head.height).toBeLessThanOrEqual(1);
      const noScroll = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
      expect(noScroll, 'no horizontal scroll').toBe(true);
    } else {
      expect(await computed(page, row, 'display')).toBe('table-row');
      expect(await computed(page, cell, 'content', '::before')).toMatch(/^(none|normal)$/);
      await expect(page.locator('#table .table--stack thead th').first()).toBeVisible();
    }
  });

  test('chip: a pill, an on state and a count', async ({ page }) => {
    expect(await computed(page, '#chip .chip', 'border-top-left-radius')).toBe(await resolved(page, 'border-top-left-radius', 'var(--radius-pill)'));
    expect(await computed(page, '#chip .chip--on', 'background-color')).not.toBe(await computed(page, '#chip .chip:not(.chip--on)', 'background-color'));
    await expect(page.locator('#chip .chip .chip__count').first()).toBeVisible();
    // Only a chip that does something shows the pointer.
    expect(await computed(page, '#chip button.chip', 'cursor')).toBe('pointer');
    expect(await computed(page, '#chip span.chip', 'cursor')).toBe('auto');
    // chip--lg: at least --control-md tall, bold, and taller than a plain chip.
    const md = parseFloat(await resolved(page, 'height', 'var(--control-md)'));
    const lg = /** @type {{ height: number }} */ (await page.locator('#chip .chip--lg').first().boundingBox());
    const plain = /** @type {{ height: number }} */ (await page.locator('#chip .chip:not(.chip--lg)').first().boundingBox());
    expect(lg.height).toBeGreaterThanOrEqual(md);
    expect(lg.height).toBeGreaterThan(plain.height);
    expect(await computed(page, '#chip .chip--lg:not(.chip--on)', 'font-weight')).toBe('700');
  });

  test('badge: a pill; accent and danger variants from tokens', async ({ page }) => {
    expect(await computed(page, '#badge .badge', 'border-top-left-radius')).toBe(await resolved(page, 'border-top-left-radius', 'var(--radius-pill)'));
    expect(await computed(page, '#badge .badge--accent', 'background-color')).toBe(await resolved(page, 'background-color', 'var(--color-label-tint)'));
    expect(await computed(page, '#badge .badge--danger', 'color')).toBe(await resolved(page, 'color', 'var(--color-danger)'));
  });

  test('notice: info, error (the danger colour, outlined on the card) and accent', async ({ page }) => {
    // On the card, not on --color-danger-tint: the danger colour on its own tint is under 4.5:1 (4.05:1 light).
    expect(await computed(page, '#notice .notice--error', 'color')).toBe(await resolved(page, 'color', 'var(--color-danger)'));
    expect(await computed(page, '#notice .notice--error', 'border-top-color')).toBe(await resolved(page, 'border-top-color', 'var(--color-danger)'));
    expect(await computed(page, '#notice .notice--error', 'background-color')).toBe(await resolved(page, 'background-color', 'var(--color-card)'));
    expect(await computed(page, '#notice .notice--accent', 'background-color')).toBe(await resolved(page, 'background-color', 'var(--color-label-tint)'));
    expect(await computed(page, '#notice .notice--info', 'border-top-left-radius')).toBe(await resolved(page, 'border-top-left-radius', 'var(--radius-md)'));
    // notice--strong: the solid bar, card-colour text on the dark label shade, at least 4.5:1 in this theme.
    const strongBg = await computed(page, '#notice .notice--strong', 'background-color');
    const strongInk = await computed(page, '#notice .notice--strong', 'color');
    expect(strongBg).toBe(await resolved(page, 'background-color', 'var(--color-label-on-tint)'));
    expect(strongInk).toBe(await resolved(page, 'color', 'var(--color-card)'));
    expect(contrastOf(strongBg, strongInk)).toBeGreaterThanOrEqual(4.5);
  });

  test('segmented: one pill track, the pressed option tinted with the label colour, the others muted; options share the width', async ({ page }) => {
    expect(await computed(page, '#segmented .segmented', 'border-top-left-radius')).toBe(await resolved(page, 'border-top-left-radius', 'var(--radius-pill)'));
    expect(await computed(page, '#segmented .segmented', 'background-color')).toBe(await resolved(page, 'background-color', 'var(--color-card)'));
    const on = '#segmented .segmented__option[aria-pressed="true"]';
    const off = '#segmented .segmented__option[aria-pressed="false"]';
    expect(await computed(page, on, 'background-color')).toBe(await resolved(page, 'background-color', 'var(--color-label-tint)'));
    expect(await computed(page, on, 'color')).toBe(await resolved(page, 'color', 'var(--color-label-on-tint)'));
    expect(await computed(page, off, 'color')).toBe(await resolved(page, 'color', 'var(--color-ink-muted)'));
    expect(await computed(page, off, 'background-color')).toBe('rgba(0, 0, 0, 0)');
    const boxes = await page.locator('#segmented .segmented__option').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
    for (const w of boxes) expect(w).toBeCloseTo(boxes[0], 0);
  });

  test('text: meta is small and muted, label is the label colour, headings step down', async ({ page }) => {
    expect(await computed(page, '#text .meta', 'color')).toBe(await resolved(page, 'color', 'var(--color-ink-muted)'));
    expect(await computed(page, '#text .label', 'color')).toBe(await resolved(page, 'color', 'var(--color-label)'));
    const size = async (/** @type {string} */ sel) => parseFloat(await computed(page, sel, 'font-size'));
    expect(await size('#text .meta')).toBeLessThan(await size('#text p:not([class])'));
    expect(await size('#text .heading--lg')).toBeGreaterThan(await size('#text .heading--md'));
    expect(await size('#text .heading--md')).toBeGreaterThan(await size('#text .heading--sm'));
    expect(await computed(page, '#text .heading--md', 'font-family')).toBe(await resolved(page, 'font-family', 'var(--font-heading)'));
  });

  test('spacing: stack--n and cluster--n gaps are --space-n; a cluster wraps', async ({ page }) => {
    for (const n of [1, 2, 3, 4, 5, 6]) {
      const sel = `#spacing .stack--${n}`;
      expect(await computed(page, sel, 'flex-direction'), sel).toBe('column');
      expect(await computed(page, sel, 'row-gap'), sel).toBe(await resolved(page, 'row-gap', `var(--space-${n})`));
    }
    for (const n of [1, 2, 3, 4]) {
      const sel = `#spacing .cluster--${n}`;
      expect(await computed(page, sel, 'flex-wrap'), sel).toBe('wrap');
      expect(await computed(page, sel, 'column-gap'), sel).toBe(await resolved(page, 'column-gap', `var(--space-${n})`));
    }
  });

  test('focus is visible on every interactive primitive, btn--quiet and chips included (Review Focus 4)', async ({ page }) => {
    const ringWidth = await tokenValue(page, '--focus-ring-width');
    const scope = PRIMITIVE_SECTIONS.join(', ');
    // Every tab stop: enabled controls, and one radio per group (the checked one).
    const total = await page.locator(`:is(${scope}) :is(a[href], button:enabled, input:not([type="radio"]), input[type="radio"]:checked, select, textarea)`).count();
    /** @type {Set<string>} */
    const seen = new Set();
    let visited = 0;
    for (let i = 0; i < 200 && visited < total; i += 1) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate((sc) => {
        const el = document.activeElement;
        if (!el || el === document.body || !el.closest(sc)) return null;
        const s = getComputedStyle(el);
        return { cls: el.className, style: s.outlineStyle, width: s.outlineWidth };
      }, scope);
      if (!info) continue;
      visited += 1;
      for (const c of String(info.cls).split(/\s+/)) seen.add(c);
      expect(info.style, info.cls).not.toBe('none');
      expect(info.width, info.cls).toBe(ringWidth);
    }
    expect(visited, 'tabbed through every interactive primitive').toBe(total);
    expect(seen.has('btn--quiet'), 'tabbed to a btn--quiet').toBe(true);
    expect(seen.has('chip'), 'tabbed to a chip').toBe(true);
  });

  test('targets are at least 24x24 (WCAG 2.2 SC 2.5.8; a checkbox or radio measured on its label)', async ({ page }) => {
    const scope = PRIMITIVE_SECTIONS.join(', ');
    const targets = page.locator(`:is(${scope}) :is(a[href], button, select, textarea, input:not([type="checkbox"]):not([type="radio"]), label.check)`);
    const n = await targets.count();
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i += 1) {
      const el = targets.nth(i);
      const box = await el.boundingBox();
      const what = await el.evaluate((e) => `${e.tagName.toLowerCase()}.${e.className}`);
      expect(box, what).not.toBeNull();
      expect(/** @type {{ width: number }} */ (box).width, `${what} width`).toBeGreaterThanOrEqual(24);
      expect(/** @type {{ height: number }} */ (box).height, `${what} height`).toBeGreaterThanOrEqual(24);
    }
  });
});

test('layout: container--wide widens the container to 1200px', async ({ page }) => {
  await page.goto('/dev/styleguide');
  expect(await computed(page, '.container--wide', 'max-width')).toBe('1200px');
});
