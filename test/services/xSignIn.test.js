// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { authorizeUrl, exchangeCode, fetchMe } from '../../src/services/xSignIn.js';

test('authorize url asks for exactly users.read tweet.read with S256', () => {
  const url = authorizeUrl({ clientId: 'cid', redirectUri: 'https://a.example/cb', state: 's', challenge: 'c' });
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, 'https://x.com/i/oauth2/authorize');
  assert.equal(u.searchParams.get('scope'), 'users.read tweet.read');
  assert.equal(u.searchParams.get('response_type'), 'code');
  assert.equal(u.searchParams.get('client_id'), 'cid');
  assert.equal(u.searchParams.get('redirect_uri'), 'https://a.example/cb');
  assert.equal(u.searchParams.get('code_challenge'), 'c');
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(u.searchParams.get('state'), 's');
});

test('exchangeCode posts the PKCE code and returns the access token', async () => {
  const seen = [];
  const fetchImpl = async (/** @type {string} */ url, /** @type {any} */ init) => {
    seen.push({ url: String(url), init });
    return Response.json({ access_token: 'tok-123' });
  };
  const token = await exchangeCode(
    { env: { X_CLIENT_ID: 'cid', X_CLIENT_SECRET: 'sec' }, fetchImpl: /** @type {typeof fetch} */ (fetchImpl) },
    { code: 'code', verifier: 'ver', redirectUri: 'https://a.example/cb' },
  );
  assert.equal(token, 'tok-123');
  const { url, init } = seen[0];
  assert.equal(url, 'https://api.x.com/2/oauth2/token');
  assert.match(init.headers.authorization, /^Basic /);
  const form = new URLSearchParams(init.body);
  assert.equal(form.get('code'), 'code');
  assert.equal(form.get('code_verifier'), 'ver');
  assert.equal(form.get('grant_type'), 'authorization_code');
  assert.equal(form.get('redirect_uri'), 'https://a.example/cb');
});

test('exchangeCode rejects a non-ok response', async () => {
  const fetchImpl = async () => new Response('', { status: 401 });
  await assert.rejects(
    exchangeCode({ env: {}, fetchImpl: /** @type {typeof fetch} */ (fetchImpl) }, { code: 'c', verifier: 'v', redirectUri: 'r' }),
    /token exchange failed/,
  );
});

test('fetchMe returns the numeric id and username', async () => {
  const fetchImpl = async () => Response.json({ data: { id: '12345', username: 'alice' } });
  const me = await fetchMe({ env: {}, fetchImpl: /** @type {typeof fetch} */ (fetchImpl) }, 'tok');
  assert.deepEqual(me, { id: '12345', username: 'alice' });
});

test('fetchMe rejects a non-numeric id and a failed request', async () => {
  const bad = async () => Response.json({ data: { id: 'abc', username: 'x' } });
  await assert.rejects(fetchMe({ env: {}, fetchImpl: /** @type {typeof fetch} */ (bad) }, 't'), /non-numeric id/);
  const fail = async () => new Response('', { status: 500 });
  await assert.rejects(fetchMe({ env: {}, fetchImpl: /** @type {typeof fetch} */ (fail) }, 't'), /users\/me failed/);
});
