// @ts-check
import '../helpers/siteFixture.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
// Dynamic import: see test/components/header.test.js for why.
const { render } = await import('../../public/js/components/themeToggle.js');
const header = await import('../../public/js/components/header.js');

test('themeToggle (Task 10c f): an icon button named and titled for the current choice, carrying every choice\'s label, all three icons drawn', () => {
  const markup = String(render());
  assert.match(markup, /<button class="c-theme-toggle" type="button" data-choice="system" title="theme: follow device" aria-label="theme: follow device"/);
  assert.match(markup, /data-label-light="theme: light"/);
  assert.match(markup, /data-label-dark="theme: dark"/);
  assert.match(markup, /data-label-system="theme: follow device"/);
  for (const icon of ['light', 'dark', 'system']) assert.match(markup, new RegExp(`c-theme-toggle__icon--${icon}`));
  assert.equal((markup.match(/aria-hidden="true"/g) ?? []).length, 3);
});

test('header (Task 10c f): the bar carries the theme switch on every page', () => {
  assert.match(String(header.render()), /c-header__tools[\s\S]*c-theme-toggle/);
  assert.match(String(header.render({ search: { placeholder: 'x' } })), /c-theme-toggle/);
});
