// @ts-check
/**
 * Plan 2a Task 12: the me page (sign-in screen when signed out, "added by
 * me" when signed in) and the add page's signed-out state, in a real
 * browser -- the four per-page checks at both widths in both themes
 * (`checkPage`), plus the parts only a browser can show: which provider
 * is listed first, that a failed sign-in is announced, that the icon-only
 * controls carry a tooltip and a label, and that the signed-in view is
 * the one the session actually gets.
 *
 * Signing in goes through `POST /api/auth/dev` (src/routes/authDev.js),
 * called from the page's own origin so the session cookie lands where the
 * app will send it. That route only exists when the dev server runs with
 * `DEV_SIGN_IN=1` (e2e/helpers.js's `devServer`), and it is a 404 in
 * production. There is no e2e for adding an item yet: the dev server has
 * no way to fetch a real tweet, so the add form arrives in Task 13.
 */
import { test, expect } from '@playwright/test';
import { checkPage, gotoReady, DARK_PROJECTS } from './helpers.js';

/**
 * Signs the page's browser context in as `as`, through a page on the
 * origin the app uses -- the me page's own signed-out screen, which loads
 * no media, so nothing from a richer page is still in flight when the
 * caller's checks start. The caller navigates next, so `checkPage` sees a
 * fresh load with the session already in place.
 * @param {import('@playwright/test').Page} page
 * @param {'owner'|'member'|'google'} as
 * @returns {Promise<void>}
 */
async function signInAs(page, as) {
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

test('me, signed out: the sign-in screen, X listed before Google, and no signed-in controls', async ({ page }) => {
  await checkPage(page, '/me');
  await expect(page.locator('.c-signin')).toBeVisible();
  const providers = page.locator('.c-signin__provider');
  await expect(providers).toHaveCount(2);
  await expect(providers.first()).toContainText('X');
  await expect(providers.last()).toContainText('Google');
  await expect(providers.first()).toHaveAttribute('href', '/api/auth/x/start?return=%2Fme');
  await expect(page.locator('.c-me__head')).toHaveCount(0);
});

test('me, ?signin=failed: the failure is announced, not silent', async ({ page }, testInfo) => {
  test.skip(DARK_PROJECTS.includes(testInfo.project.name), 'the same markup in both themes; light projects only');
  await checkPage(page, '/me?signin=failed');
  await expect(page.getByRole('alert')).toContainText('sign-in');
});

test('me, signed in as a member: who is signed in, the empty own list, and labelled icon controls', async ({ page }) => {
  await signInAs(page, 'member');
  await checkPage(page, '/me');
  await expect(page.locator('.c-me__who')).toHaveText('@dev_member');
  await expect(page.locator('.c-me__empty')).toBeVisible();
  const icons = page.locator('.c-me__icon');
  await expect(icons).toHaveCount(2);
  for (const icon of await icons.all()) {
    expect(await icon.getAttribute('title'), 'a tooltip').toBeTruthy();
    expect(await icon.getAttribute('aria-label'), 'an accessible name').toBeTruthy();
  }
  await expect(page.locator('.c-me__delete')).toBeVisible();
});

test('add, signed out: the same sign-in screen, coming back to /add', async ({ page }, testInfo) => {
  test.skip(DARK_PROJECTS.includes(testInfo.project.name), 'the same markup in both themes; light projects only');
  await checkPage(page, '/add');
  await expect(page.locator('.c-signin__provider--x')).toHaveAttribute('href', '/api/auth/x/start?return=%2Fadd');
});

test('add, signed in: the placeholder the add form replaces (Task 13)', async ({ page }, testInfo) => {
  test.skip(DARK_PROJECTS.includes(testInfo.project.name), 'the same markup in both themes; light projects only');
  await signInAs(page, 'member');
  await checkPage(page, '/add');
  await expect(page.locator('.c-me__empty')).toBeVisible();
});
