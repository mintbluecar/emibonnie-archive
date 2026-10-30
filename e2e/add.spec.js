// @ts-check
/**
 * Plan 2a Task 13: the add page's three steps and the edit page, in a
 * real browser -- paste a link, check the details, who's speaking, save;
 * then the same steps for an entry that is already archived.
 *
 * Pasting only works offline because the dev server is started with
 * `INGEST_FIXTURES_DIR=test/fixtures/tweets` (playwright.add.config.js ->
 * e2e/helpers.js's `devServer`), so the API reads these fixtures instead
 * of X (api/index.js). Ids come from test/fixtures/tweets/build.mjs's
 * `IDS`; the two below are the ones the example seed does *not* already
 * archive (`examples/solluna/seed/maps.json`).
 *
 * This spec has its own run and database (`playwright.add.config.js`,
 * `npm run e2e:add`, the second half of `npm run e2e`) because it writes;
 * the read-only specs' counts and lists are pinned to the seed. Within
 * this run the two write tests still only run in one project (phone,
 * light): the four projects share that database, so the same fixture
 * added twice in parallel would come back `duplicate`. The read-only
 * checks below cover all four projects, which is where the axe sweep at
 * both widths in both themes comes from.
 */
import { test, expect } from '@playwright/test';
import { checkPage, gotoReady, signInAs, assertNoSeriousA11yViolations } from './helpers.js';

/** Both are `IDS.NO_MARKERS` / `IDS.EDITED_NEW`; neither is in the example seed. */
const NO_MARKERS = '1900000000000000017';
const EDITED_NEW = '1900000000000000016';
/** A seeded entry the owner may edit (`IDS.LONG`). */
const LONG = '1900000000000000001';

/** @param {string} id @returns {string} */
const tweetUrl = (id) => `https://x.com/solluna/status/${id}`;

/**
 * The write tests only run once: everything else (the per-page a11y
 * checks) runs in all four projects.
 * @param {import('@playwright/test').TestInfo} testInfo
 * @returns {void}
 */
function writesRunOnce(testInfo) {
  test.skip(testInfo.project.name !== 'phone', `this test adds items; the shared e2e database can only take one (ran in ${testInfo.project.name})`);
}

/**
 * Pastes `id`'s link on step 1 and waits for step 2.
 * @param {import('@playwright/test').Page} page @param {string} id
 * @returns {Promise<void>}
 */
async function pasteLink(page, id) {
  await page.locator('#c-add-url').fill(tweetUrl(id));
  await page.locator('[data-add-form] button[type="submit"]').click();
  await expect(page.locator('.c-add-details')).toBeVisible();
}

/**
 * The signed-in add page's step 1: the form, who is adding, and no
 * serious/critical axe violations at this project's width and theme.
 */
test('add, signed in: step 1 asks for the link and names who is adding, and axe is clean', async ({ page }) => {
  await signInAs(page, 'member');
  await checkPage(page, '/add');
  await expect(page.locator('.c-add-link__as')).toHaveText('adding as @dev_member');
  await expect(page.locator('#c-add-url')).toBeVisible();
  await expect(page.locator('.c-add__steps')).toBeVisible();
  await expect(page.locator('[data-add-form] .btn--primary')).toBeEnabled();
});

/**
 * The edit page as the owner, who may edit any archived entry: the same
 * step 2 and 3 components, one Save bar, the history list, and a clean
 * axe run -- including the speaker picker and the line-fix sheet open,
 * which a plain page load leaves hidden (their markup is shared with the
 * add page's step 3). Nothing is saved, so every project can run it.
 */
test('edit, as the owner: the steps, the picker and the sheet, a Save bar and the history, and axe is clean', async ({ page }) => {
  await signInAs(page, 'owner');
  await checkPage(page, `/edit/translation/${LONG}`);
  await expect(page.locator('.c-add-details')).toBeVisible();
  await expect(page.locator('.c-speaker-step')).toBeVisible();
  await expect(page.locator('.c-edit__actions [data-action="save"]')).toHaveText('save changes');
  await expect(page.locator('.c-edit__history')).toBeVisible();
  // The edit API takes an existing event only: no "new event" choice here.
  await expect(page.locator('#c-add-event option[value="new"]')).toHaveCount(0);

  // Open the sheet and the picker, then a marker's own picker, and run axe
  // again: those controls exist on the page but are hidden on load.
  await page.locator('.c-speaker-step__line').first().click();
  await page.locator('.c-line-fix [data-action="speech"]').click();
  await expect(page.locator('.c-line-fix__picker')).toBeVisible();
  await page.locator('.c-speaker-step__marker summary').first().click();
  await expect(page.locator('.c-speaker-step__marker').first().locator('[data-pick-person]').first()).toBeVisible();
  await assertNoSeriousA11yViolations(page);

  // The search box hides the people it doesn't match (the hidden
  // attribute must win over the chip's own display).
  const marker = page.locator('.c-speaker-step__marker').first();
  await marker.locator('[data-picker-search]').fill('no such person zzz');
  await expect(marker.locator('[data-pick-person]').first()).toBeHidden();
});

/**
 * A text-only post with no markers: step 3 says so, Save is offered
 * anyway, and the item page keeps every line plain with no clip or
 * carousel pinned.
 */
test('add: a post with no markers saves as plain text, with nothing pinned', async ({ page }, testInfo) => {
  writesRunOnce(testInfo);
  await signInAs(page, 'member');
  await gotoReady(page, '/add');
  await pasteLink(page, NO_MARKERS);
  await page.locator('[data-action="next"]').click();
  await expect(page.locator('.c-speaker-step__intro')).toHaveText('no speaker markers found. the entry saves as plain text.');
  await expect(page.locator('[data-action="save"]')).toBeEnabled();
  await page.locator('[data-action="save"]').click();
  await page.waitForURL(`**/t/${NO_MARKERS}`);
  await expect(page.locator('.c-bubbles__plain').first()).toContainText('here is a short note with no speakers at all');
  await expect(page.locator('.c-media-box video, .c-media-box img, .c-carousel, .c-quote')).toHaveCount(0);
});

/**
 * One marker, one line: the preview matches the marker to a person by
 * emoji (so Save is enabled and nothing is blocking), the picker changes
 * that person, fixing the line to plain saves, the item page shows the raw
 * line, and the edit page puts the bubble back.
 *
 * The brief's `LONG` stands in as `EDITED_NEW`: the example seed already
 * archives `LONG`, so adding it again would land on the `duplicate` screen.
 * `EDITED_NEW` has the same shape (one marker, one line, no media) and is
 * not seeded. An *unmapped* marker (the `N not mapped yet` note, Save still
 * enabled) is pinned by test/components/speakerStep.test.js, because every
 * fixture marker here is a known person's emoji.
 */
test('add: a mapped marker and a plain line save; the edit page puts the bubble back', async ({ page }, testInfo) => {
  writesRunOnce(testInfo);
  await signInAs(page, 'member');
  await gotoReady(page, '/add');
  await pasteLink(page, EDITED_NEW);

  // Step 3: the preview matched the marker by emoji, and Save is offered.
  await page.locator('[data-action="next"]').click();
  await expect(page.locator('.c-speaker-step__intro')).toHaveText('we found 1 speaker marker.');
  await expect(page.locator('[data-marker="☀️"] .c-speaker-step__pick')).toHaveText('☀️ sol');
  await expect(page.locator('[data-action="save"]')).toBeEnabled();

  // Change who the marker is, then fix its only line to plain.
  await page.locator('[data-marker="☀️"] summary').click();
  await page.locator('[data-marker="☀️"] [data-pick-person]').nth(1).click();
  await expect(page.locator('[data-marker="☀️"] .c-speaker-step__pick')).toHaveText('🌙 luna');
  await page.locator('.c-speaker-step__line').first().click();
  await expect(page.locator('.c-line-fix')).toBeVisible();
  await page.locator('.c-line-fix [data-action="plain"]').click();

  await page.locator('[data-action="save"]').click();
  await page.waitForURL(`**/t/${EDITED_NEW}`);
  const line = "can't wait to see everyone at the fanmeet next weekend";
  await expect(page.locator('.c-bubbles__plain')).toContainText(`☀️: ${line}`);
  await expect(page.locator('.c-bubbles__msg')).toHaveCount(0);

  // Edit it back: the same line becomes speech again, by a picked person.
  await gotoReady(page, `/edit/translation/${EDITED_NEW}`);
  await page.locator('.c-speaker-step__line').first().click();
  await page.locator('.c-line-fix [data-action="speech"]').click();
  await page.locator('.c-line-fix [data-pick-person]').first().click();
  await page.locator('[data-action="save"]').click();
  await expect(page.locator('.c-edit__saved')).toBeVisible();

  await gotoReady(page, `/t/${EDITED_NEW}`);
  await expect(page.locator('.c-bubbles__bub')).toContainText(line);
  await expect(page.locator('.c-bubbles__plain')).toHaveCount(0);
});
