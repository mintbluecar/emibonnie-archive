// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { norm, cleanDisplayName, excerptAround } from '../../src/domain/text.js';

test('norm: lower-cases and collapses whitespace', () => {
  assert.equal(norm('  Happy   Day  '), 'happy day');
});

test('norm: uses NFC, not NFKC, so fullwidth letters stay distinct from ASCII', () => {
  // '#ＳＬHappy  Day' uses fullwidth Ｓ/Ｌ (U+FF33/U+FF2C). NFC does not fold
  // them to ASCII S/L (that's an NFKC compatibility decomposition), so
  // norm() lower-cases them to their own fullwidth lower-case forms
  // (ｓ/ｌ) rather than merging the tag with an ASCII-only one.
  assert.equal(norm('#ＳＬHappy  Day'), '#ｓｌhappy day');
});

test('cleanDisplayName: strips an RTL override and a zero-width space around a leading @', () => {
  assert.equal(cleanDisplayName('@‮tl_alpha​'), 'tl_alpha');
});

test('cleanDisplayName: NFKC folds fullwidth letters to their ASCII form', () => {
  assert.equal(cleanDisplayName('ＳＬ'), 'SL');
});

test('cleanDisplayName: trims to 40 characters', () => {
  assert.equal(cleanDisplayName('a'.repeat(50)).length, 40);
});

const LONG = `${'Many people at fan signs and other events like to tell us about their lives and the problems they face. '.repeat(2)}At the very least, you are your own number one girl and you are Luna's number one girl too, always and forever, okay?`;

test('excerptAround (Task 9b): a short line comes back unchanged', () => {
  assert.equal(excerptAround('We hug all the time!', 'hug'), 'We hug all the time!');
});

test('excerptAround (Task 9b): a long line is cut to a window around the first match, at word edges, with … where text was cut', () => {
  const out = excerptAround(LONG, 'number one');
  assert.ok([...out].length <= 122, `at most the window plus two ellipses (${[...out].length})`);
  assert.ok(out.startsWith('…') && out.endsWith('…'), out);
  assert.match(out, /number one girl/);
  assert.match(out, /^… ?\S/);
  const first = out.slice(1).trim().split(' ')[0];
  assert.ok(LONG.includes(` ${first} `), `starts on a whole word (${first})`);
});

test('excerptAround (Task 9b): a match near the start keeps the start; near the end keeps the end; case-insensitive', () => {
  const start = excerptAround(LONG, 'MANY people');
  assert.ok(start.startsWith('Many people') && start.endsWith('…'), start);
  const end = excerptAround(LONG, 'forever');
  assert.ok(end.startsWith('…') && end.endsWith('okay?'), end);
});

test('excerptAround (Task 9b): counts code points, so Thai (no spaces) is cut by length and never splits a surrogate pair', () => {
  const thai = `${'ก'.repeat(200)}ครบ${'ข'.repeat(200)}`;
  const out = excerptAround(thai, 'ครบ');
  assert.match(out, /ครบ/);
  assert.ok([...out].length <= 122);
  const emoji = `${'😀'.repeat(150)} hug ${'😀'.repeat(150)}`;
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(excerptAround(emoji, 'hug')), 'no lone high surrogate');
});
