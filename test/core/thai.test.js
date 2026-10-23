// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { thaiSpans } from '../../public/js/core/thai.js';

test('thaiSpans: a Thai-script run gets lang="<lang>", surrounding text does not', () => {
  const markup = String(thaiSpans('hello ครบ world', 'th').reduce((acc, part) => `${acc}${part}`, ''));
  assert.match(markup, /<span lang="th">ครบ<\/span>/);
  assert.ok(markup.startsWith('hello '));
  assert.ok(markup.endsWith(' world'));
});

test('thaiSpans: text with no Thai script is a single plain-string part, unchanged', () => {
  const parts = thaiSpans('no thai here', 'th');
  assert.deepEqual(parts, ['no thai here']);
});

test('thaiSpans: multiple runs each get their own span', () => {
  const markup = String(thaiSpans('ครบ and ยัง', 'th').reduce((acc, part) => `${acc}${part}`, ''));
  assert.match(markup, /<span lang="th">ครบ<\/span> and <span lang="th">ยัง<\/span>/);
});

test('thaiSpans: the lang value comes from the argument, not a hardcoded "th"', () => {
  const markup = String(thaiSpans('ครบ', 'something-else').reduce((acc, part) => `${acc}${part}`, ''));
  assert.match(markup, /<span lang="something-else">ครบ<\/span>/);
});
