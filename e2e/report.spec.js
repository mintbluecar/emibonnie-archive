// @ts-check
/**
 * Plan 2b Task 12: the public report form on an item page. One project
 * submits (reports are rate-limited per IP, and the projects share one
 * server); every project checks the open dialog's accessibility.
 */
import { test, expect } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { gotoReady } from './helpers.js';

// An entry neither mutating spec touches (they share a database).
const TARGET = '1900000000000000002';

test('the report dialog is accessible at both widths', async ({ page }) => {
  await gotoReady(page, `/t/${TARGET}`);
  await page.locator('[data-action="report"]').click();
  await expect(page.locator('.c-report')).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''))).toEqual([]);
});

test('reporting an item shows the thank-you and keeps the dialog usable', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'one submission: the per-IP report limit is shared');
  await gotoReady(page, `/t/${TARGET}`);
  await page.locator('[data-action="report"]').click();
  await page.locator('.c-report__reason').fill('wrong credit');
  await page.locator('.c-report__submit').click();
  await expect(page.locator('[data-report-status]')).toHaveText('thanks — the owner will look at it');
  await expect(page.locator('.c-report__submit')).toBeDisabled();
});
