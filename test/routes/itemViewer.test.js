// @ts-check
/**
 * Task 13: `/api/item/:kind/:sourceId` is one cacheable public answer for
 * everyone, signed in or not; the caller's own fields (`canEdit`,
 * `canCheckFollowUps`, `editOpenUntil`, and the owner's view of a held
 * entry) come from the private `…/viewer`.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { IDS } from '../helpers/fixtures.js';
import { seededDeps, itemIdOf, SYSTEM } from '../helpers/ingest.js';
import { apiFor } from '../helpers/api.js';
import { signInUser } from '../../src/services/session.js';
import { NOT_FOUND_CACHE, PRIVATE_NO_STORE, PUBLIC_CACHE } from '../../src/http/handler.js';

/** @type {any} */
let deps;
/** @type {ReturnType<typeof apiFor>} */
let api;
before(async () => { deps = await seededDeps(); api = apiFor(deps); });
after(async () => { await deps.db.end(); });

/** @param {string} subject @param {string} handle */
async function sidFor(subject, handle) {
  const { cookie } = await signInUser(deps, { via: 'x', subject, handle });
  return { sid: cookie.replace(/^sid=/, '').split(';')[0] };
}

const itemPath = (/** @type {string} */ id) => `/api/item/translation/${id}`;

test('a signed-in reader gets the same cacheable answer as a visitor', async () => {
  const owner = await sidFor(deps.site.ownerXUserId, 'the_owner');
  const visitor = await api.call('GET', itemPath(IDS.LONG));
  const signedIn = await api.call('GET', itemPath(IDS.LONG), { cookies: owner });
  assert.equal(visitor.status, 200);
  assert.equal(signedIn.status, 200);
  assert.equal(signedIn.headers.get('cache-control'), PUBLIC_CACHE);
  assert.equal(signedIn.headers.get('cache-control'), visitor.headers.get('cache-control'));
  assert.ok(signedIn.headers.get('vercel-cache-tag'), 'tagged, so a write can purge it');
  assert.equal(signedIn.headers.get('vercel-cache-tag'), visitor.headers.get('vercel-cache-tag'));
  assert.equal(signedIn.text, visitor.text, 'the same body, with no per-user field');
  const body = JSON.parse(signedIn.text);
  assert.ok(!('canEdit' in body) && !('canCheckFollowUps' in body) && !('reviewState' in body));
});

test('viewer answers a member\'s edit fields privately', async () => {
  // The member is the entry's credited translator (their X account is credited).
  const id = await itemIdOf(deps.db, IDS.LONG);
  await deps.db.transaction((/** @type {any} */ tx) => tx.query(
    "update accounts set external_id = '555101' where id = (select credited_account_id from items where id = $1)", [id],
  ), SYSTEM);
  const member = await sidFor('555101', 'a_translator');
  const stranger = await sidFor('555102', 'a_stranger');
  const publicView = JSON.parse((await api.call('GET', itemPath(IDS.LONG))).text);

  const mine = await api.call('GET', `${itemPath(IDS.LONG)}/viewer`, { cookies: member });
  assert.equal(mine.status, 200, mine.text);
  assert.equal(mine.headers.get('cache-control'), PRIVATE_NO_STORE);
  assert.equal(mine.headers.get('vercel-cache-tag'), null);
  assert.deepEqual(JSON.parse(mine.text), {
    canEdit: true, canCheckFollowUps: true, editOpenUntil: publicView.editOpenUntil, held: null,
  });

  const theirs = JSON.parse((await api.call('GET', `${itemPath(IDS.LONG)}/viewer`, { cookies: stranger })).text);
  assert.deepEqual(theirs, { canEdit: false, canCheckFollowUps: false, editOpenUntil: publicView.editOpenUntil, held: null });
});

test('viewer refuses a visitor', async () => {
  const res = await api.call('GET', `${itemPath(IDS.LONG)}/viewer`);
  assert.equal(res.status, 401);
  assert.match(res.headers.get('cache-control') ?? '', /no-store/);
});

test('the owner gets a held entry through viewer.held; a member gets null', async () => {
  const owner = await sidFor(deps.site.ownerXUserId, 'the_owner');
  const member = await sidFor('555103', 'a_member');
  const id = await itemIdOf(deps.db, IDS.EVENT_A);
  await deps.db.transaction(
    (/** @type {any} */ tx) => tx.query("update items set review_state = 'pending' where id = $1", [id]), SYSTEM,
  );
  try {
    // The public answer is the same 404 for everyone, so it may be cached.
    for (const cookies of [undefined, owner, member]) {
      const res = await api.call('GET', itemPath(IDS.EVENT_A), { cookies });
      assert.equal(res.status, 404);
      assert.equal(res.headers.get('cache-control'), NOT_FOUND_CACHE);
    }

    const asOwner = await api.call('GET', `${itemPath(IDS.EVENT_A)}/viewer`, { cookies: owner });
    assert.equal(asOwner.status, 200, asOwner.text);
    assert.equal(asOwner.headers.get('cache-control'), PRIVATE_NO_STORE);
    const ownerView = JSON.parse(asOwner.text);
    assert.equal(ownerView.canEdit, true);
    assert.equal(ownerView.held.sourceId, IDS.EVENT_A);
    assert.equal(ownerView.held.reviewState, 'pending');
    assert.ok(Array.isArray(ownerView.held.bubbles), 'the full page view');
    assert.ok('editOpenUntil' in ownerView.held);

    // A member learns nothing about it until it is published.
    const asMember = JSON.parse((await api.call('GET', `${itemPath(IDS.EVENT_A)}/viewer`, { cookies: member })).text);
    assert.deepEqual(asMember, { canEdit: false, canCheckFollowUps: false, editOpenUntil: null, held: null });
  } finally {
    await deps.db.transaction((/** @type {any} */ tx) => tx.query("update items set review_state = 'published' where id = $1", [id]), SYSTEM);
  }
});

test('viewer of a missing item or an unknown kind answers like a hidden one', async () => {
  const owner = await sidFor(deps.site.ownerXUserId, 'the_owner');
  for (const path of ['/api/item/translation/1/viewer', `/api/item/no_such_kind/${IDS.LONG}/viewer`]) {
    const res = await api.call('GET', path, { cookies: owner });
    assert.equal(res.status, 200, path);
    assert.deepEqual(JSON.parse(res.text), { canEdit: false, canCheckFollowUps: false, editOpenUntil: null, held: null });
  }
});
