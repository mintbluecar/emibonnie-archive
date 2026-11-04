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
  await expect(page.locator('.c-owner a[href="/admin/events"]')).toBeVisible();
});

test('the events list: accessible, and two ticks make merge a link', async ({ page }) => {
  await signInAs(page, 'owner');
  await checkPage(page, '/admin/events');
  const merge = page.locator('[data-admin-events-merge]');
  await expect(merge).toBeDisabled();
  const ticks = page.locator('[data-action="tick"]');
  await ticks.nth(0).check();
  await expect(merge).toBeDisabled();
  await ticks.nth(1).check();
  await expect(merge).toHaveAttribute('href', /^\/admin\/events\/edit\?merge=\d+,\d+$/);
  await expect(page.locator('[data-admin-events-ticked]')).toHaveText('2 ticked');
});

test('the edit event page: accessible, and a changed title saves', async ({ page }, testInfo) => {
  await signInAs(page, 'owner');
  await gotoReady(page, '/admin/events');
  const href = await page.locator('a[href^="/admin/events/edit?id="]').first().getAttribute('href');
  expect(href).toBeTruthy();
  await checkPage(page, String(href));
  test.skip(testInfo.project.name !== 'phone', 'writes to the shared e2e data; one project runs it');

  const id = Number(new URL(String(href), 'http://x').searchParams.get('id'));
  const before = await page.evaluate(async (eventId) => (await fetch(`/api/owner/events/${eventId}`)).json(), id);
  try {
    const name = page.locator('[data-event-name]');
    await name.fill(`${before.name} (e2e)`);
    await page.locator('[data-event-edit-form] [type="submit"]').click();
    await expect(page.locator('[data-notice="saved"]')).toBeVisible();
    await page.reload();
    await expect(page.locator('[data-event-name]')).toHaveValue(`${before.name} (e2e)`);
  } finally {
    // Put the event back for the other specs, whatever failed above. The
    // slug's own tag half re-addresses it to the same slug.
    const status = await page.evaluate(async (event) => {
      const fields = {
        name: event.name, occurredOn: event.occurredOn, keywords: event.keywords, hashtags: event.hashtags,
        livePeopleIds: event.livePeopleIds, livePlatformCode: event.livePlatformCode,
        addressTag: event.slug.slice(event.slug.indexOf('/') + 1),
      };
      const res = await fetch(`/api/owner/events/${event.id}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(fields),
      });
      return res.status;
    }, before);
    expect(status).toBe(200);
  }
});

test('the tweets in an event: day groups, accessible, read-only', async ({ page }) => {
  await signInAs(page, 'owner');
  await gotoReady(page, '/me');
  // The first event with an entry; nothing here writes, so every project runs it.
  const id = await page.evaluate(async () => {
    const { events } = await (await fetch('/api/owner/events')).json();
    return events.find((/** @type {{ entryCount: number }} */ e) => e.entryCount > 0)?.id ?? null;
  });
  expect(id).toBeTruthy();
  await checkPage(page, `/admin/events/entries?id=${id}`);
  await expect(page.locator('[data-day]').first()).toBeVisible();
  await expect(page.locator('[data-action="move"]')).toBeDisabled();
  await page.locator('[data-action="tick"]').first().check();
  await expect(page.locator('[data-event-entries-new]')).toHaveAttribute('href', new RegExp(`^/admin/events/edit\\?from=${id}&items=\\d+$`));
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
