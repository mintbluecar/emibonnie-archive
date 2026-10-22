// @ts-check
/**
 * DOM-free tests of `composeAccount`/`composeOptedOut` (pure:
 * `AccountView`|`OptedOutAccountView` -> `SafeHtml`), on a snapshot of
 * the real `/api/account/:handle` response for tl_alpha (same source as
 * `test/pages/person.test.js`'s fixtures: `personView()`/`accountView()`
 * against the seeded example site). tl_alpha's own 4 items already cover
 * all three group kinds (an event, a shared story, a standalone post),
 * so one fixture does the job here.
 */
import '../helpers/siteFixture.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
// Dynamic import: see test/components/header.test.js for why.
const { composeAccount, composeOptedOut, bind } = await import('../../public/js/pages/account.js');
const { MiniElement, fakeDocument } = await import('../helpers/miniDom.js');
const { mount } = await import('../../public/js/core/dom.js');

const ACCOUNT = JSON.parse(readFileSync(new URL('../snapshots/account.json', import.meta.url), 'utf8'));

test('composeAccount: the handle, an "open profile" link, and totals', () => {
  const markup = String(composeAccount(ACCOUNT));
  assert.match(markup, /<h1 class="c-account__handle">@tl_alpha<\/h1>/);
  assert.match(markup, /<a class="c-account__open-profile" href="https:\/\/x\.com\/tl_alpha"[^>]*>open profile ↗<\/a>/);
  assert.match(markup, /4 translations/);
});

test('composeAccount: the segmented control has no "with…" (there is no second translator to combine with)', () => {
  const markup = String(composeAccount(ACCOUNT));
  assert.match(markup, /by event/);
  assert.match(markup, /all, newest/);
  assert.ok(!markup.includes('with…'));
});

test('composeAccount: grouped by event, a shared story, and a post', () => {
  const markup = String(composeAccount(ACCOUNT));
  assert.match(markup, /SOLLUNA AT STARFEST · 18 Oct 2026/);
  assert.match(markup, /luna tiktok live · 12 Feb 2026/);
  assert.match(markup, /<h2 class="c-hub-group__label">shared story · 2 Mar 2026<\/h2>/);
  assert.match(markup, /<h2 class="c-hub-group__label">posts<\/h2>/);
});

test('composeOptedOut: only account.optedOut, and nothing else from the page', () => {
  const markup = String(composeOptedOut());
  assert.match(markup, /this translator has opted out/);
  assert.ok(!markup.includes('c-hub__seg'), 'no segmented control');
  assert.ok(!markup.includes('c-hub-group'), 'no groups');
  assert.ok(!markup.includes('c-account__handle'), 'not even the handle');
});

test('composeOptedOut: still the page shell (header/tab bar/footer), just with the opted-out message as its only content', () => {
  const markup = String(composeOptedOut());
  assert.match(markup, /c-header--compact/);
  assert.match(markup, /c-tabbar/);
  assert.match(markup, /c-empty-state__message">this translator has opted out/);
});

test('bind: switching to "all, newest" re-renders flat, without a group label', () => {
  const root = new MiniElement('div');
  mount(root, composeAccount(ACCOUNT));
  globalThis.document = fakeDocument();
  bind(root, ACCOUNT);
  const allChip = /** @type {any} */ (root.querySelector('.c-hub__seg .c-chips__chip[data-value="all"]'));
  allChip.click();
  const content = /** @type {any} */ (root.querySelector('.c-hub__content'));
  assert.equal(content.querySelectorAll('.c-hub-group__label').length, 0, 'flat view has no group labels');
  assert.ok(content.querySelector('a[href="/t/1900000000000000005"]'), 'the shared-story entry is still there, just ungrouped');
  delete (/** @type {any} */ (globalThis)).document;
});
