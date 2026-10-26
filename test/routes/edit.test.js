// @ts-check
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { IDS } from '../helpers/fixtures.js';
import { ingestDeps, ingest, count, SYSTEM } from '../helpers/ingest.js';
import { apiFor } from '../helpers/api.js';
import { signInUser } from '../../src/services/session.js';
import { set as setSetting } from '../../src/repo/settings.js';

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

test('a blocked user gets 403 on edit and follow-ups and nothing changes', async () => {
  const { sid } = await sidFor({ via: 'x', subject: '7', handle: 'member' });
  await deps.db.transaction((tx) => tx.query("update users set blocked_at = now() where id = 'x:7'"), SYSTEM);
  const api = apiFor({ ...deps, env: ENV }, { env: ENV });
  const before = await count(deps.db, 'select count(*)::int as n from item_edits');
  const edit = await api.call('POST', `/api/item/translation/${IDS.EVENT_A}/edit`, { cookies: { sid }, body: { changes: { placement: 'unsorted' } } });
  assert.equal(edit.status, 403);
  const follow = await api.call('POST', `/api/item/translation/${IDS.EVENT_A}/follow-ups`, { cookies: { sid } });
  assert.equal(follow.status, 403);
  assert.equal(await count(deps.db, 'select count(*)::int as n from item_edits'), before);
});

test('check for follow-ups adds the THREAD_FOLLOWUP part; held pending when approval is on', async () => {
  const own = await ingestDeps();
  try {
    const signup = await signInUser({ db: own.db, site: own.site, now: () => new Date() }, { via: 'x', subject: '0', handle: 'owner' });
    const owner = { sid: signup.cookie.replace(/^sid=/, '').split(';')[0] };
    await ingest(own, IDS.THREAD);
    // Turn on approval, then check follow-ups: new parts are held pending.
    await own.db.transaction((tx) => setSetting(tx, 'approvalRequired', true), SYSTEM);
    const api = apiFor({ ...own, env: ENV }, { env: ENV });
    const res = await api.call('POST', `/api/item/translation/${IDS.THREAD}/follow-ups`, { cookies: owner });
    assert.equal(res.status, 200, res.text);
    const json = JSON.parse(res.text);
    assert.equal(typeof json.added, 'number');
    assert.equal(json.pending, true);
  } finally {
    await own.db.end();
  }
});

test('history is owner-only', async () => {
  const owner = await sidFor({ via: 'x', subject: '0', handle: 'owner' });
  const member = await sidFor({ via: 'x', subject: '9', handle: 'member' });
  // The member is the submitter, so they can reach the edit screen, but see no history.
  await ingest(deps, IDS.PHOTO, { actor: 'x:9' });

  const api = apiFor({ ...deps, env: ENV }, { env: ENV });
  // Make one edit (as owner) so there's history.
  await api.call('POST', `/api/item/translation/${IDS.PHOTO}/edit`, { cookies: owner, body: { changes: { placement: 'unsorted' } } });

  const ownerView = JSON.parse((await api.call('GET', `/api/item/translation/${IDS.PHOTO}/edit`, { cookies: owner })).text);
  assert.ok(Array.isArray(ownerView.history));
  assert.ok(ownerView.history.length >= 1, 'owner sees history');

  const memberView = JSON.parse((await api.call('GET', `/api/item/translation/${IDS.PHOTO}/edit`, { cookies: member })).text);
  assert.deepEqual(memberView.history, [], 'non-owner sees no history');
});

test('item detail is private no-store with a session, public without', async () => {
  await ingest(deps, IDS.EVENT_A);
  const api = apiFor({ ...deps, env: ENV });
  const pub = await api.call('GET', `/api/item/translation/${IDS.EVENT_A}`);
  assert.equal(pub.status, 200);
  assert.match(pub.headers.get('cache-control') ?? '', /^public, s-maxage=300/);

  const owner = await sidFor({ via: 'x', subject: '0', handle: 'owner' });
  const priv = await api.call('GET', `/api/item/translation/${IDS.EVENT_A}`, { cookies: owner });
  assert.equal(priv.status, 200);
  assert.match(priv.headers.get('cache-control') ?? '', /private, no-store/);
  const json = JSON.parse(priv.text);
  assert.equal(json.canEdit, true);
  assert.equal(json.canCheckFollowUps, true);
});
