// @ts-check
/**
 * Plan 3 Task 3: the owner resolves held (pending) entries privately on the
 * entry and edit pages; everyone else gets the same 404 as a missing item,
 * and a held entry's link-preview meta stays generic.
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
/** @type {{ sourceId: string, eventName: string }} */
let sample;

/** @param {string} subject @param {string} handle */
async function sidFor(subject, handle) {
  const { cookie } = await signInUser(deps, { via: 'x', subject, handle });
  return cookie.replace(/^sid=/, '').split(';')[0];
}

before(async () => {
  deps = await seededDeps();
  api = apiFor(deps);
  const { rows } = await deps.db.query(
    `select s.external_id as source_id, ev.name as event_name, i.id
     from items i
     join item_sources s on s.item_id = i.id and s.role = 'primary'
     join events ev on ev.id = i.event_id
     where i.deleted_at is null and i.review_state = 'published'
     order by i.id limit 1`,
  );
  sample = { sourceId: rows[0].source_id, eventName: rows[0].event_name };
  await deps.db.transaction(
    (tx) => tx.query("update items set review_state = 'pending' where id = $1", [rows[0].id]),
    { actor: 'system' },
  );
});

after(async () => { await deps.db.end(); });

test('the owner sees a held item page privately; a member and a visitor get 404', async () => {
  const owner = await sidFor(deps.site.ownerXUserId, 'the_owner');
  const member = await sidFor('555001', 'a_member');

  const asOwner = await api.call('GET', `/api/item/translation/${sample.sourceId}`, { cookies: { sid: owner } });
  assert.equal(asOwner.status, 200, asOwner.text);
  const view = JSON.parse(asOwner.text);
  assert.equal(view.reviewState, 'pending');
  assert.match(asOwner.headers.get('cache-control') ?? '', /private/);

  assert.equal((await api.call('GET', `/api/item/translation/${sample.sourceId}`, { cookies: { sid: member } })).status, 404);
  assert.equal((await api.call('GET', `/api/item/translation/${sample.sourceId}`)).status, 404);
});

test('the owner edits a held entry; a member gets 404', async () => {
  const owner = await sidFor(deps.site.ownerXUserId, 'the_owner');
  const member = await sidFor('555002', 'another_member');
  const asOwner = await api.call('GET', `/api/item/translation/${sample.sourceId}/edit`, { cookies: { sid: owner } });
  assert.equal(asOwner.status, 200, asOwner.text);
  assert.equal(JSON.parse(asOwner.text).role, 'owner');
  assert.equal((await api.call('GET', `/api/item/translation/${sample.sourceId}/edit`, { cookies: { sid: member } })).status, 404);
});

test('a held entry\'s meta page stays generic; publishing makes it everyone\'s', async () => {
  const held = await api.call('GET', `/t/${sample.sourceId}`);
  assert.equal(held.status, 200);
  assert.ok(!held.text.includes(sample.eventName), 'the held entry is not named in the preview');

  const owner = await sidFor(deps.site.ownerXUserId, 'the_owner');
  const published = await api.call('POST', `/api/owner/items/translation/${sample.sourceId}/review`, {
    cookies: { sid: owner }, body: { state: 'published' },
  });
  assert.equal(published.status, 200, published.text);
  await api.settle();

  assert.equal((await api.call('GET', `/api/item/translation/${sample.sourceId}`)).status, 200);
  const meta = await api.call('GET', `/t/${sample.sourceId}`);
  assert.ok(meta.text.includes(sample.eventName), 'the preview names the event once it is public');
});
