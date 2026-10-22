// @ts-check
import '../helpers/siteFixture.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
// Dynamic import: see test/components/header.test.js for why.
const { render } = await import('../../public/js/components/resultCard.js');

/** @typedef {import('../../src/http/contracts.js').SearchResult} SearchResult */

/** @returns {SearchResult} */
function baseResult(matchLines) {
  return {
    kind: 'translation', sourceId: '1', url: '/t/1', lines: [], people: [], accountHandle: null, hasVideo: false,
    followsOnFrom: null, occurredOn: '2026-10-14', placement: 'post', event: null, matchLines,
  };
}

test('resultCard: q matched against raw text gives exactly one <mark>, and the "&" stays escaped outside it', () => {
  const markup = String(render({ result: baseResult(['a & amp']), q: 'amp' }));
  const marks = markup.match(/<mark>/g) ?? [];
  assert.equal(marks.length, 1);
  assert.match(markup, /<mark>amp<\/mark>/);
  assert.match(markup, /a &amp; <mark>amp<\/mark>/);
  assert.ok(!/<mark>[^<]*&amp;/.test(markup), 'no mark wraps the escaped entity');
});

test('resultCard: matching is case-insensitive', () => {
  const markup = String(render({ result: baseResult(['We HUG all the time']), q: 'hug' }));
  assert.match(markup, /<mark>HUG<\/mark>/);
});

test('resultCard: a q that contains regex metacharacters is matched literally', () => {
  const markup = String(render({ result: baseResult(['a (test) line']), q: '(test)' }));
  assert.match(markup, /<mark>\(test\)<\/mark>/);
});

test('resultCard: no q means no highlighting, text still escaped', () => {
  const markup = String(render({ result: baseResult(['<b>raw</b>']), q: '' }));
  assert.ok(!markup.includes('<mark>'));
  assert.match(markup, /&lt;b&gt;raw&lt;\/b&gt;/);
});

test('resultCard (Task 9b): empty matchLines (a filters-only search, no q) shows at most the first two opening lines, compact, not full bubbles', () => {
  /** @type {SearchResult} */
  const result = {
    ...baseResult([]),
    lines: [
      { kind: 'speech', emoji: '🌙', name: 'luna', colour: '#6a5cd6', text: 'the opening line', cont: false },
      { kind: 'plain', text: 'the second line' },
      { kind: 'plain', text: 'a third line' },
    ],
  };
  const markup = String(render({ result, q: '' }));
  assert.ok(!markup.includes('c-result-card__text'), 'no matchLines block when there is nothing to highlight');
  assert.match(markup, /c-bubbles-compact/);
  assert.ok(!markup.includes('c-bubbles__bub'));
  assert.match(markup, /the opening line/);
  assert.match(markup, /the second line/);
  assert.ok(!markup.includes('a third line'));
});

test('resultCard (Task 9b): with q, only the matching lines show -- not the opening lines', () => {
  const result = { ...baseResult(['🌙 a hug line']), lines: [{ kind: 'plain', text: 'an opening line' }] };
  const markup = String(render({ result: /** @type {SearchResult} */ (result), q: 'hug' }));
  assert.match(markup, /<mark>hug<\/mark>/);
  assert.ok(!markup.includes('an opening line'));
});
