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

/** A search page's header props (Task 10d: home, event, person, translator). */
const SEARCH = { search: { placeholder: 'search what they said…' } };

test('header: with `search`, has a search box with the given placeholder and an aria-labelled filter button with a 3-line svg icon', () => {
  const markup = String(render(SEARCH));
  assert.match(markup, /<input class="c-header__search-box"[^>]*placeholder="search what they said…"/);
  assert.match(String(render({ search: { placeholder: 'search this event…' } })), /placeholder="search this event…"/);
  assert.match(markup, /aria-label="filters"/);
  assert.match(markup, /M4 6h16M7 12h10M10 18h4/);
});

test('header (Task 10d): the filter button shows the active-filter count, in its label and a badge', () => {
  const markup = String(render({ search: { placeholder: 'x', filterCount: 2 } }));
  assert.match(markup, /title="filters, 2 active" aria-label="filters, 2 active"/);
  assert.match(markup, /<span class="c-header__filter-count" aria-hidden="true">2<\/span>/);
});

test('header: compact drops the tagline/badge row', () => {
  const markup = String(render({ compact: true }));
  assert.ok(!markup.includes('FAN-MADE'));
  assert.ok(!markup.includes('fixture tagline'));
});

test('header (Task 9b): a given nav sits inside the top bar, after the brand, so desktop shows one bar', () => {
  const markup = String(render({ ...SEARCH, nav: html`<nav class="test-nav"></nav>` }));
  const bar = markup.slice(markup.indexOf('c-header__bar'), markup.indexOf('c-header__search'));
  assert.ok(bar.indexOf('c-header__wordmark') < bar.indexOf('test-nav'), 'brand first, then the nav, both inside the bar');
  assert.ok(bar.includes('test-nav'));
});

test('header (Task 9b): a line-icon svg (not an emoji) sits inside the search field, before the box', () => {
  const markup = String(render(SEARCH));
  const field = markup.slice(markup.indexOf('c-header__search-field'));
  assert.match(field, /^c-header__search-field">\s*<svg class="c-header__search-icon"[^>]*aria-hidden="true"/);
  assert.ok(field.indexOf('c-header__search-icon') < field.indexOf('c-header__search-box'));
  assert.ok(!markup.includes('🔍'));
});

test('header (Task 10b, 10d): the <header> landmark holds only the pinned bar; the tagline row, then the pinned search row (its own search landmark), follow it', () => {
  const markup = String(render(SEARCH));
  const headerEnd = markup.indexOf('</header>');
  const inHeader = markup.slice(0, headerEnd);
  const after = markup.slice(headerEnd);
  assert.ok(inHeader.includes('c-header__bar') && inHeader.includes('c-header__wordmark'));
  assert.ok(!inHeader.includes('c-header__search-box'), 'the search row is outside the bar');
  assert.match(after, /<div class="c-header__below">[\s\S]*c-header__tagline--below[\s\S]*<\/div>\s*<div class="c-header__below c-header__below--live">\s*<div class="c-header__search" role="search">/);
  assert.match(inHeader, /c-header__tagline--bar/, 'desktop shows the tagline in the bar; CSS shows exactly one of the two');
});

test('header (Task 10d): with `search` the bar has no search icon (the box is right there); without it, no box and the phone bar\'s icon goes home', () => {
  assert.ok(!String(render(SEARCH)).includes('c-header__find'));
  for (const props of [{}, { compact: true }]) {
    const markup = String(render(props));
    assert.ok(!markup.includes('c-header__search'), 'no search row, so no box that could navigate');
    assert.match(markup, /<a class="c-header__find" href="\/" title="search" aria-label="search">\s*<svg[^>]*aria-hidden="true"/);
  }
  assert.ok(!String(render({ compact: true })).includes('c-header__below'), 'a compact page with no search has nothing below the bar');
});

test('header (fix round 1, I3; owner rule): every icon-only control carries a title matching its aria-label', () => {
  for (const markup of [String(render(SEARCH)), String(render({ compact: true }))]) {
    for (const tag of markup.match(/<(button|a)\b[^>]*aria-label="[^"]*"[^>]*>/g) ?? []) {
      const label = /aria-label="([^"]*)"/.exec(tag)?.[1];
      assert.ok(tag.includes(`title="${label}"`), tag);
    }
  }
  assert.match(String(render(SEARCH)), /class="c-header__filter-btn" type="button" title="filters" aria-label="filters"/);
});

test('fix round 1, I3 (owner rule): no button or link in public/js has an aria-label without a title (an icon-only control shows its name on hover)', async () => {
  const { readdirSync, readFileSync } = await import('node:fs');
  const path = await import('node:path');
  /** @param {string} dir @returns {string[]} */
  const files = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : e.name.endsWith('.js') ? [path.join(dir, e.name)] : []));
  /** @type {string[]} */
  const missing = [];
  for (const file of files('public/js')) {
    for (const tag of readFileSync(file, 'utf8').match(/<(button|a)\b[^>]*aria-label=[^>]*>/g) ?? []) {
      if (!/\btitle=/.test(tag)) missing.push(`${file}: ${tag.replace(/\s+/g, ' ').slice(0, 120)}`);
    }
  }
  assert.deepEqual(missing, []);
});
