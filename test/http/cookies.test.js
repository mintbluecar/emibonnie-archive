// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCookies, serializeCookie, jsonWithCookies, redirectWithCookies } from '../../src/http/cookies.js';

test('parseCookies decodes name/value pairs and ignores junk', () => {
  assert.deepEqual({ ...parseCookies('a=1; b=x%20y') }, { a: '1', b: 'x y' });
  assert.deepEqual({ ...parseCookies(null) }, {});
  assert.deepEqual({ ...parseCookies('') }, {});
  assert.deepEqual({ ...parseCookies('a=1; b; c=') }, { a: '1', c: '' });
});

test('serializeCookie always adds HttpOnly, Secure, SameSite=Lax and Path=/', () => {
  const s = serializeCookie('sid', 't', { maxAge: 604800 });
  assert.match(s, /Max-Age=604800/);
  assert.match(s, /\bHttpOnly\b/);
  assert.match(s, /\bSecure\b/);
  assert.match(s, /SameSite=Lax/);
  assert.match(s, /Path=\//);
  assert.match(s, /^sid=t;/);
});

test('serializeCookie with maxAge 0 clears the cookie', () => {
  const s = serializeCookie('sid', '', { maxAge: 0 });
  assert.match(s, /Max-Age=0/);
  assert.match(s, /^sid=;/);
});

test('jsonWithCookies and redirectWithCookies attach Set-Cookie headers', () => {
  const json = jsonWithCookies({ ok: true }, ['a=1; Path=/', 'b=2; Path=/'], 201);
  assert.equal(json.status, 201);
  assert.deepEqual(json.headers.getSetCookie(), ['a=1; Path=/', 'b=2; Path=/']);
  assert.match(json.headers.get('content-type') ?? '', /application\/json/);

  const redirect = redirectWithCookies('https://example.com/me', ['a=1; Path=/']);
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get('location'), 'https://example.com/me');
  assert.deepEqual(redirect.headers.getSetCookie(), ['a=1; Path=/']);
});
