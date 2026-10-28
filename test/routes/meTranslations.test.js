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
