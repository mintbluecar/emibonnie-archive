// @ts-check
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { ingestDeps } from '../helpers/ingest.js';
import { apiFor } from '../helpers/api.js';
import { signInUser } from '../../src/services/session.js';
import { insertItem } from '../../src/repo/items.js';

/** @type {Awaited<ReturnType<typeof ingestDeps>>} */
let depsSource;
let db;
before(async () => { depsSource = await ingestDeps(); db = depsSource.db; });
after(async () => { await db.end(); });

const deps = () => ({ ...depsSource, env: {} });

/** Add one of `userId`'s own items with a single text part (Task 12's own-list fixture). */
let sourceSeq = 0;
async function ownItem(userId, { reviewState = 'published', pendingPart = false, deleted = false } = {}) {
  sourceSeq += 1;
  const externalId = `29000000000000000${String(sourceSeq).padStart(3, '0')}`;
  const body = `own item ${sourceSeq}`;
  const itemId = await db.transaction(async (tx) => {
    const id = await insertItem(tx, {
      kind: 'translation', placement: 'post', occurredOn: '2026-10-01',
      postedAt: `2026-10-01T00:00:${String(sourceSeq % 60).padStart(2, '0')}.000Z`,
      addedVia: 'submit', reviewState,
    });
    await tx.query('insert into translations (item_id) values ($1)', [id]);
    const { rows } = await tx.query(
      `insert into item_sources (item_id, kind, platform, external_id, url, role)
       values ($1, 'translation', 'x', $2, $3, 'primary') returning id`,
      [id, externalId, `https://x.com/adder/status/${externalId}`],
    );
    await tx.query(
      'insert into translation_parts (item_id, position, source_id, body, pending) values ($1, 0, $2, $3, $4)',
      [id, rows[0].id, body, pendingPart],
    );
    if (deleted) await tx.query("update items set deleted_at = now(), deleted_reason = 'removed_by_account' where id = $1", [id]);
    return id;
  }, { actor: userId });
  return { itemId, body };
}

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

test('dev sign-in still works when VERCEL is present but empty (the e2e dev server forces it empty)', async () => {
  const api = apiFor(deps(), { env: { DEV_SIGN_IN: '1', VERCEL: '' } });
  const res = await api.call('POST', '/api/auth/dev', { body: { as: 'member' } });
  assert.equal(res.status, 200, res.text);
});

/** Sign in and return both the sid token and the user id. */
async function userFor(input) {
  const { cookie, user } = await signInUser(deps(), input);
  return { sid: cookie.replace(/^sid=/, '').split(';')[0], id: user.id };
}

test('GET /api/me/added is signed in only', async () => {
  const api = apiFor(deps());
  const res = await api.call('GET', '/api/me/added');
  assert.equal(res.status, 401, res.text);
});

test('GET /api/me/added lists my own items in every review state, newest first, private', async () => {
  const me = await userFor({ via: 'x', subject: '71', handle: 'adder' });
  const other = await userFor({ via: 'x', subject: '72', handle: 'someone' });
  const published = await ownItem(me.id);
  const pending = await ownItem(me.id, { reviewState: 'pending', pendingPart: true });
  const rejected = await ownItem(me.id, { reviewState: 'rejected' });
  await ownItem(me.id, { deleted: true });
  const theirs = await ownItem(other.id);

  const api = apiFor(deps());
  const res = await api.call('GET', '/api/me/added', { cookies: { sid: me.sid } });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
  const body = JSON.parse(res.text);
  assert.deepEqual(body.items.map((item) => item.reviewState), ['rejected', 'pending', 'published']);
  assert.equal(body.hasMore, false);
  assert.ok(body.items.every((item) => item.url.startsWith('/t/')));
  assert.equal(new Set(body.items.map((item) => item.url)).size, 3);
  assert.ok(body.items.every((item) => item.occurredOn === '2026-10-01' && item.placement === 'post' && item.kind === 'translation'));
  // No other user's item, and no deleted one.
  assert.ok(!JSON.stringify(body).includes(theirs.body));
  assert.equal(body.items.length, 3);
  // A held-back part is the submitter's own text: they see it.
  assert.ok(body.items[0].lines.some((line) => line.text === rejected.body), res.text);
  assert.ok(body.items[1].lines.some((line) => line.text === pending.body), res.text);
  assert.ok(body.items[2].lines.some((line) => line.text === published.body), res.text);
});

test('GET /api/me/added pages 20 at a time', async () => {
  const me = await userFor({ via: 'x', subject: '73', handle: 'prolific' });
  for (let i = 0; i < 21; i += 1) await ownItem(me.id);

  const api = apiFor(deps());
  const first = JSON.parse((await api.call('GET', '/api/me/added', { cookies: { sid: me.sid } })).text);
  assert.equal(first.items.length, 20);
  assert.equal(first.hasMore, true);

  const second = JSON.parse((await api.call('GET', '/api/me/added?offset=20', { cookies: { sid: me.sid } })).text);
  assert.equal(second.items.length, 1);
  assert.equal(second.hasMore, false);

  const empty = JSON.parse((await api.call('GET', '/api/me/added?offset=200', { cookies: { sid: me.sid } })).text);
  assert.deepEqual(empty, { items: [], hasMore: false });
});

test('GET /api/me/added rejects a bad offset', async () => {
  const me = await userFor({ via: 'x', subject: '74', handle: 'offsetter' });
  const api = apiFor(deps());
  for (const offset of ['-1', '1.5', 'abc']) {
    const res = await api.call('GET', `/api/me/added?offset=${offset}`, { cookies: { sid: me.sid } });
    assert.equal(res.status, 400, `${offset}: ${res.text}`);
  }
});
