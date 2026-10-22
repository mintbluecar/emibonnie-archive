// @ts-check
import '../helpers/siteFixture.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
// Dynamic import: see test/components/header.test.js for why.
const { render } = await import('../../public/js/components/pageShell.js');
const { html } = await import('../../public/js/core/html.js');

test('pageShell (Task 9b): the tab bar renders inside the header, so desktop gets one top bar (phone CSS still fixes it to the bottom)', () => {
  const markup = String(render({ active: 'home', content: html`<p>x</p>` }));
  const header = markup.slice(markup.indexOf('<header'), markup.indexOf('</header>'));
  assert.match(header, /class="c-tabbar"/);
  assert.equal(markup.match(/class="c-tabbar"/g)?.length, 1);
});

test('pageShell (Task 9b): headerProps reach the header (the search page keeps its live box on desktop)', () => {
  const markup = String(render({ active: 'search', compact: true, headerProps: { liveSearch: true }, content: html`` }));
  assert.match(markup, /c-header--live/);
});
