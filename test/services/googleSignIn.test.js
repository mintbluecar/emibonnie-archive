// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { authorizeUrl, exchangeCode } from '../../src/services/googleSignIn.js';

test('authorize url asks for openid only', () => {
  const u = new URL(authorizeUrl({ clientId: 'cid', redirectUri: 'https://a.example/cb', state: 's', nonce: 'n', challenge: 'c' }));
  assert.equal(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(u.searchParams.get('scope'), 'openid');
  assert.equal(u.searchParams.get('response_type'), 'code');
  assert.equal(u.searchParams.get('nonce'), 'n');
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
});

const jwt = (payload) => `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;

test('exchangeCode validates iss/aud/exp/nonce and returns sub', async () => {
  const now = Math.floor(Date.now() / 1000);
  const idToken = jwt({ iss: 'https://accounts.google.com', aud: 'cid', exp: now + 60, nonce: 'n', sub: 'google-sub-1' });
  const fetchImpl = async () => Response.json({ id_token: idToken });
  const { sub } = await exchangeCode(
    { env: { GOOGLE_CLIENT_ID: 'cid' }, fetchImpl: /** @type {typeof fetch} */ (fetchImpl) },
    { code: 'c', verifier: 'v', redirectUri: 'r', nonce: 'n' },
  );
  assert.equal(sub, 'google-sub-1');
});

test('id_token with wrong aud or nonce is refused', async () => {
  const now = Math.floor(Date.now() / 1000);
  const wrongAud = jwt({ iss: 'https://accounts.google.com', aud: 'someone-else', exp: now + 60, nonce: 'n', sub: 's' });
  const au = async () => Response.json({ id_token: wrongAud });
  await assert.rejects(exchangeCode({ env: { GOOGLE_CLIENT_ID: 'cid' }, fetchImpl: /** @type {typeof fetch} */ (au) }, { code: 'c', verifier: 'v', redirectUri: 'r', nonce: 'n' }), /audience mismatch/);

  const wrongNonce = jwt({ iss: 'https://accounts.google.com', aud: 'cid', exp: now + 60, nonce: 'other', sub: 's' });
  const nn = async () => Response.json({ id_token: wrongNonce });
  await assert.rejects(exchangeCode({ env: { GOOGLE_CLIENT_ID: 'cid' }, fetchImpl: /** @type {typeof fetch} */ (nn) }, { code: 'c', verifier: 'v', redirectUri: 'r', nonce: 'n' }), /nonce mismatch/);
});

test('id_token with wrong issuer or past exp is refused', async () => {
  const now = Math.floor(Date.now() / 1000);
  const wrongIss = jwt({ iss: 'https://evil.example', aud: 'cid', exp: now + 60, nonce: 'n', sub: 's' });
  const fi = async () => Response.json({ id_token: wrongIss });
  await assert.rejects(exchangeCode({ env: { GOOGLE_CLIENT_ID: 'cid' }, fetchImpl: /** @type {typeof fetch} */ (fi) }, { code: 'c', verifier: 'v', redirectUri: 'r', nonce: 'n' }), /issuer mismatch/);

  const past = jwt({ iss: 'https://accounts.google.com', aud: 'cid', exp: now - 60, nonce: 'n', sub: 's' });
  const fp = async () => Response.json({ id_token: past });
  await assert.rejects(exchangeCode({ env: { GOOGLE_CLIENT_ID: 'cid' }, fetchImpl: /** @type {typeof fetch} */ (fp) }, { code: 'c', verifier: 'v', redirectUri: 'r', nonce: 'n' }), /expired/);
});
