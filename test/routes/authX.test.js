// @ts-check
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { freshDb } from '../helpers/db.js';
import { apiFor } from '../helpers/api.js';

const ENV = { AUTH_SECRET: 'test-auth-secret', X_CLIENT_ID: 'cid', X_CLIENT_SECRET: 'sec' };
const site = { ownerXUserId: '0' };

/** @type {Awaited<ReturnType<typeof freshDb>>} */
let db;
/** @type {Record<string, number>} */
let calls;
before(async () => {
  db = await freshDb();
  calls = {};
});
after(async () => { await db.end(); });

/** A fake X API: token exchange and /2/users/me. */
function infra({ me = { id: '12345', username: 'alice' }, failMe = false, failToken = false } = {}) {
  const fetchImpl = async (/** @type {string} */ url, /** @type {any} */ init) => {
    void init;
    calls[url] = (calls[url] ?? 0) + 1;
    if (url === 'https://api.x.com/2/oauth2/token') {
      if (failToken) return new Response('', { status: 400 });
      // Record what was requested so a test can assert nothing sensitive is asked.
      return Response.json({ access_token: 'tok-1' });
    }
    if (url === 'https://api.x.com/2/users/me') {
      if (failMe) return new Response('', { status: 500 });
      return Response.json({ data: me });
    }
    return new Response('', { status: 404 });
  };
  return fetchImpl;
}

/** Full deps for the route. @param {() => Date} [now] */
function deps(fetchImpl, now = () => new Date()) {
  return { db, site, env: ENV, fetchImpl: /** @type {typeof fetch} */ (fetchImpl), now };
}

/** Runs `/api/auth/x/start`, returning the state and the oauth cookie value. */
async function start(api, returnPath = '/add') {
  const res = await api.call('GET', `/api/auth/x/start${returnPath ? `?return=${encodeURIComponent(returnPath)}` : ''}`);
  assert.equal(res.status, 302, res.text);
  const location = res.headers.get('location');
  assert.ok(location);
  const state = new URL(location).searchParams.get('state');
  const oauthCookie = res.setCookies.find((c) => c.startsWith('oauth='));
  assert.ok(oauthCookie, 'start sets the oauth cookie');
  return { state: /** @type {string} */ (state), oauth: oauthCookie.split(';')[0].replace(/^oauth=/, '') };
}

test('callback signs in and sets sid, redirecting to returnTo', async () => {
  const api = apiFor(deps(infra()), { env: ENV });
  const { state, oauth } = await start(api, '/add');
  const cb = await api.call('GET', `/api/auth/x/callback?code=code&state=${state}`, { cookies: { oauth } });
  assert.equal(cb.status, 302, cb.text);
  assert.equal(cb.headers.get('location'), '/add');
  const sid = cb.setCookies.find((c) => c.startsWith('sid='));
  assert.ok(sid, 'callback sets the sid cookie');
  assert.match(sid, /HttpOnly/);
  // The oauth cookie is cleared.
  assert.ok(cb.setCookies.some((c) => c.startsWith('oauth=') && c.includes('Max-Age=0')));
  // A user row was created, with no email or profile image.
  const { rows } = await db.query("select id, meta from users where id = 'x:12345'");
  assert.equal(rows.length, 1);
  assert.ok(!JSON.stringify(rows[0].meta).includes('email'));
  assert.ok(!JSON.stringify(rows[0].meta).includes('image'));
});

test('callback rejects a missing, tampered or mismatched state with 400 and no user row', async () => {
  const api = apiFor(deps(infra()), { env: ENV });
  const tokenBefore = calls['https://api.x.com/2/oauth2/token'] ?? 0;
  const usersBefore = await db.query("select count(*)::int as n from users where id like 'x:%'").then((r) => r.rows[0].n);

  // Missing cookie.
  let res = await api.call('GET', '/api/auth/x/callback?code=c&state=s');
  assert.equal(res.status, 400);

  // Tampered (bad signature).
  const { state, oauth } = await start(api);
  const tampered = oauth.slice(0, -1) + (oauth.endsWith('a') ? 'b' : 'a');
  res = await api.call('GET', `/api/auth/x/callback?code=c&state=${state}`, { cookies: { oauth: tampered } });
  assert.equal(res.status, 400);

  // Mismatched (a valid cookie for a different state).
  const other = await start(api);
  res = await api.call('GET', `/api/auth/x/callback?code=c&state=${other.state}`, { cookies: { oauth } });
  assert.equal(res.status, 400);

  assert.equal(calls['https://api.x.com/2/oauth2/token'] ?? 0, tokenBefore, 'no token exchange for a bad state');
  const after = await db.query("select count(*)::int as n from users where id like 'x:%'").then((r) => r.rows[0].n);
  assert.equal(after, usersBefore, 'no user row for a bad state');
});

test('a replayed state fails once the cookie is cleared', async () => {
  const api = apiFor(deps(infra()), { env: ENV });
  const { state, oauth } = await start(api);
  const first = await api.call('GET', `/api/auth/x/callback?code=c&state=${state}`, { cookies: { oauth } });
  assert.equal(first.status, 302);
  // The callback clears the oauth cookie (single-use): a compliant browser
  // drops it, so a replayed callback arrives without it and is refused.
  assert.ok(first.setCookies.some((c) => c.startsWith('oauth=') && c.includes('Max-Age=0')));
  const replay = await api.call('GET', `/api/auth/x/callback?code=c&state=${state}`);
  assert.equal(replay.status, 400);
  const { rows } = await db.query("select count(*)::int as n from users where id = 'x:12345'");
  assert.equal(rows[0].n, 1, 'only one sign-in, however many replays');
});

test('returnTo outside the site falls back to /me', async () => {
  const api = apiFor(deps(infra()), { env: ENV });
  for (const bad of ['//evil.example', 'https://evil.example', '/\\evil.example']) {
    const { state, oauth } = await start(api, bad);
    const cb = await api.call('GET', `/api/auth/x/callback?code=c&state=${state}`, { cookies: { oauth } });
    assert.equal(cb.status, 302);
    assert.equal(cb.headers.get('location'), '/me', `returnTo ${bad} fell back to /me`);
  }
});

test('users/me failure records xSignInFailedAt and redirects to /me?signin=failed', async () => {
  const api = apiFor(deps(infra({ failMe: true })), { env: ENV });
  const { state, oauth } = await start(api);
  const cb = await api.call('GET', `/api/auth/x/callback?code=c&state=${state}`, { cookies: { oauth } });
  assert.equal(cb.status, 302);
  assert.equal(cb.headers.get('location'), '/me?signin=failed');
  assert.ok(!cb.setCookies.some((c) => c.startsWith('sid=')), 'no sid cookie on failure');
  const { rows } = await db.query("select value from settings where key = 'xSignInFailedAt'");
  assert.equal(rows.length, 1);
  assert.equal(typeof rows[0].value, 'string');
});

test('xSignInFailedAt is stamped from deps.now(), not the real clock', async () => {
  const fixed = new Date('2026-05-01T12:00:00.000Z');
  const api = apiFor(deps(infra({ failMe: true }), () => fixed), { env: ENV });
  const { state, oauth } = await start(api);
  await api.call('GET', `/api/auth/x/callback?code=c&state=${state}`, { cookies: { oauth } });
  const { rows } = await db.query("select value from settings where key = 'xSignInFailedAt'");
  assert.equal(rows[0].value, fixed.toISOString());
});

test('no email or image is requested or stored', async () => {
  // The authorize URL requests only the two scopes (asserted in xSignIn.test.js),
  // and the token+users/me flow never asks for or stores email/profile image.
  const api = apiFor(deps(infra()), { env: ENV });
  const { state, oauth } = await start(api);
  await api.call('GET', `/api/auth/x/callback?code=c&state=${state}`, { cookies: { oauth } });
  const { rows } = await db.query("select meta from users where id = 'x:12345'");
  assert.equal(rows.length, 1);
  const meta = JSON.stringify(rows[0].meta).toLowerCase();
  assert.ok(!meta.includes('email'));
  assert.ok(!meta.includes('image'));
  assert.ok(!meta.includes('picture'));
});
