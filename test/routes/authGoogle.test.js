// @ts-check
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { freshDb } from '../helpers/db.js';
import { apiFor } from '../helpers/api.js';

const ENV = { AUTH_SECRET: 'test-auth-secret', GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'sec' };
const site = { ownerXUserId: '0' };

/** @param {Record<string, unknown>} payload */
const jwt = (payload) => `${Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;

/** @type {Awaited<ReturnType<typeof freshDb>>} */
let db;
before(async () => { db = await freshDb(); });
after(async () => { await db.end(); });

test('google sign-in requests openid only and stores no name or email', async () => {
  const api = apiFor({ db, site, env: ENV, fetchImpl: fetch, now: () => new Date() }, { env: ENV });
  const start = await api.call('GET', '/api/auth/google/start?return=/me');
  assert.equal(start.status, 302, start.text);
  const url = new URL(/** @type {string} */ (start.headers.get('location')));
  assert.equal(url.searchParams.get('scope'), 'openid');
  assert.ok(url.searchParams.get('nonce'), 'the OIDC nonce is sent (it guards replay)');
  const oauth = start.setCookies.find((c) => c.startsWith('oauth='));
  assert.ok(oauth, 'the oauth state cookie is set');
});

test('google callback with a bad state is 400', async () => {
  const api = apiFor({ db, site, env: ENV, fetchImpl: fetch, now: () => new Date() }, { env: ENV });
  const res = await api.call('GET', '/api/auth/google/callback?code=c&state=bad');
  assert.equal(res.status, 400);
  const { rows } = await db.query("select count(*)::int as n from users where id like 'google:%'");
  assert.equal(rows[0].n, 0, 'no user from a bad state');
});

test('google callback signs in with the validated sub and sets a session', async () => {
  let nonce = '';
  const fetchImpl = async (/** @type {any} */ input) => {
    if (String(input) !== 'https://oauth2.googleapis.com/token') return new Response('not found', { status: 404 });
    const idToken = jwt({
      iss: 'https://accounts.google.com', aud: 'cid', exp: Math.floor(Date.now() / 1000) + 60,
      nonce, sub: 'google-sub-9',
    });
    return Response.json({ id_token: idToken });
  };
  const api = apiFor({ db, site, env: ENV, fetchImpl: /** @type {any} */ (fetchImpl), now: () => new Date() }, { env: ENV });

  const start = await api.call('GET', '/api/auth/google/start?return=/add');
  const raw = /** @type {string} */ (start.setCookies.find((c) => c.startsWith('oauth=')))
    .replace(/^oauth=/, '').split(';')[0];
  const state = JSON.parse(raw.slice(0, raw.lastIndexOf('.')));
  nonce = state.nonce;

  const cb = await api.call('GET', `/api/auth/google/callback?code=c&state=${state.state}`, { cookies: { oauth: raw } });
  assert.equal(cb.status, 302, cb.text);
  assert.equal(cb.headers.get('location'), '/add');
  assert.ok(cb.setCookies.some((c) => c.startsWith('sid=') && !c.startsWith('sid=;')), 'a session cookie is issued');
  const { rows } = await db.query("select id from users where id = 'google:google-sub-9'");
  assert.equal(rows.length, 1, 'the user row is created from the validated sub');
});
