// @ts-check
/**
 * Plan 2b Task 13: the owner section on the me page. The mutating test
 * runs in one project (the projects share the writable e2e database);
 * every project checks the signed-in page's accessibility.
 */
import { test, expect } from '@playwright/test';
import { checkPage, signInAs, gotoReady } from './helpers.js';

const SUBBED = '1900000000000000018';
const LIVE = '1900000000000000004';
const tweetUrl = (id) => `https://x.com/solluna/status/${id}`;

test('me as the owner: the owner section, the switch and an accessible page', async ({ page }) => {
  await signInAs(page, 'owner');
  await checkPage(page, '/me');
  await expect(page.locator('.c-owner')).toBeVisible();
  await expect(page.locator('[data-action="approval"]')).toBeVisible();
  await expect(page.locator('[data-owner-search]')).toBeVisible();
});

test('the owner approves a held entry, hides and restores a report, and blocks a user', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'writes to the shared e2e data; one project runs it');

  await signInAs(page, 'owner');
  await gotoReady(page, '/me');

  // Make sure there is a member to block, then come back as the owner.
  await page.evaluate(async () => {
    await fetch(`${location.origin}/api/auth/dev`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ as: 'member' }),
    });
  });
  await signInAs(page, 'owner');
  await gotoReady(page, '/me');

  // Approval on, then an add waits for the owner.
  const approval = page.locator('[data-action="approval"]');
  if (!(await approval.isChecked())) await approval.check();
  const added = await page.evaluate(async (url) => {
    const res = await fetch('/api/add', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }),
    });
    return { status: res.status, text: await res.text() };
  }, tweetUrl(SUBBED));
  expect(added.status, added.text).toBe(200);
  await page.reload();
  await expect(page.locator('[data-action="approve"]').first()).toBeVisible();
  await page.locator('[data-action="approve"]').first().click();
  await expect(page.locator('[data-action="approve"]')).toHaveCount(0);

  // A report: hide the entry, then restore it.
  await page.evaluate(async (sourceId) => {
    await fetch('/api/reports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target: { type: 'item', kind: 'translation', sourceId }, reason: 'owner e2e report' }),
    });
  }, LIVE);
  await page.reload();
  const reportRow = page.locator('tr', { hasText: 'owner e2e report' });
  await expect(reportRow).toBeVisible();
  await reportRow.locator('[data-action="hide-report"]').click();
  await expect(page.locator('tr', { hasText: 'owner e2e report' }).locator('[data-action="restore-report"]')).toBeVisible();
  await page.locator('tr', { hasText: 'owner e2e report' }).locator('[data-action="restore-report"]').click();
  await expect(page.locator('tr', { hasText: 'owner e2e report' }).locator('[data-action="hide-report"]')).toBeVisible();

  // Users: search, block, unblock.
  await page.locator('[data-owner-query]').fill('dev_member');
  await page.locator('[data-owner-query]').press('Enter');
  const userRow = page.locator('tr', { hasText: '@dev_member' });
  await expect(userRow).toBeVisible();
  await userRow.locator('[data-action="block"]').click();
  await expect(page.locator('tr', { hasText: '@dev_member' }).locator('[data-action="unblock"]')).toBeVisible();
  await page.locator('tr', { hasText: '@dev_member' }).locator('[data-action="unblock"]').click();

  // Leave the switch off for the other specs.
  if (await approval.isChecked()) await approval.uncheck();
});
