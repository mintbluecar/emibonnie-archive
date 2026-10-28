// @ts-check
/**
 * Plan 2b Task 2: every public page's response carries the tags a purge
 * names. Without these the CDN could keep serving removed content for the
 * whole stale-while-revalidate window.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { apiFor } from '../helpers/api.js';
import { seededDeps } from '../helpers/ingest.js';
import { signInUser } from '../../src/services/session.js';
import { HOME_TAG, SEARCH_TAG } from '../../src/domain/cacheTags.js';

/** @type {Awaited<ReturnType<typeof seededDeps>>} */
let deps;
/** @type {ReturnType<typeof apiFor>} */
let api;
/** The one visible item with an event, people and a translator. */
/** @type {{ id: number, sourceId: string, slug: string, accountHandle: string, personId: number, personIg: string }} */
let sample;

before(async () => {
  deps = await seededDeps();
  api = apiFor(deps);
  const { rows } = await deps.db.query(
    `select i.id, ps.external_id as source_id, ev.slug, a.handle as account_handle,
       ip.person_id, pa.handle as person_ig
     from items i
     join item_sources ps on ps.item_id = i.id and ps.role = 'primary'
     join events ev on ev.id = i.event_id
     join accounts a on a.id = i.credited_account_id
     join item_people ip on ip.item_id = i.id
     join accounts pa on pa.person_id = ip.person_id and pa.platform = 'instagram'
     where i.deleted_at is null and i.review_state = 'published'
     order by i.id limit 1`,
  );
  const row = rows[0];
  sample = {
    id: row.id, sourceId: row.source_id, slug: row.slug, accountHandle: row.account_handle,
    personId: row.person_id, personIg: row.person_ig,
  };
});

after(async () => { await deps.db.end(); });

/** @param {string} path */
async function tagOf(path) {
  const res = await api.call('GET', path);
  assert.equal(res.status, 200, `${path} answers 200`);
  return res.headers.get('vercel-cache-tag');
}

test('home and search carry their own coarse tags', async () => {
  assert.equal(await tagOf('/api/home'), HOME_TAG);
  assert.equal(await tagOf('/api/search?q=the'), SEARCH_TAG);
});

test('an event page is tagged by its slug', async () => {
  assert.equal(await tagOf(`/api/event/${sample.slug}`), `event:${sample.slug}`);
});

test('a person page is tagged by the person id', async () => {
  assert.equal(await tagOf(`/api/person/${sample.personIg}`), `person:${sample.personId}`);
});

test('a translator page is tagged by the account handle', async () => {
  assert.equal(await tagOf(`/api/account/${sample.accountHandle}`), `account:${sample.accountHandle.toLowerCase()}`);
});

test('an item page carries the item, its event, its people and its translator', async () => {
  const tags = (await tagOf(`/api/item/translation/${sample.sourceId}`))?.split(',') ?? [];
  for (const expected of [
    `item:${sample.id}`, `event:${sample.slug}`, `person:${sample.personId}`, `account:${sample.accountHandle.toLowerCase()}`,
  ]) {
    assert.ok(tags.includes(expected), `${expected} in ${tags.join(',')}`);
  }
});

test('the item and event meta pages carry the same tags', async () => {
  const meta = await api.call('GET', `/t/${sample.sourceId}`);
  assert.equal(meta.status, 200);
  assert.ok((meta.headers.get('vercel-cache-tag') ?? '').split(',').includes(`item:${sample.id}`));
  const event = await api.call('GET', `/e/${sample.slug}`);
  assert.ok((event.headers.get('vercel-cache-tag') ?? '').split(',').includes(`event:${sample.slug}`));
});

test('a signed-in item view is private and carries no cache tag', async () => {
  const { cookie } = await signInUser(deps, { via: 'x', subject: '999999', handle: 'dev_member' });
  const token = cookie.split(';')[0].split('=')[1];
  const res = await api.call('GET', `/api/item/translation/${sample.sourceId}`, { cookies: { sid: token } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('cache-control') ?? '', /private/);
  assert.equal(res.headers.get('vercel-cache-tag'), null);
});

test('a hidden target\'s meta page carries no tags', async () => {
  const res = await api.call('GET', '/t/does-not-exist');
  assert.equal(res.headers.get('vercel-cache-tag'), null);
});
