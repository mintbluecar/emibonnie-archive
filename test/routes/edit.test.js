// @ts-check
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { IDS } from '../helpers/fixtures.js';
import { ingestDeps, ingest, count, rows, patchedFetch, SYSTEM } from '../helpers/ingest.js';
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
  const api = apiFor(deps, { env: ENV });
  const before = await count(deps.db, 'select count(*)::int as n from item_edits');
  const edit = await api.call('POST', `/api/item/translation/${IDS.EVENT_A}/edit`, { cookies: { sid }, body: { changes: { placement: 'unsorted' } } });
  assert.equal(edit.status, 403);
  const follow = await api.call('POST', `/api/item/translation/${IDS.EVENT_A}/follow-ups`, { cookies: { sid } });
  assert.equal(follow.status, 403);
  assert.equal(await count(deps.db, 'select count(*)::int as n from item_edits'), before);
});

test('a :kind path segment named for an Object.prototype property is 404, not a prototype lookup', async () => {
  const { sid } = await sidFor({ via: 'x', subject: '8', handle: 'member2' });
  const api = apiFor(deps, { env: ENV });
  const edit = await api.call('POST', `/api/item/constructor/1/edit`, { cookies: { sid }, body: { changes: { placement: 'unsorted' } } });
  assert.equal(edit.status, 404);
  const get = await api.call('GET', `/api/item/constructor/1/edit`, { cookies: { sid } });
  assert.equal(get.status, 404);
});

test('check for follow-ups adds the new reply as a part, held pending when approval is on', async () => {
  const own = await ingestDeps();
  try {
    const signup = await signInUser({ db: own.db, site: own.site, now: () => new Date() }, { via: 'x', subject: '0', handle: 'owner' });
    const owner = { sid: signup.cookie.replace(/^sid=/, '').split(';')[0] };
    await ingest(own, IDS.THREAD);
    // Turn on approval, then check follow-ups: the new part is held pending.
    await own.db.transaction((tx) => setSetting(tx, 'approvalRequired', true), SYSTEM);
    // The fixture's thread already archived its known replies at ingest, so
    // the "button" sees a genuinely new reply that appeared afterwards.
    const reply = {
      id: IDS.THREAD_REPLY, text: 'NEW FOLLOW-UP TEXT', author: { screen_name: 'tl_beta', id: '9002' },
      created_at: 'Tue Oct 20 12:00:00 +0000 2026', replying_to: { screen_name: 'tl_beta', status: IDS.THREAD_FOLLOWUP },
    };
    const { fetchImpl } = patchedFetch((kind, id, json) => (
      kind === 'thread' && id === IDS.THREAD ? { ...json, thread: [...json.thread, reply] } : json
    ));
    const api = apiFor({ ...own, fetchImpl }, { env: ENV });
    const res = await api.call('POST', `/api/item/translation/${IDS.THREAD}/follow-ups`, { cookies: owner });
    assert.equal(res.status, 200, res.text);
    assert.deepEqual(JSON.parse(res.text), { added: 1, pending: true });

    const [part] = await rows(
      own.db,
      "select tp.position, tp.pending, tp.body from translation_parts tp join item_sources s on s.item_id = tp.item_id and s.role = 'primary' where s.external_id = $1 order by tp.position desc limit 1",
      [IDS.THREAD],
    );
    assert.equal(part.pending, true, 'the appended part is held for review');
    // The thread file only says which posts are in the thread; each post's
    // text comes from its own fixture (the same one intake would read).
    assert.equal(part.body, 'One more: the lanterns were handmade too, which is why they took so long.');
    const appendedText = part.body;

    // The public page hides unreviewed text; the owner's edit screen shows it.
    const pub = JSON.parse((await api.call('GET', `/api/item/translation/${IDS.THREAD}`)).text);
    assert.ok(!JSON.stringify(pub).includes(appendedText), 'the public page hides the pending part');
    const edit = JSON.parse((await api.call('GET', `/api/item/translation/${IDS.THREAD}/edit`, { cookies: owner })).text);
    assert.ok(JSON.stringify(edit).includes(appendedText), 'the owner sees the pending part while editing');
  } finally {
    await own.db.end();
  }
});

test('a non-owner revert is 404 and an unknown edit id is 400', async () => {
  const own = await ingestDeps();
  try {
    await ingest(own, IDS.PHOTO);
    const o = await signInUser({ db: own.db, site: own.site, now: () => new Date() }, { via: 'x', subject: '0', handle: 'owner' });
    const owner = { sid: o.cookie.replace(/^sid=/, '').split(';')[0] };
    const memberSignup = await signInUser({ db: own.db, site: own.site, now: () => new Date() }, { via: 'x', subject: '9', handle: 'member' });
    const member = { sid: memberSignup.cookie.replace(/^sid=/, '').split(';')[0] };
    const api = apiFor(own, { env: ENV });

    const applied = await api.call('POST', `/api/item/translation/${IDS.PHOTO}/edit`, { cookies: owner, body: { changes: { placement: 'unsorted' } } });
    assert.equal(applied.status, 200, applied.text);
    const { editId } = JSON.parse(applied.text);

    const refused = await api.call('POST', `/api/item/translation/${IDS.PHOTO}/edits/${editId}/revert`, { cookies: member });
    assert.equal(refused.status, 404, 'owner-only route hides itself from a member');

    const unknown = await api.call('POST', `/api/item/translation/${IDS.PHOTO}/edits/999999/revert`, { cookies: owner });
    assert.equal(unknown.status, 400);
    const still = JSON.parse((await api.call('GET', `/api/item/translation/${IDS.PHOTO}`)).text);
    assert.equal(still.placement, 'unsorted', 'nothing was reverted');
  } finally {
    await own.db.end();
  }
});

test('history is owner-only', async () => {
  const owner = await sidFor({ via: 'x', subject: '0', handle: 'owner' });
  const member = await sidFor({ via: 'x', subject: '9', handle: 'member' });
  // The member is the submitter, so they can reach the edit screen, but see no history.
  await ingest(deps, IDS.PHOTO, { actor: 'x:9' });

  const api = apiFor(deps, { env: ENV });
  // Make one edit (as owner) so there's history.
  await api.call('POST', `/api/item/translation/${IDS.PHOTO}/edit`, { cookies: owner, body: { changes: { placement: 'unsorted' } } });

  const ownerView = JSON.parse((await api.call('GET', `/api/item/translation/${IDS.PHOTO}/edit`, { cookies: owner })).text);
  assert.ok(Array.isArray(ownerView.history));
  assert.ok(ownerView.history.length >= 1, 'owner sees history');

  const memberView = JSON.parse((await api.call('GET', `/api/item/translation/${IDS.PHOTO}/edit`, { cookies: member })).text);
  assert.deepEqual(memberView.history, [], 'non-owner sees no history');
});

test('item detail is the public answer with a session; the editor flags come from …/viewer', async () => {
  await ingest(deps, IDS.EVENT_A);
  const api = apiFor({ ...deps, env: ENV });
  const pub = await api.call('GET', `/api/item/translation/${IDS.EVENT_A}`);
  assert.equal(pub.status, 200);
  assert.match(pub.headers.get('cache-control') ?? '', /^public, s-maxage=300/);

  const owner = await sidFor({ via: 'x', subject: '0', handle: 'owner' });
  const same = await api.call('GET', `/api/item/translation/${IDS.EVENT_A}`, { cookies: owner });
  assert.match(same.headers.get('cache-control') ?? '', /^public, s-maxage=300/);
  const priv = await api.call('GET', `/api/item/translation/${IDS.EVENT_A}/viewer`, { cookies: owner });
  assert.equal(priv.status, 200);
  assert.match(priv.headers.get('cache-control') ?? '', /private, no-store/);
  const json = JSON.parse(priv.text);
  assert.equal(json.canEdit, true);
  assert.equal(json.canCheckFollowUps, true);
});
