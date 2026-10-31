// @ts-check
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { issueState, takeState, clearStateCookie } from '../../src/services/oauthState.js';
import { BadRequest } from '../../src/http/errors.js';

const ENV = { AUTH_SECRET: 'secret' };
/** @param {Record<string,string>} cookies */
const input = (cookies) => ({ cookies, params: {}, query: {}, body: undefined, origin: 'https://a', ip: null });
/** `deps` for oauthState: `env` plus the injected clock (real time by default). @param {() => Date} [now] */
const deps = (now = () => new Date()) => ({ env: ENV, now });

/** Re-sign a state cookie payload with a new exp. */
function expire(cookie, newExp) {
  const dot = cookie.lastIndexOf('.');
  const payload = cookie.slice(0, dot);
  const obj = JSON.parse(payload);
  obj.exp = newExp;
  const body = JSON.stringify(obj);
  const sig = createHmac('sha256', 'secret').update(body).digest('base64url');
  return { raw: `${body}.${sig}` };
}

test('issueState returns a signed cookie and a state that takeState accepts', () => {
  const { state, cookie } = issueState(deps(), { verifier: 'v', returnTo: '/add' });
  assert.match(cookie, /^oauth=/);
  assert.match(cookie, /HttpOnly/);
  const taken = takeState(deps(), input(fromCookie(cookie)), state);
  assert.deepEqual(taken, { verifier: 'v', returnTo: '/add', nonce: null });
});

test('takeState rejects a missing, tampered, mismatched or expired state', () => {
  const { state, cookie } = issueState(deps(), { verifier: 'v', returnTo: '/add' });
  const cookieName = fromCookie(cookie);

  // Missing.
  assert.throws(() => takeState(deps(), input({}), state), BadRequest);
  // Tampered signature (flip the last char).
  const tampered = cookieName.oauth.slice(0, -1) + (cookieName.oauth.endsWith('a') ? 'b' : 'a');
  assert.throws(() => takeState(deps(), input({ oauth: tampered }), state), BadRequest);
  // Mismatched state.
  assert.throws(() => takeState(deps(), input(cookieName), 'other-state'), BadRequest);
  // Expired.
  const old = expire(cookieName.oauth, Date.now() - 1000);
  assert.throws(() => takeState(deps(), input({ oauth: old.raw }), state), BadRequest);
});

test('an OAuth state expires 10 minutes after deps.now()', () => {
  const t0 = Date.parse('2026-01-01T00:00:00Z');
  const { state, cookie } = issueState(deps(() => new Date(t0)), { verifier: 'v', returnTo: '/add' });
  const cookies = fromCookie(cookie);
  assert.equal(takeState(deps(() => new Date(t0 + 60_000)), input(cookies), state).returnTo, '/add');
  assert.throws(
    () => takeState(deps(() => new Date(t0 + 11 * 60_000)), input(cookies), state),
    BadRequest,
    'expired after 10 minutes',
  );
});

test('returnTo outside the site is rewritten to /me at issue time', () => {
  // A leading backslash is a slash to browsers: '/\evil.example' resolves to
  // https://evil.example/, so it must be refused like '//evil.example'.
  for (const bad of ['//evil.example', 'https://evil.example', '/\\evil.example']) {
    const { state, cookie } = issueState(deps(), { verifier: null, returnTo: bad });
    const taken = takeState(deps(), input(fromCookie(cookie)), state);
    assert.equal(taken.returnTo, '/me');
  }
});

test('clearStateCookie clears the oauth cookie', () => {
  assert.match(clearStateCookie(), /^oauth=; Max-Age=0/);
});

/** @param {string} cookie @returns {{ oauth: string }} */
function fromCookie(cookie) {
  return { oauth: cookie.replace(/^oauth=/, '').split(';')[0] };
}
