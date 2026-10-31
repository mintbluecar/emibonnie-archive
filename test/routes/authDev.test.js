// @ts-check
/**
 * `GET /api/auth/dev`: the browser form of the dev sign-in that `DEV_AS`
 * (scripts/dev.js) redirects to.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { seededDeps } from '../helpers/ingest.js';
import { apiFor } from '../helpers/api.js';

/** @type {Awaited<ReturnType<typeof seededDeps>>} */
let deps;
/** @type {ReturnType<typeof apiFor>} */
let dev;
const ENV = { DEV_SIGN_IN: '1' };

before(async () => {
  deps = await seededDeps();
  dev = apiFor(deps, { env: ENV });
});
after(async () => { await deps.db.end(); });

/** @param {string[]} cookies @param {string} name */
const cookieValue = (cookies, name) => cookies.find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1).split(';')[0];

test('is a 404 when DEV_SIGN_IN is off', async () => {
  const res = await apiFor(deps).call('GET', '/api/auth/dev?as=owner');
  assert.equal(res.status, 404);
});

test('is a 404 on Vercel even with DEV_SIGN_IN', async () => {
  const env = { DEV_SIGN_IN: '1', VERCEL: '1' };
  const res = await apiFor(deps, { env }).call('GET', '/api/auth/dev?as=owner');
  assert.equal(res.status, 404);
});

test('as=owner signs in, marks the browser, and redirects back', async () => {
  const res = await dev.call('GET', `/api/auth/dev?as=owner&returnTo=${encodeURIComponent('/edit/translation/1?x=1')}`);
  assert.equal(res.status, 302, res.text);
  assert.equal(res.headers.get('location'), '/edit/translation/1?x=1');
  assert.equal(cookieValue(res.setCookies, 'dev_as'), 'owner');
  const sid = cookieValue(res.setCookies, 'sid');
  assert.ok(sid);
  assert.equal(cookieValue(res.setCookies, 'signed_in'), '1', 'the sign-in hint, like a real sign-in');
  const me = JSON.parse((await dev.call('GET', '/api/me', { cookies: { sid } })).text);
  assert.equal(me.user.isOwner, true);
});

test('as=google signs in as a Google user (no X handle), marks the browser, and redirects back', async () => {
  const res = await dev.call('GET', '/api/auth/dev?as=google');
  assert.equal(res.status, 302, res.text);
  assert.equal(res.headers.get('location'), '/');
  assert.equal(cookieValue(res.setCookies, 'dev_as'), 'google');
  const sid = cookieValue(res.setCookies, 'sid');
  assert.ok(sid);
  const me = JSON.parse((await dev.call('GET', '/api/me', { cookies: { sid } })).text);
  assert.equal(me.user.via, 'google');
  assert.equal(me.user.handle, null);
  assert.equal(me.user.isOwner, false);
});

test('an off-site returnTo goes nowhere off-site', async () => {
  const res = await dev.call('GET', `/api/auth/dev?as=member&returnTo=${encodeURIComponent('//evil.example/')}`);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/me');
});

test('as=translator signs in as a real credited account, or the one named by handle', async () => {
  const res = await dev.call('GET', '/api/auth/dev?as=translator');
  assert.equal(res.status, 302, res.text);
  const me = JSON.parse((await dev.call('GET', '/api/me', { cookies: { sid: cookieValue(res.setCookies, 'sid') ?? '' } })).text);
  assert.equal(me.user.isTranslator, true);

  const named = await dev.call('GET', `/api/auth/dev?as=translator&handle=${encodeURIComponent(me.user.handle.toUpperCase())}`);
  assert.equal(named.status, 302, named.text);
  const missing = await dev.call('GET', '/api/auth/dev?as=translator&handle=nobody_here');
  assert.equal(missing.status, 404);
});

test('as=guest signs out and marks the browser', async () => {
  const res = await dev.call('GET', '/api/auth/dev?as=guest');
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/');
  assert.equal(cookieValue(res.setCookies, 'dev_as'), 'guest');
  assert.equal(cookieValue(res.setCookies, 'sid'), '');
  assert.equal(cookieValue(res.setCookies, 'signed_in'), '', 'the sign-in hint is cleared too');
});

test('an unknown role is a 400', async () => {
  const res = await dev.call('GET', '/api/auth/dev?as=admin');
  assert.equal(res.status, 400);
});
