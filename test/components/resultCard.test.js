// @ts-check
import '../helpers/siteFixture.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
// Dynamic import: see test/components/header.test.js for why.
const { render } = await import('../../public/js/components/resultCard.js');

/** @typedef {import('../../src/http/contracts.js').SearchResult} SearchResult */

/** @param {string[]} matchLines @returns {SearchResult} */
function baseResult(matchLines) {
  return {
    kind: 'translation', sourceId: '1', url: '/t/1', lines: [], people: [], accountHandle: null, accountUrl: null, hasVideo: false, thumb: null,
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

test('resultCard (Task 10c): a thumbnail sits beside the text, the card still has one main link', () => {
  const result = { ...baseResult(['a line']), thumb: { url: 'https://pbs.twimg.com/media/b.jpg', width: 800, height: 600, video: false } };
  const markup = String(render({ result, q: '' }));
  assert.match(markup, /<article class="card card--flush" data-result-card>/);
  assert.match(markup, /<img class="c-thumb__img" src="https:\/\/pbs\.twimg\.com\/media\/b\.jpg" alt="photo" width="800" height="600" loading="lazy" decoding="async">/);
  assert.match(markup, /<a class="card__link c-result-card__link" href="\/t\/1" data-thumb>/, 'the main link is still present');
  assert.equal((markup.match(/<a[\s>]/g) ?? []).length, 1, 'no account here, so no credit line and no second link');
});

test('resultCard (owner, 2026-10-23): the translator credit line links to their X profile, with target/rel, in place of the translate icon', () => {
  const markup = String(render({ result: { ...baseResult(['x']), accountHandle: 'tl_beta', accountUrl: 'https://x.com/tl_beta' }, q: '' }));
  assert.match(markup, /<p class="meta c-card-credit">translated by: <a class="c-card-credit__link" href="https:\/\/x\.com\/tl_beta" target="_blank" rel="noopener noreferrer">@tl_beta<\/a><\/p>/);
  assert.ok(!markup.includes('c-icon--translator'), 'the translate icon is gone');
});

test('resultCard (owner, 2026-10-23): an account with no profile link shows plain "@handle" text; no account at all omits the line', () => {
  const plain = String(render({ result: { ...baseResult(['x']), accountHandle: 'tl_beta', accountUrl: null }, q: '' }));
  assert.match(plain, /<p class="meta c-card-credit">translated by: @tl_beta<\/p>/);
  const none = String(render({ result: baseResult(['x']), q: '' }));
  assert.ok(!none.includes('c-card-credit'));
});

test('resultCard: the card root is not an <a> containing another <a> -- the main link and the credit link are siblings, never nested', () => {
  const markup = String(render({ result: { ...baseResult(['x']), accountHandle: 'tl_beta', accountUrl: 'https://x.com/tl_beta' }, q: '' }));
  assert.ok(!/^<a[\s>]/.test(markup.trim()), 'the card root is not an <a>');
  const anchors = markup.match(/<a[\s>]/g) ?? [];
  assert.equal(anchors.length, 2, 'the main link and the credit link');
  const mainLinkClose = markup.indexOf('</a>');
  const creditLinkOpen = markup.indexOf('c-card-credit__link');
  assert.ok(mainLinkClose > -1 && creditLinkOpen > mainLinkClose, 'siblings, not nested');
});

test('resultCard (Task 11): eager passes through to the thumbnail; lazy otherwise', () => {
  const result = { ...baseResult(['a line']), thumb: { url: 'https://pbs.twimg.com/media/b?format=jpg&name=small', width: 800, height: 600, video: false } };
  assert.match(String(render({ result, q: '', eager: true })), /loading="eager" fetchpriority="high"/);
  assert.match(String(render({ result, q: '' })), /loading="lazy"/);
});
