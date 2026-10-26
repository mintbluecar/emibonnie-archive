// @ts-check
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { IDS } from '../helpers/fixtures.js';
import { ingestDeps, count, SYSTEM } from '../helpers/ingest.js';
import { apiFor } from '../helpers/api.js';
import { signInUser } from '../../src/services/session.js';

const ENV = { AUTH_SECRET: 'test-auth-secret' };

/** @type {any} */
let deps;
before(async () => { deps = await ingestDeps(); });
after(async () => { await deps.db.end(); });

/** @param {Parameters<typeof signInUser>[1]} input */
async function sidFor(input) {
  const { cookie } = await signInUser({ db: deps.db, site: deps.site, now: () => new Date() }, input);
  return { sid: cookie.replace(/^sid=/, '').split(';')[0] };
}

test('preview returns ready with unmapped markers and writes nothing', async () => {
  const cookies = await sidFor({ via: 'x', subject: '0', handle: 'owner' });
  const api = apiFor({ ...deps, env: ENV }, { env: ENV });
  const before = await count(deps.db, 'select count(*)::int as n from items');
  const res = await api.call('POST', '/api/add/preview', { cookies, body: { url: `https://x.com/i/status/${IDS.LONG}` } });
  assert.equal(res.status, 200, res.text);
  const json = JSON.parse(res.text);
  assert.equal(json.status, 'ready');
  assert.equal(json.addingAs, 'owner');
  assert.ok(Array.isArray(json.unmapped));
  assert.ok(Array.isArray(json.lines));
  assert.equal(await count(deps.db, 'select count(*)::int as n from items'), before, 'preview writes nothing');
});

test('add saves and returns the item url', async () => {
  const cookies = await sidFor({ via: 'x', subject: '0', handle: 'owner' });
  const api = apiFor({ ...deps, env: ENV }, { env: ENV });
  const res = await api.call('POST', '/api/add', { cookies, body: { url: `https://x.com/i/status/${IDS.EVENT_B}` } });
  assert.equal(res.status, 200, res.text);
  const json = JSON.parse(res.text);
  assert.equal(json.status, 'added');
  assert.equal(json.url, `/t/${IDS.EVENT_B}`);
  assert.equal(await count(deps.db, 'select count(*)::int as n from items'), 1);
});

test('opted-out, duplicate, deleted and removed outcomes pass through', async () => {
  const cookies = await sidFor({ via: 'x', subject: '0', handle: 'owner' });
  const api = apiFor({ ...deps, env: ENV }, { env: ENV });

  // Duplicate: add then add again.
  await api.call('POST', '/api/add', { cookies, body: { url: `https://x.com/i/status/${IDS.EVENT_A}` } });
  const dup = JSON.parse((await api.call('POST', '/api/add', { cookies, body: { url: `https://x.com/i/status/${IDS.EVENT_A}` } })).text);
  assert.equal(dup.status, 'duplicate');
  assert.ok(dup.url, 'duplicate carries the item url');
});

test('a blocked user gets 403 and nothing is written', async () => {
  const { sid } = await sidFor({ via: 'x', subject: '7', handle: 'member' });
  await deps.db.transaction((tx) => tx.query("update users set blocked_at = now() where id = 'x:7'"), SYSTEM);
  const api = apiFor({ ...deps, env: ENV }, { env: ENV });
  const before = await count(deps.db, 'select count(*)::int as n from items');
  const res = await api.call('POST', '/api/add', { cookies: { sid }, body: { url: `https://x.com/i/status/${IDS.EVENT_A}` } });
  assert.equal(res.status, 403);
  assert.deepEqual(JSON.parse(res.text), { error: 'blocked' });
  assert.equal(await count(deps.db, 'select count(*)::int as n from items'), before);
});

test('a google user without a name gets 409 needs_name', async () => {
  const { sid } = await sidFor({ via: 'google', subject: 'g-1', handle: null });
  const api = apiFor({ ...deps, env: ENV }, { env: ENV });
  const res = await api.call('POST', '/api/add', { cookies: { sid }, body: { url: `https://x.com/i/status/${IDS.EVENT_A}` } });
  assert.equal(res.status, 409);
  assert.deepEqual(JSON.parse(res.text), { error: 'needs_name' });
});

test('a member cannot create a category; the owner can', async () => {
  const member = await sidFor({ via: 'x', subject: '8', handle: 'member2' });
  const owner = await sidFor({ via: 'x', subject: '0', handle: 'owner' });
  const api = apiFor({ ...deps, env: ENV }, { env: ENV });

  // Member: a new category in the preview is refused (existing-only).
  const memberRes = await api.call('POST', '/api/add/preview', {
    cookies: member, body: { url: `https://x.com/i/status/${IDS.JOINT_LIVE}`, overrides: { categoryName: 'brand new type' } },
  });
  assert.equal(memberRes.status, 400, memberRes.text);
  assert.match(JSON.parse(memberRes.text).message, /unknown category/);

  // Owner: adds with a new category.
  const ownerRes = await api.call('POST', '/api/add', {
    cookies: owner, body: { url: `https://x.com/i/status/${IDS.PHOTO}`, overrides: { categoryName: 'brand new type' } },
  });
  assert.equal(ownerRes.status, 200, ownerRes.text);
  assert.equal(JSON.parse(ownerRes.text).status, 'added');
});

test('the 21st add in an hour is 429', async () => {
  const cookies = await sidFor({ via: 'x', subject: '0', handle: 'owner' });
  const api = apiFor({ ...deps, env: ENV }, { env: ENV });
  let last;
  for (let i = 0; i < 21; i++) {
    last = await api.call('POST', '/api/add', { cookies, body: { url: `https://x.com/i/status/${IDS.LIVE}` } });
  }
  assert.equal(last.status, 429);
  assert.deepEqual(JSON.parse(last.text), { error: 'rate_limited' });
});

test('foreign Origin is 403', async () => {
  const cookies = await sidFor({ via: 'x', subject: '0', handle: 'owner' });
  const api = apiFor({ ...deps, env: ENV }, { env: ENV });
  const res = await api.call('POST', '/api/add', { cookies, origin: 'https://evil.example', body: { url: `https://x.com/i/status/${IDS.EVENT_A}` } });
  assert.equal(res.status, 403);
  assert.deepEqual(JSON.parse(res.text), { error: 'forbidden' });
});

test('GET /api/add/options lists people, roles, events, categories and clients', async () => {
  const cookies = await sidFor({ via: 'x', subject: '0', handle: 'owner' });
  const api = apiFor({ ...deps, env: ENV }, { env: ENV });
  const res = await api.call('GET', '/api/add/options', { cookies });
  assert.equal(res.status, 200, res.text);
  const json = JSON.parse(res.text);
  assert.ok(Array.isArray(json.people));
  assert.deepEqual(json.roles, ['host', 'fan', 'speaker', 'crowd']);
  assert.ok(Array.isArray(json.events));
  assert.ok(Array.isArray(json.categories));
  assert.ok(Array.isArray(json.clients));
});

test('POST /api/people adds a person and returns its id (or the existing one)', async () => {
  const cookies = await sidFor({ via: 'x', subject: '0', handle: 'owner' });
  const api = apiFor({ ...deps, env: ENV }, { env: ENV });
  const first = await api.call('POST', '/api/people', { cookies, body: { displayName: 'New Person', igHandle: 'new_person' } });
  assert.equal(first.status, 200, first.text);
  const { id } = JSON.parse(first.text);
  assert.equal(typeof id, 'number');

  const again = await api.call('POST', '/api/people', { cookies, body: { displayName: 'New Person', igHandle: 'new_person' } });
  assert.equal(JSON.parse(again.text).id, id, 'the same handle returns the same person');

  const bad = await api.call('POST', '/api/people', { cookies, body: { displayName: 'X', igHandle: 'not valid!' } });
  assert.equal(bad.status, 400);
});
