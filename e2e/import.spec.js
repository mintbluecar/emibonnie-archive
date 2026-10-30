// @ts-check
/**
 * Plan 3 Task 10: the import review page's marker card and publish bar, in
 * a real browser. The owner dev-seeds a real job from two offline
 * fixtures, maps the marker in bulk, publishes, and the entry becomes
 * publicly readable.
 *
 * It runs in `playwright.add.config.js` (its own writable database).
 * The write passes run once (phone, light): the four projects share that
 * database, so seeding the same fixtures again in the next project would
 * come back `duplicate` and leave no marker to map. The accessibility
 * check runs in every project, on a job each project seeds itself.
 */
import { test, expect } from '@playwright/test';
import { checkPage, gotoReady, signInAs } from './helpers.js';

/** `IDS.IMPORT_MARKERS`: one marker used twice, and no other speaker. */
const MARKER_ID = '1900000000000000019';
/** `IDS.LONG_QUOTED`: a second fixture with no markers, so the job has two rows. */
const SECOND_ID = '1900000000000000000';
/** `IDS.IMPORT_HELD`: a plain post with no markers, held for the edit-page publish. */
const HELD_ID = '1900000000000000020';

/** @param {string} id @returns {string} */
const tweetUrl = (id) => `https://x.com/solluna/status/${id}`;

/**
 * Creates a held job through the dev-only seed route, which ingests the
 * same way the CLI does. @param {import('@playwright/test').Page} page
 * @param {string[]} [ids] the fixtures to import
 * @returns {Promise<number>} the job id
 */
async function seedJob(page, ids = [MARKER_ID, SECOND_ID]) {
  const result = await page.evaluate(async (urls) => {
    const res = await fetch('/api/dev/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ urls }),
    });
    return { status: res.status, body: await res.json() };
  }, ids.map(tweetUrl));
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  expect(result.body.jobId).toBeTruthy();
  return result.body.jobId;
}

test('the owner maps the marker in bulk, publishes, and the entry goes public', async ({ page }, testInfo) => {
  await signInAs(page, 'owner');
  const jobId = await seedJob(page);

  // The page loads and is accessible at this project's width and theme.
  await checkPage(page, `/admin/imports/${jobId}`);

  if (testInfo.project.name !== 'phone') return;

  // The job's held entries carry their translator and the marker card.
  const card = page.locator('.c-import-speakers__card').first();
  await expect(card).toBeVisible();
  await expect(card).toContainText('@tl_beta');

  // One marker, used twice: the card says so, and it starts held.
  const marker = card.locator('.c-import-speakers__marker').first();
  await expect(marker).toContainText('A');
  await expect(marker.locator('.c-import-speakers__check')).toBeVisible();

  // Styling system Task 3, fix round 1: the speaker select must keep a
  // real dropdown indicator -- either base.css's own chevron (appearance: none, a
  // background-image) or, failing that, the native arrow (appearance
  // left alone). A `background:` shorthand on the component rule once
  // cancelled the chevron with nothing to replace it.
  const select = marker.locator('[data-marker-select]');
  const indicator = await select.evaluate((el) => {
    const s = getComputedStyle(el);
    return { backgroundImage: s.backgroundImage, appearance: s.appearance };
  });
  expect(
    indicator.backgroundImage !== 'none' || indicator.appearance !== 'none',
    `speaker select has neither a chevron nor the native arrow: ${JSON.stringify(indicator)}`,
  ).toBe(true);

  // Map it in bulk to a role: every entry using it is filled, and the row
  // becomes ready to publish.
  await marker.locator('[data-marker-select]').selectOption('role:fan');
  await marker.locator('[data-action="save-marker"]').click();
  await expect(page.locator('.c-import-speakers__card')).toHaveCount(0);

  // Publish the ready rows, then check the entry itself is public now.
  await page.locator('[data-action="publish-ready"]').click();
  await expect(page.locator('.c-import__state--published').first()).toBeVisible();
  const entry = await gotoReady(page, `/t/${MARKER_ID}`);
  expect(entry?.status()).toBe(200);
  await expect(page.locator('body')).toContainText('first translated line about the night.');

  // The owner's me page lists the job with a link to its review page.
  await gotoReady(page, '/me');
  await expect(page.locator(`.c-owner__link[href="/admin/imports/${jobId}"]`)).toBeVisible();
});

test('the owner opens a held entry and publishes it from the edit page', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'publishes the held fixture; the shared e2e database takes it once');
  await signInAs(page, 'owner');
  const jobId = await seedJob(page, [HELD_ID]);
  expect(jobId).toBeTruthy();

  // Held: the owner sees the banner and only the owner can open it.
  await gotoReady(page, `/t/${HELD_ID}`);
  await expect(page.locator('.c-item__held')).toBeVisible();

  // The edit page offers save & publish, and is accessible.
  await checkPage(page, `/edit/translation/${HELD_ID}`);
  await expect(page.locator('.c-item__held')).toBeVisible();
  const publish = page.locator('[data-action="save-publish"]');
  await expect(publish).toBeVisible();

  // Publishing from here (no changes to save) makes the entry public.
  await publish.click();
  await expect(page.locator('.c-item__held')).toHaveCount(0);
  await expect(page.locator('.c-edit__published')).toBeVisible();
  const entry = await gotoReady(page, `/t/${HELD_ID}`);
  expect(entry?.status()).toBe(200);
  await expect(page.locator('.c-item__held')).toHaveCount(0);
});
