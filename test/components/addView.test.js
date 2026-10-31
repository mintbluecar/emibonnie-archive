// @ts-check
/**
 * Styling system Task 9: the add page's step dots. The dots up to the
 * current step are marked `data-on` (add.css colours them); the status
 * screen shows none.
 */
import '../helpers/siteFixture.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
// Dynamic import: see header.test.js for why.
const { render } = await import('../../public/js/components/addView.js');

const OPTIONS = { people: [], roles: [], events: [], categories: [], clients: [] };

/** @param {any} state @returns {string} */
function markupOf(state) {
  return String(render({ state: { step: 'link', link: '', busy: false, error: false, notice: null, status: null, preview: null, ...state }, addingAs: '@tl_alpha', isOwner: false, options: OPTIONS }));
}

/** The step dots' `<span>`s. @param {string} markup @returns {string[]} */
function dotsOf(markup) {
  const steps = markup.match(/<div class="c-add__steps"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? '';
  return steps.match(/<span[^>]*>/g) ?? [];
}

test('addView: three step dots, the first on while pasting the link', () => {
  const dots = dotsOf(markupOf({}));
  assert.equal(dots.length, 3);
  assert.deepEqual(dots.map((d) => d.includes('data-on')), [true, false, false]);
});

test('addView: on the speakers step all three dots are on', () => {
  const preview = { draft: { common: {}, tweet: {}, newTags: [], markers: [], speakers: {}, subbed: false }, lines: [], unmapped: [], media: null };
  const choices = { placement: 'unsorted', eventMode: 'match', eventName: '', categoryPick: '', categoryNew: '', clientPick: '', clientNew: '', subbed: false };
  const dots = dotsOf(markupOf({ step: 'speakers', preview, choices, chosen: {}, open: null, lineFixes: [], fix: null }));
  assert.equal(dots.filter((d) => d.includes('data-on')).length, 3);
});
