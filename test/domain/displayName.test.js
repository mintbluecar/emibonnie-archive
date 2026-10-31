// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanDisplayName } from '../../src/domain/displayName.js';

test('cleanDisplayName: the Review Focus 3 cases', () => {
  assert.deepEqual(cleanDisplayName('@sample_translator'), { ok: false, reason: 'looks_like_handle' });
  assert.deepEqual(cleanDisplayName('ab\u200Bc'), { ok: true, name: 'abc' }, 'a zero-width space is stripped');
  assert.deepEqual(cleanDisplayName('\u202Eabc'), { ok: true, name: 'abc' }, 'a bidi override is stripped');
  assert.deepEqual(cleanDisplayName('  a   b '), { ok: true, name: 'a b' });
  assert.deepEqual(cleanDisplayName('x'.repeat(31)), { ok: false, reason: 'too_long' });
  assert.deepEqual(cleanDisplayName(''), { ok: false, reason: 'empty' });
  assert.deepEqual(cleanDisplayName('   '), { ok: false, reason: 'empty' });
});

test('cleanDisplayName: a leading @ is rejected, never stripped', () => {
  assert.deepEqual(cleanDisplayName('@alice'), { ok: false, reason: 'looks_like_handle' });
  assert.deepEqual(cleanDisplayName('alice'), { ok: true, name: 'alice' });
});

test('cleanDisplayName: 30 characters is allowed', () => {
  assert.deepEqual(cleanDisplayName('x'.repeat(30)), { ok: true, name: 'x'.repeat(30) });
});
