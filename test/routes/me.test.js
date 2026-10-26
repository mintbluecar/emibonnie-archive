// @ts-check
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { freshDb } from '../helpers/db.js';
import { apiFor } from '../helpers/api.js';
import { signInUser } from '../../src/services/session.js';

const site = { ownerXUserId: '0' };

/** @type {Awaited<ReturnType<typeof freshDb>>} */
let db;
before(async () => { db = await freshDb(); });
after(async () => { await db.end(); });

const deps = () => ({ db, site, env: {}, fetchImpl: fetch, now: () => new Date() });

/** Sign in and return the sid token (cookie value). */
async function sidFor(input) {
  const { cookie } = await signInUser(deps(), input);
  return cookie.replace(/^sid=/, '').split(';')[0];
}

test('GET /api/me signed out is { user: null }', async () => {
  const api = apiFor(deps());
  const res = await api.call('GET', '/api/me');
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.text), { user: null });
});

test('a google user needs a name until they set one', async () => {
  const token = await sidFor({ via: 'google', subject: 'g-1', handle: null });
  const api = apiFor(deps());
  const me = JSON.parse((await api.call('GET', '/api/me', { cookies: { sid: token } })).text);
  assert.deepEqual(me.user, {
    via: 'google', handle: null, displayName: null, isOwner: false, isTranslator: false, needsName: true,
  });

  // Set a name.
  const set = await api.call('POST', '/api/me/name', { cookies: { sid: token }, body: { name: 'Nice Fan' } });
  assert.equal(set.status, 200, set.text);
  assert.deepEqual(JSON.parse(set.text), { ok: true, name: 'Nice Fan' });

  // Now needsName is false and displayName is set.
  const after = JSON.parse((await api.call('GET', '/api/me', { cookies: { sid: token } })).text);
  assert.equal(after.user.needsName, false);
  assert.equal(after.user.displayName, 'Nice Fan');
});

test('POST /api/me/name rejects a handle-like or invalid name', async () => {
  const token = await sidFor({ via: 'google', subject: 'g-2', handle: null });
  const api = apiFor(deps());
  for (const name of ['@vacantvolcanic', '', 'x'.repeat(31)]) {
    const res = await api.call('POST', '/api/me/name', { cookies: { sid: token }, body: { name } });
    assert.equal(res.status, 400, `${name}: ${res.text}`);
  }
});

test('an X user shows their handle, never needsName', async () => {
  const token = await sidFor({ via: 'x', subject: '0', handle: 'the_owner' });
  const api = apiFor(deps());
  const me = JSON.parse((await api.call('GET', '/api/me', { cookies: { sid: token } })).text);
  assert.deepEqual(me.user, {
    via: 'x', handle: 'the_owner', displayName: null, isOwner: true, isTranslator: false, needsName: false,
  });
});

test('sign out clears the session; sign out all ends every session', async () => {
  const token = await sidFor({ via: 'x', subject: '7', handle: 'member' });
  const api = apiFor(deps());
  // signout-all signs out everywhere (only this user's one session here).
  const all = await api.call('POST', '/api/auth/signout-all', { cookies: { sid: token } });
  assert.equal(all.status, 200, all.text);
  assert.ok(all.setCookies.some((c) => c.startsWith('sid=') && c.includes('Max-Age=0')));

  // A plain signout also works (already signed out; still returns 200 + clear).
  const out = await api.call('POST', '/api/auth/signout', { cookies: { sid: token } });
  assert.equal(out.status, 200);
});

test('dev sign-in is 404 when VERCEL is set', async () => {
  const api = apiFor(deps(), { env: { VERCEL: '1', DEV_SIGN_IN: '1' } });
  const res = await api.call('POST', '/api/auth/dev', { body: { as: 'member' } });
  assert.equal(res.status, 404);
});

test('dev sign-in works when DEV_SIGN_IN=1 and no VERCEL', async () => {
  const api = apiFor(deps(), { env: { DEV_SIGN_IN: '1' } });
  const res = await api.call('POST', '/api/auth/dev', { body: { as: 'member' } });
  assert.equal(res.status, 200, res.text);
  assert.ok(res.setCookies.some((c) => c.startsWith('sid=')));
});
