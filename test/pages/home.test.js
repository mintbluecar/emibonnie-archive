// @ts-check
/**
 * DOM-free tests of `composeHome` (pure: `HomeView` -> `SafeHtml`), on a
 * snapshot of the real `/api/home` response -- `test/snapshots/home.json`,
 * generated from `homeView()` against the seeded example site the same
 * way test/services/hubs.test.js does (see that file's "homeView" test).
 */
import '../helpers/siteFixture.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
// Dynamic import: see test/components/header.test.js for why (home.js
// transitively imports the absolute specifier '/site/site.js').
const { composeHome } = await import('../../public/js/pages/home.js');

const HOME = JSON.parse(readFileSync(new URL('../snapshots/home.json', import.meta.url), 'utf8'));

test('composeHome: shows the header, tab bar and footer', () => {
  const markup = String(composeHome(HOME));
  assert.match(markup, /c-header__wordmark/);
  assert.match(markup, /c-header__below--desktop/, 'home keeps its search box on desktop (Task 10b fix O1)');
  assert.match(markup, /c-tabbar/);
  assert.match(markup, /c-footer__links/);
});

test('composeHome: shows "october 2026" for an event in that month, newest first', () => {
  const markup = String(composeHome(HOME));
  assert.match(markup, /<h2 class="c-home-month__label">october 2026<\/h2>/);
  const octoberIndex = markup.indexOf('october 2026');
  const marchIndex = markup.indexOf('march 2026');
  assert.ok(octoberIndex !== -1 && marchIndex !== -1 && octoberIndex < marchIndex, 'months are newest first');
});

test('composeHome: each event is a link to /e/<slug>, with its name and total count', () => {
  const markup = String(composeHome(HOME));
  assert.match(markup, /href="\/e\/solluna-happy-day-2026-10-19"/);
  assert.match(markup, /SOLLUNA HAPPY DAY/);
  assert.match(markup, /<span class="c-event-card__count">2<\/span>/);
});

test('composeHome: an empty months list shows the empty state instead', () => {
  const markup = String(composeHome({ months: [] }));
  assert.match(markup, /c-empty-state/);
  assert.match(markup, /no events yet/);
});
