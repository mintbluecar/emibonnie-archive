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
 * app will send it; `signInAs` lives in e2e/helpers.js because
 * e2e/add.spec.js signs in too. The add flow's own e2e is add.spec.js
 * (Task 13).
 */
import { test, expect } from '@playwright/test';
import { checkPage, signInAs, DARK_PROJECTS } from './helpers.js';

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
  const icons = page.locator('.c-me__controls button');
  await expect(icons).toHaveCount(2);
  for (const icon of await icons.all()) {
    expect(await icon.getAttribute('title'), 'a tooltip').toBeTruthy();
    expect(await icon.getAttribute('aria-label'), 'an accessible name').toBeTruthy();
  }
  await expect(page.locator('[data-action="open-delete"]')).toBeVisible();
});

test('add, signed out: the same sign-in screen, coming back to /add', async ({ page }, testInfo) => {
  test.skip(DARK_PROJECTS.includes(testInfo.project.name), 'the same markup in both themes; light projects only');
  await checkPage(page, '/add');
  await expect(page.locator('.c-signin__provider--x')).toHaveAttribute('href', '/api/auth/x/start?return=%2Fadd');
});
