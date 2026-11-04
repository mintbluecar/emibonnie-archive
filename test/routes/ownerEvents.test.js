// @ts-check
/**
 * Task 7: the owner's event admin API -- the event list, one event with
 * its edit-form options, its entries (each with a snippet, Ruling
 * R6/R6a), and the four writes (edit, merge, move, split). Owner-only: a
 * member is 403, a signed-out visitor 401; a write needs the right
 * Origin; an unknown or merged event id is 404 (Ruling R2 covers a
 * non-numeric one too); a malformed body is 400.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { IDS } from '../helpers/fixtures.js';
import { ingestDeps, ingest, itemIdOf } from '../helpers/ingest.js';
import { insertItem } from '../helpers/seed.js';
import { apiFor } from '../helpers/api.js';
import { signInUser } from '../../src/services/session.js';
import { createEvent } from '../../src/repo/events.js';

/** @type {Awaited<ReturnType<typeof ingestDeps>>} */
let deps;
/** @type {ReturnType<typeof apiFor>} */
let api;
/** @type {string} */
let owner;
/** @type {string} */
let member;

/** @param {{ via: 'x'|'google', subject: string, handle: string|null }} input @returns {Promise<string>} the sid */
async function sidFor(input) {
  const { cookie } = await signInUser(deps, input);
  return cookie.replace(/^sid=/, '').split(';')[0];
}

/** @param {(tx: any) => Promise<any>} fn */
const inTx = (fn) => deps.db.transaction(fn, { actor: 'system' });

/** @param {string} slug @param {Partial<any>} [fields] @returns {Promise<number>} */
const makeEvent = async (slug, fields = {}) => (await inTx((tx) => createEvent(tx, {
  name: 'Event', slug, addressTag: 'event', occurredOn: slug.slice(0, 10),
  keywords: [], hashtags: [], livePeopleIds: [], livePlatformCode: null, ...fields,
}))).id;

/** @param {number} eventId @param {{ reviewState?: string }} [options] @returns {Promise<number>} */
const makeItem = (eventId, options = {}) => inTx((tx) => insertItem(tx, { placement: 'event', eventId, ...options }));

/** @typedef {import('../../src/services/eventFields.js').EventFields} EventFields */
/** @param {Partial<EventFields>} [overrides] @returns {EventFields} */
const fieldsOf = (overrides = {}) => ({
  name: 'An event', occurredOn: '2041-01-01', keywords: [], hashtags: [],
  livePeopleIds: [], livePlatformCode: null, addressTag: 'tag', ...overrides,
});

before(async () => {
  deps = await ingestDeps();
  api = apiFor(deps, { env: { VERCEL: '1' } });
  owner = await sidFor({ via: 'x', subject: deps.site.ownerXUserId, handle: 'the_owner' });
  member = await sidFor({ via: 'x', subject: '991001', handle: 'a_member' });
});
after(async () => { await deps.db.end(); });

/** @param {string} path @param {string} sid @param {unknown} [body] */
const post = (path, sid, body) => api.call('POST', path, { cookies: { sid }, body });
/** @param {string} path @param {string} sid */
const get = (path, sid) => api.call('GET', path, { cookies: { sid } });

test('a member and a signed-out visitor are refused on every event route', async () => {
  const paths = /** @type {const} */ ([
    ['GET', '/api/owner/events'], ['GET', '/api/owner/events/1'], ['GET', '/api/owner/events/1/entries'],
    ['POST', '/api/owner/events/1'], ['POST', '/api/owner/events/merge'], ['POST', '/api/owner/events/1/move'], ['POST', '/api/owner/events/1/split'],
  ]);
  for (const [method, path] of paths) {
    assert.equal((await api.call(method, path)).status, 401, `${method} ${path}`);
    assert.equal((await api.call(method, path, { cookies: { sid: member } })).status, 403, `${method} ${path}`);
  }
});

test('a write without the right Origin is refused', async () => {
  const id = await makeEvent('2041-02-01/origin');
  const res = await api.call('POST', `/api/owner/events/${id}`, { cookies: { sid: owner }, origin: 'https://evil.example', body: fieldsOf() });
  assert.equal(res.status, 403);
});

test('the list page answers events and total, newest occurredOn first', async () => {
  const a = await makeEvent('2041-03-01/a', { name: 'Alpha event' });
  const b = await makeEvent('2041-03-02/b', { name: 'Beta event' });
  const res = await get('/api/owner/events', owner);
  assert.equal(res.status, 200, res.text);
  const view = JSON.parse(res.text);
  assert.ok(Array.isArray(view.events));
  assert.equal(typeof view.total, 'number');
  const ids = view.events.map((/** @type {any} */ e) => e.id);
  assert.ok(ids.indexOf(b) < ids.indexOf(a), 'newest occurredOn first');

  const filtered = JSON.parse((await get('/api/owner/events?q=Beta', owner)).text);
  assert.ok(filtered.events.length > 0 && filtered.events.every((/** @type {any} */ e) => e.id === b));
});

test('an out-of-range or non-numeric offset is 400', async () => {
  assert.equal((await get('/api/owner/events?offset=-1', owner)).status, 400);
  assert.equal((await get('/api/owner/events?offset=abc', owner)).status, 400);
});

test('one event answers its fields plus people and platform options; an unknown or non-numeric id is 404', async () => {
  const id = await makeEvent('2041-04-01/detail', { name: 'Detail event' });
  const res = await get(`/api/owner/events/${id}`, owner);
  assert.equal(res.status, 200, res.text);
  const view = JSON.parse(res.text);
  assert.equal(view.id, id);
  assert.equal(view.name, 'Detail event');
  assert.ok(Array.isArray(view.options.people));
  assert.ok(Array.isArray(view.options.platforms));
  assert.deepEqual(view.options.platforms.find((/** @type {any} */ p) => p.code === 'x'), { code: 'x', name: 'x' });

  assert.equal((await get('/api/owner/events/999999', owner)).status, 404);
  assert.equal((await get('/api/owner/events/not-a-number', owner)).status, 404);
});

test('a merged event is 404 on its own detail route', async () => {
  const keep = await makeEvent('2041-05-01/keep');
  const gone = await makeEvent('2041-05-01/gone');
  const mergeRes = await post('/api/owner/events/merge', owner, {
    keepId: keep, mergeIds: [gone], fields: fieldsOf({ occurredOn: '2041-05-01', addressTag: 'keep' }),
  });
  assert.equal(mergeRes.status, 200, mergeRes.text);
  assert.equal((await get(`/api/owner/events/${gone}`, owner)).status, 404);
});

test('entries carry a snippet: a real preview is cut to 120 characters, a bare item is blank', async () => {
  const event = await makeEvent('2041-06-01/entries');
  const bare = await makeItem(event);
  const added = await ingest(deps, IDS.POST, { actor: 'system' });
  assert.equal(added.status, 'added', 'the fixture ingests cleanly');
  const realId = await itemIdOf(deps.db, IDS.POST);
  await inTx((tx) => tx.query("update items set placement = 'event', event_id = $1 where id = $2", [event, realId]));

  const res = await get(`/api/owner/events/${event}/entries`, owner);
  assert.equal(res.status, 200, res.text);
  const view = JSON.parse(res.text);
  assert.equal(view.event.id, event);
  const bareEntry = view.entries.find((/** @type {any} */ e) => e.itemId === bare);
  assert.equal(bareEntry.snippet, '');
  const realEntry = view.entries.find((/** @type {any} */ e) => e.itemId === realId);
  assert.ok(realEntry.snippet.length > 0 && realEntry.snippet.length <= 120, realEntry.snippet);

  assert.equal((await get('/api/owner/events/999999/entries', owner)).status, 404);
});

test('a merged event is 404 on its entries route too', async () => {
  const keep = await makeEvent('2041-06-02/keep');
  const gone = await makeEvent('2041-06-02/gone');
  await makeItem(gone);
  const mergeRes = await post('/api/owner/events/merge', owner, {
    keepId: keep, mergeIds: [gone], fields: fieldsOf({ occurredOn: '2041-06-02', addressTag: 'keep' }),
  });
  assert.equal(mergeRes.status, 200, mergeRes.text);
  assert.equal((await get(`/api/owner/events/${gone}/entries`, owner)).status, 404);
  assert.equal((await get(`/api/owner/events/${keep}/entries`, owner)).status, 200);
});

test('move and split: an unknown path id is 404, a merged one 409; an unknown id in the body stays 400', async () => {
  const from = await makeEvent('2041-12-01/from');
  const item = await makeItem(from);
  const split = { itemIds: [item], fields: fieldsOf({ occurredOn: '2041-12-02', addressTag: 'split' }) };
  assert.equal((await post('/api/owner/events/999999/move', owner, { itemIds: [item], toEventId: from })).status, 404);
  assert.equal((await post('/api/owner/events/999999/split', owner, split)).status, 404);
  assert.equal((await post(`/api/owner/events/${from}/move`, owner, { itemIds: [item], toEventId: 999999 })).status, 400);

  const keep = await makeEvent('2041-12-01/keep');
  const gone = await makeEvent('2041-12-01/gone');
  const goneItem = await makeItem(gone);
  assert.equal((await post('/api/owner/events/merge', owner, {
    keepId: keep, mergeIds: [gone], fields: fieldsOf({ occurredOn: '2041-12-01', addressTag: 'keep' }),
  })).status, 200);
  const moveRes = await post(`/api/owner/events/${gone}/move`, owner, { itemIds: [goneItem], toEventId: from });
  assert.equal(moveRes.status, 409, moveRes.text);
  assert.match(moveRes.text, /merged/);
  const splitRes = await post(`/api/owner/events/${gone}/split`, owner, { ...split, itemIds: [goneItem] });
  assert.equal(splitRes.status, 409, splitRes.text);
  assert.match(splitRes.text, /merged/);
});

test('editing an event saves its fields and answers the new slug', async () => {
  const id = await makeEvent('2041-07-01/old', { name: 'Old name' });
  const res = await post(`/api/owner/events/${id}`, owner, fieldsOf({ name: 'New name', occurredOn: '2041-07-02', hashtags: ['#New'], addressTag: '' }));
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(JSON.parse(res.text), { slug: '2041-07-02/new' });
});

test('merging moves entries and answers the kept slug and moved count', async () => {
  const keep = await makeEvent('2041-08-01/keep');
  const gone = await makeEvent('2041-08-01/gone');
  await makeItem(gone);
  const res = await post('/api/owner/events/merge', owner, {
    keepId: keep, mergeIds: [gone], fields: fieldsOf({ occurredOn: '2041-08-01', addressTag: 'merged' }),
  });
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(JSON.parse(res.text), { slug: '2041-08-01/merged', moved: 1 });
});

test('moving entries answers how many moved', async () => {
  const from = await makeEvent('2041-09-01/from');
  const to = await makeEvent('2041-09-01/to');
  const item = await makeItem(from);
  const res = await post(`/api/owner/events/${from}/move`, owner, { itemIds: [item], toEventId: to });
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(JSON.parse(res.text), { moved: 1 });
});

test('splitting creates an event and moves entries into it', async () => {
  const from = await makeEvent('2041-10-01/from');
  const item = await makeItem(from);
  const res = await post(`/api/owner/events/${from}/split`, owner, {
    itemIds: [item], fields: fieldsOf({ name: 'Split out', occurredOn: '2041-10-02', addressTag: 'split' }),
  });
  assert.equal(res.status, 200, res.text);
  const body = JSON.parse(res.text);
  assert.equal(body.slug, '2041-10-02/split');
  assert.equal(body.moved, 1);
  assert.ok(Number.isInteger(body.eventId) && body.eventId !== from);
});

test('malformed bodies are 400, never 500', async () => {
  const keep = await makeEvent('2041-11-01/keep');
  const other = await makeEvent('2041-11-01/other');
  assert.equal((await post('/api/owner/events/merge', owner, { keepId: keep, mergeIds: 'x', fields: fieldsOf() })).status, 400);
  assert.equal((await post(`/api/owner/events/${keep}/move`, owner, { itemIds: ['a', 'b'], toEventId: other })).status, 400);
  assert.equal((await post(`/api/owner/events/${keep}/split`, owner, { itemIds: [] })).status, 400, 'fields missing entirely');
  assert.equal((await post(`/api/owner/events/${keep}`, owner, {})).status, 400, 'the body (the fields) is blank');
  assert.equal((await post(`/api/owner/events/${keep}`, owner, { name: 'x', occurredOn: 'not-a-date' })).status, 400);
});
