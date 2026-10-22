// @ts-check
import '../helpers/siteFixture.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
// Dynamic import: header.js transitively imports the absolute specifier
// '/site/site.js', which the hook above redirects. That hook only takes
// effect once registered (at evaluation time); a static import here
// would be resolved during linking, before the hook runs (see
// test/core/site.test.js, which uses the same dynamic-import workaround).
const { render } = await import('../../public/js/components/header.js');
const { html } = await import('../../public/js/core/html.js');

test('header: shows the accent in the brand gradient class, plus the rest of the wordmark', () => {
  const markup = String(render());
  assert.match(markup, /<span class="c-header__accent">fix<\/span>ture archive/);
});

test('header: shows the FAN-MADE badge', () => {
  const markup = String(render());
  assert.match(markup, /FAN-MADE/);
});

test('header: has a search box and an aria-labelled filter button with a 3-line svg icon', () => {
  const markup = String(render());
  assert.match(markup, /<input class="c-header__search-box"[^>]*placeholder="search what they said…"/);
  assert.match(markup, /aria-label="filters"/);
  assert.match(markup, /M4 6h16M7 12h10M10 18h4/);
});

test('header: compact drops the tagline/badge row', () => {
  const markup = String(render({ compact: true }));
  assert.ok(!markup.includes('FAN-MADE'));
  assert.ok(!markup.includes('fixture tagline'));
});

test('header (Task 9b): a given nav sits inside the top bar, after the brand, so desktop shows one bar', () => {
  const markup = String(render({ nav: html`<nav class="test-nav"></nav>` }));
  const bar = markup.slice(markup.indexOf('c-header__bar'), markup.indexOf('c-header__search'));
  assert.ok(bar.indexOf('c-header__wordmark') < bar.indexOf('test-nav'), 'brand first, then the nav, both inside the bar');
  assert.ok(bar.includes('test-nav'));
});

test('header (Task 9b): a line-icon svg (not an emoji) sits inside the search field, before the box', () => {
  const markup = String(render());
  const field = markup.slice(markup.indexOf('c-header__search-field'));
  assert.match(field, /^c-header__search-field">\s*<svg class="c-header__search-icon"[^>]*aria-hidden="true"/);
  assert.ok(field.indexOf('c-header__search-icon') < field.indexOf('c-header__search-box'));
  assert.ok(!markup.includes('🔍'));
});

test('header (Task 9b): liveSearch marks the header whose box stays on desktop (the search page); others leave it off', () => {
  assert.match(String(render({ liveSearch: true })), /class="c-header c-header--compact c-header--live"|class="c-header c-header--live"/);
  assert.ok(!String(render()).includes('c-header--live'));
});
