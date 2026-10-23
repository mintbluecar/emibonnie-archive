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

test('header (Task 10b): the <header> landmark holds only the pinned bar; the tagline and search row follow it, the search row as its own search landmark', () => {
  const markup = String(render());
  const headerEnd = markup.indexOf('</header>');
  const inHeader = markup.slice(0, headerEnd);
  const after = markup.slice(headerEnd);
  assert.ok(inHeader.includes('c-header__bar') && inHeader.includes('c-header__wordmark'));
  assert.ok(!inHeader.includes('c-header__search-box'), 'the search row scrolls away with the page');
  assert.match(after, /<div class="c-header__below">[\s\S]*c-header__tagline--below[\s\S]*<div class="c-header__search" role="search">/);
  assert.match(inHeader, /c-header__tagline--bar/, 'desktop shows the tagline in the bar; CSS shows exactly one of the two');
});

test('header (Task 10b): the phone bar has a search icon linking to /search, labelled for screen readers -- except on the search page itself', () => {
  assert.match(String(render()), /<a class="c-header__find" href="\/search" aria-label="search">\s*<svg[^>]*aria-hidden="true"/);
  const live = String(render({ liveSearch: true }));
  assert.ok(!live.includes('c-header__find'));
  assert.match(live, /class="c-header__below c-header__below--live"/);
});

test('header (Task 10b fix O1): desktopSearch marks the search row that stays on desktop (home), outside the bar', () => {
  const markup = String(render({ desktopSearch: true }));
  assert.match(markup, /<div class="c-header__below c-header__below--desktop">/);
  assert.ok(markup.indexOf('c-header__search"') > markup.indexOf('</header>'), 'in the page body, not the bar');
  assert.ok(!String(render()).includes('c-header__below--desktop'));
});

test('header (Task 10c r): noSearch drops the search row and points the bar\'s search icon home; by default it goes to /search', () => {
  assert.ok(!String(render({ compact: true, noSearch: true })).includes('c-header__search'));
  assert.match(String(render({ compact: true, noSearch: true })), /class="c-header__find" href="\/"/);
  assert.match(String(render()), /class="c-header__find" href="\/search"/);
});
