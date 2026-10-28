// @ts-check
/**
 * Plan 2b Task 4: the translator list route and the welcome flag on
 * `GET /api/me`, signed in.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { seededDeps } from '../helpers/ingest.js';
import { apiFor } from '../helpers/api.js';
import { signInUser } from '../../src/services/session.js';


/** @type {Awaited<ReturnType<typeof seededDeps>>} */
let deps;
/** @type {ReturnType<typeof apiFor>} */
let api;
/** @type {{ externalId: string, handle: string, sid: string }} */
let translator;

before(async () => {
  deps = await seededDeps();
  api = apiFor(deps);
  const { rows } = await deps.db.query(
    `select a.external_id, a.handle
     from accounts a
     join items i on i.credited_account_id = a.id
     where a.platform = 'x' and a.external_id is not null and a.deleted_at is null and i.deleted_at is null
     order by a.id limit 1`,
  );
  const { cookie } = await signInUser(deps, { via: 'x', subject: rows[0].external_id, handle: rows[0].handle });
  translator = { externalId: rows[0].external_id, handle: rows[0].handle, sid: cookie.replace(/^sid=/, '').split(';')[0] };
});
after(async () => { await deps.db.end(); });

test('wants a session', async () => {
  const res = await api.call('GET', '/api/me/translations');
  assert.equal(res.status, 401);
});

test('a member with no credited account gets an empty list and zero totals', async () => {
  const { cookie } = await signInUser(deps, { via: 'x', subject: '424242', handle: 'no_credits' });
  const sid = cookie.replace(/^sid=/, '').split(';')[0];
  const res = await api.call('GET', '/api/me/translations', { cookies: { sid } });
  assert.equal(res.status, 200);
  const body = JSON.parse(res.text);
  assert.deepEqual(body.items, []);
  assert.deepEqual(body.totals, { translations: 0, events: 0, sharedStories: 0 });
  assert.equal(body.hasMore, false);
});

test('a recognised translator sees their credited entries and totals', async () => {
  const res = await api.call('GET', '/api/me/translations?offset=0', { cookies: { sid: translator.sid } });
  assert.equal(res.status, 200);
  const body = JSON.parse(res.text);
  assert.ok(body.items.length > 0, 'credited items are listed');
  assert.ok(body.totals.translations > 0);
  assert.match(res.headers.get('cache-control') ?? '', /private/);
  for (const item of body.items) {
    assert.equal(typeof item.removedByYou, 'boolean');
    assert.equal(typeof item.hidden, 'boolean');
    assert.ok(item.url);
  }
});

test('the welcome flag is on until it is marked, then off', async () => {
  const before = JSON.parse((await api.call('GET', '/api/me', { cookies: { sid: translator.sid } })).text);
  assert.equal(before.user.isTranslator, true);
  assert.equal(before.user.showTranslatorWelcome, true);

  const marked = await api.call('POST', '/api/me/welcomed', { cookies: { sid: translator.sid } });
  assert.equal(marked.status, 200);

  const after = JSON.parse((await api.call('GET', '/api/me', { cookies: { sid: translator.sid } })).text);
  assert.equal(after.user.showTranslatorWelcome, false);
});

test('a bad offset is a 400', async () => {
  const res = await api.call('GET', '/api/me/translations?offset=-1', { cookies: { sid: translator.sid } });
  assert.equal(res.status, 400);
});

// --- Task 5: remove and restore -------------------------------------------

test('a removed entry leaves every public surface and is purged', async () => {
  const calls = /** @type {string[][]} */ ([]);
  const env = { VERCEL: '1' };
  const purging = apiFor({ ...deps, env, invalidateByTag: async (/** @type {string[]} */ tags) => calls.push(tags), log: () => {} }, { env });

  const list = JSON.parse((await purging.call('GET', '/api/me/translations', { cookies: { sid: translator.sid } })).text);
  const entry = list.items.find((/** @type {any} */ item) => !item.removedByYou && !item.hidden);
  assert.ok(entry, 'a live credited entry');
  const line = entry.lines.find((/** @type {any} */ l) => 'text' in l && l.text.trim().length > 6);
  const q = [...line.text.trim()].slice(0, 12).join('');

  const res = await purging.call('POST', '/api/me/translations/remove', {
    cookies: { sid: translator.sid }, body: { items: [{ kind: entry.kind, sourceId: entry.sourceId }] },
  });
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(JSON.parse(res.text), { removed: 1 });
  await purging.settle();

  const item = await purging.call('GET', `/api/item/${entry.kind}/${entry.sourceId}`);
  assert.equal(item.status, 404, 'the item page is gone');
  const search = JSON.parse((await purging.call('GET', `/api/search?q=${encodeURIComponent(q)}`)).text);
  assert.ok(!search.results.some((/** @type {any} */ r) => r.sourceId === entry.sourceId), 'no search hit');

  const purged = calls.flat();
  for (const expected of ['home', 'search']) assert.ok(purged.includes(expected), `${expected} in ${purged.join(',')}`);
  assert.ok(purged.some((tag) => tag.startsWith('item:')), 'the entry tag is purged');

  const restored = await purging.call('POST', '/api/me/translations/restore', {
    cookies: { sid: translator.sid }, body: { items: [{ kind: entry.kind, sourceId: entry.sourceId }] },
  });
  assert.equal(restored.status, 200, restored.text);
  assert.deepEqual(JSON.parse(restored.text), { restored: 1 });
  assert.equal((await purging.call('GET', `/api/item/${entry.kind}/${entry.sourceId}`)).status, 200);
});

test('remove wants a session, and the 31st remove in an hour is 429', async () => {
  assert.equal((await api.call('POST', '/api/me/translations/remove', { body: { items: [] } })).status, 401);
  const { cookie } = await signInUser(deps, { via: 'x', subject: '5150', handle: 'rate_limited' });
  const sid = cookie.replace(/^sid=/, '').split(';')[0];
  let status = 0;
  for (let i = 0; i < 31; i++) {
    status = (await api.call('POST', '/api/me/translations/remove', { cookies: { sid }, body: { items: [] } })).status;
  }
  assert.equal(status, 429);
});

// --- Task 6: opt out / opt in ---------------------------------------------

test('opting out hides the translator everywhere and refuses new intake; opting in restores', async () => {
  const list = JSON.parse((await api.call('GET', '/api/me/translations', { cookies: { sid: translator.sid } })).text);
  const entry = list.items.find((/** @type {any} */ item) => !item.removedByYou && !item.hidden);
  assert.ok(entry, 'a live credited entry');

  const out = await api.call('POST', '/api/me/translations/opt-out', { cookies: { sid: translator.sid } });
  assert.equal(out.status, 200, out.text);
  assert.equal(JSON.parse(out.text).optedOut, true);

  assert.equal((await api.call('GET', `/api/item/${entry.kind}/${entry.sourceId}`)).status, 404);
  const page = await api.call('GET', `/api/account/${translator.handle}`);
  assert.deepEqual(JSON.parse(page.text), { account: { handle: translator.handle, optedOut: true } });

  const me = JSON.parse((await api.call('GET', '/api/me', { cookies: { sid: translator.sid } })).text);
  assert.equal(me.user.isOptedOut, true);

  const back = await api.call('POST', '/api/me/translations/opt-in', { cookies: { sid: translator.sid } });
  assert.equal(back.status, 200, back.text);
  assert.equal(JSON.parse(back.text).optedOut, false);
  assert.equal((await api.call('GET', `/api/item/${entry.kind}/${entry.sourceId}`)).status, 200);
});

test('a Google user with no X account cannot opt out', async () => {
  const { cookie } = await signInUser(deps, { via: 'google', subject: 'g-optout', handle: null });
  const sid = cookie.replace(/^sid=/, '').split(';')[0];
  const res = await api.call('POST', '/api/me/translations/opt-out', { cookies: { sid } });
  assert.equal(res.status, 403);
  assert.deepEqual(JSON.parse(res.text), { error: 'not_a_translator' });
});

// --- Task 11: the dev translator sign-in for e2e ---------------------------

test('dev sign-in as a translator returns the handle and a working session', async () => {
  const dev = apiFor({ ...deps, env: { DEV_SIGN_IN: '1' } }, { env: { DEV_SIGN_IN: '1' } });
  const res = await dev.call('POST', '/api/auth/dev', { body: { as: 'translator' } });
  assert.equal(res.status, 200, res.text);
  const body = JSON.parse(res.text);
  assert.ok(body.handle, 'the signed-in translator handle');
  const sid = res.setCookies.find((cookie) => cookie.startsWith('sid='))?.replace(/^sid=/, '').split(';')[0];
  assert.ok(sid);
  const me = JSON.parse((await dev.call('GET', '/api/me', { cookies: { sid } })).text);
  assert.equal(me.user.isTranslator, true);
});

test('dev sign-in is a 404 when DEV_SIGN_IN is off', async () => {
  const res = await api.call('POST', '/api/auth/dev', { body: { as: 'translator' } });
  assert.equal(res.status, 404);
});
