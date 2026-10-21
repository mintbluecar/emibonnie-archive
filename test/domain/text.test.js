// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { norm, cleanDisplayName } from '../../src/domain/text.js';

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
