// @ts-check
/**
 * Plan 2b Task 7: the public report form's API. Unknown or hidden targets
 * are 404 (no probing), a long reason is 400, signed-out reports are
 * rate-limited by hashed IP, and a foreign Origin is refused by the
 * handler. Reports land in the owner's queue (Task 9).
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { seededDeps, count, SYSTEM } from '../helpers/ingest.js';
import { apiFor } from '../helpers/api.js';
import { signInUser } from '../../src/services/session.js';

/** @type {Awaited<ReturnType<typeof seededDeps>>} */
let deps;
/** @type {ReturnType<typeof apiFor>} */
let api;
/** @type {{ kind: string, sourceId: string, slug: string }} */
let sample;
let ipSeq = 0;

/** A distinct client IP per call, so the per-IP report limit never leaks between tests. */
function freshIp() {
  ipSeq += 1;
  return { 'x-forwarded-for': `203.0.113.${ipSeq}` };
}

before(async () => {
  deps = await seededDeps();
  api = apiFor(deps);
  const { rows: found } = await deps.db.query(
    `select i.kind, s.external_id as source_id, e.slug
     from items i
     join item_sources s on s.item_id = i.id and s.role = 'primary'
     join events e on e.id = i.event_id
     where i.deleted_at is null and i.review_state = 'published'
     order by i.id limit 1`,
  );
  sample = { kind: found[0].kind, sourceId: found[0].source_id, slug: found[0].slug };
});
after(async () => { await deps.db.end(); });

/** @param {unknown} body @param {{ headers?: Record<string,string>, origin?: string|null, cookies?: Record<string,string> }} [init] */
function report(body, init = {}) {
  return api.call('POST', '/api/reports', { body, headers: freshIp(), ...init });
}

test('a signed-out report on a visible item is stored by the engine, not a person', async () => {
  const res = await report({ target: { type: 'item', kind: sample.kind, sourceId: sample.sourceId }, reason: '  wrong credit  ' });
  assert.equal(res.status, 200, res.text);
  const { id } = JSON.parse(res.text);
  const { rows: stored } = await deps.db.query('select target_table, target_id, reason, created_by, status from reports where id = $1', [id]);
  assert.equal(stored[0].target_table, 'items');
  assert.equal(stored[0].reason, 'wrong credit');
  assert.equal(stored[0].created_by, 'system', 'the trigger records the engine actor, never a person');
  assert.equal(stored[0].status, 'open');
});

test('an event report is stored against the event', async () => {
  const res = await report({ target: { type: 'event', slug: sample.slug }, reason: 'wrong event date' });
  assert.equal(res.status, 200, res.text);
  const { id } = JSON.parse(res.text);
  const { rows: stored } = await deps.db.query('select target_table from reports where id = $1', [id]);
  assert.equal(stored[0].target_table, 'events');
});

test('a hidden or unknown target is 404 and writes nothing', async () => {
  const before = await count(deps.db, 'select count(*)::int as n from reports');
  const missing = await report({ target: { type: 'item', kind: sample.kind, sourceId: '999999999' }, reason: 'why' });
  assert.equal(missing.status, 404);
  const noEvent = await report({ target: { type: 'event', slug: 'no-such-event' }, reason: 'why' });
  assert.equal(noEvent.status, 404);

  const { rows: item } = await deps.db.query(
    "select item_id from item_sources where role = 'primary' and external_id = $1", [sample.sourceId],
  );
  await deps.db.transaction((tx) => tx.query("update items set deleted_at = now(), deleted_reason = 'hidden_by_owner' where id = $1", [item[0].item_id]), SYSTEM);
  const hidden = await report({ target: { type: 'item', kind: sample.kind, sourceId: sample.sourceId }, reason: 'why' });
  assert.equal(hidden.status, 404);
  await deps.db.transaction((tx) => tx.query('update items set deleted_at = null, deleted_reason = null where id = $1', [item[0].item_id]), SYSTEM);
  assert.equal(await count(deps.db, 'select count(*)::int as n from reports'), before);
});

test('a 2001-character reason is 400 and 2000 is accepted', async () => {
  const long = await report({ target: { type: 'event', slug: sample.slug }, reason: 'x'.repeat(2001) });
  assert.equal(long.status, 400);
  const edge = await report({ target: { type: 'event', slug: sample.slug }, reason: 'x'.repeat(2000) });
  assert.equal(edge.status, 200, edge.text);
  const empty = await report({ target: { type: 'event', slug: sample.slug }, reason: '   ' });
  assert.equal(empty.status, 400);
});

test('the 6th report in an hour from one ip is 429', async () => {
  const headers = { 'x-forwarded-for': '198.51.100.9' };
  let status = 0;
  for (let i = 0; i < 6; i++) {
    status = (await api.call('POST', '/api/reports', { body: { target: { type: 'event', slug: sample.slug }, reason: 'spam' }, headers })).status;
  }
  assert.equal(status, 429);
});

test('a foreign origin is 403 and writes nothing', async () => {
  const before = await count(deps.db, 'select count(*)::int as n from reports');
  const res = await report({ target: { type: 'event', slug: sample.slug }, reason: 'why' }, { origin: 'https://evil.example' });
  assert.equal(res.status, 403);
  assert.equal(await count(deps.db, 'select count(*)::int as n from reports'), before);
});

test('a signed-in reporter\'s user id is recorded', async () => {
  const { cookie } = await signInUser(deps, { via: 'x', subject: '7171', handle: 'reporter' });
  const sid = cookie.replace(/^sid=/, '').split(';')[0];
  const res = await report({ target: { type: 'event', slug: sample.slug }, reason: 'why' }, { cookies: { sid } });
  assert.equal(res.status, 200, res.text);
  const { rows: stored } = await deps.db.query('select created_by from reports where id = $1', [JSON.parse(res.text).id]);
  assert.equal(stored[0].created_by, 'x:7171');
});

test('a bad target shape is a BadRequest', async () => {
  const res = await report({ target: { type: 'person', id: 1 }, reason: 'why' });
  assert.equal(res.status, 400);
});
