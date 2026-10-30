// @ts-check
/**
 * `site/scripts/password.mjs`: the generated `app` role password is 44
 * URL-safe characters (33 random bytes, base64url) -- about 264 bits, well
 * above Neon's "minimum entropy of 60 bits" (https://neon.com/docs/manage/roles).
 * Run with `node --test site/test/`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomPassword, splitDbUrl } from '../scripts/password.mjs';

test('randomPassword is 44 URL-safe characters, different every call', () => {
  const seen = new Set();
  for (let i = 0; i < 50; i += 1) {
    const pw = randomPassword();
    assert.equal(pw.length, 44);
    assert.match(pw, /^[A-Za-z0-9_-]{44}$/);
    seen.add(pw);
  }
  assert.equal(seen.size, 50);
});

test('splitDbUrl moves the password out of the URL', () => {
  assert.deepEqual(
    splitDbUrl('postgres://owner:s3cret-token@ep-main.example.neon.tech/db?sslmode=require'),
    { url: 'postgres://owner@ep-main.example.neon.tech/db?sslmode=require', password: 's3cret-token' },
  );
  // libpq reads PGPASSWORD as-is, so a percent-encoded password is decoded.
  assert.deepEqual(
    splitDbUrl('postgresql://owner:p%2Fa%3As%40s@h:5432/db'),
    { url: 'postgresql://owner@h:5432/db', password: 'p/a:s@s' },
  );
  assert.deepEqual(splitDbUrl('postgres://owner@h/db'), { url: 'postgres://owner@h/db', password: '' });
});
