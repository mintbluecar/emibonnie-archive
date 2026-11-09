// @ts-check
import '../helpers/siteFixture.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
// Dynamic import: see test/components/header.test.js for why.
const { render } = await import('../../public/js/components/tabBar.js');

test('tabBar (Task 10d): shows home, + add and me, each linking to its route -- no search tab', () => {
  const markup = String(render({ active: 'home' }));
  assert.equal(markup.split('<a').length - 1, 3);
  assert.ok(!markup.includes('/search'));
  assert.match(markup, /href="\/"[^>]*aria-label="Home"/);
  assert.match(markup, /href="\/add"[^>]*aria-label="Add"/);
  assert.match(markup, /href="\/me"[^>]*aria-label="Me"/);
});

test('tabBar (owner, 2026-11-09): each tab is an icon, named and titled by its word', () => {
  const items = String(render()).split('<a').slice(1);
  for (const item of items) {
    assert.match(item, /aria-label="([^"]+)"[\s\S]*title="\1"/);
    assert.match(item, /<svg[^>]*aria-hidden="true"/);
    assert.doesNotMatch(item.replace(/<svg[\s\S]*<\/svg>/, ''), />\s*[^\s<]+\s*</, 'no visible text beside the icon');
  }
});

test('tabBar: marks only the active tab', () => {
  const markup = String(render({ active: 'me' }));
  const items = markup.split('<a').slice(1);
  const on = items.filter((item) => item.includes('aria-current="page"'));
  assert.equal(on.length, 1);
  assert.match(on[0], /href="\/me"/);
});

test('tabBar: with no active tab, nothing is marked on', () => {
  const markup = String(render());
  assert.ok(!markup.includes('aria-current="page"'));
});
