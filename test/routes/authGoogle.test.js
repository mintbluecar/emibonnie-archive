// @ts-check
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { freshDb } from '../helpers/db.js';
import { apiFor } from '../helpers/api.js';

const ENV = { AUTH_SECRET: 'test-auth-secret', GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'sec' };
const site = { ownerXUserId: '0' };

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
