// @ts-check
/**
 * Plan 2b Task 8: the owner's approval switch, waiting list and review.
 * The switch holds new adds; approving publishes and purges; rejecting
 * hides the entry publicly while its submitter still sees "not accepted".
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { IDS } from '../helpers/fixtures.js';
import { ingestDeps, count } from '../helpers/ingest.js';
import { apiFor } from '../helpers/api.js';
import { signInUser } from '../../src/services/session.js';
import { LIMITS, limit } from '../../src/services/limits.js';
import { RateLimited } from '../../src/http/errors.js';

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

before(async () => {
  deps = await ingestDeps();
  api = apiFor({ ...deps, env: { VERCEL: '1' }, invalidateByTag: async () => {}, log: () => {} }, { env: { VERCEL: '1' } });
  owner = await sidFor({ via: 'x', subject: deps.site.ownerXUserId, handle: 'the_owner' });
  member = await sidFor({ via: 'x', subject: '8888001', handle: 'adding_fan' });
});
after(async () => { await deps.db.end(); });

/** @param {string} path @param {string} sid @param {unknown} [body] */
function post(path, sid, body) {
  return api.call('POST', path, { cookies: { sid }, body });
}

/** @param {string} path @param {string} sid */
function get(path, sid) {
  return api.call('GET', path, { cookies: { sid } });
}

test('a member and a signed-out visitor are refused on every owner route', async () => {
  assert.equal((await api.call('GET', '/api/owner')).status, 401);
  assert.equal((await get('/api/owner', member)).status, 403);
  assert.deepEqual(JSON.parse((await get('/api/owner', member)).text), { error: 'forbidden' });
  assert.equal((await post('/api/owner/approval', member, { required: true })).status, 403);
  assert.equal((await post('/api/owner/items/translation/1/review', member, { state: 'published' })).status, 403);
});

test('the switch round-trips through settings and the audit log', async () => {
  const on = await post('/api/owner/approval', owner, { required: true });
  assert.equal(on.status, 200, on.text);
  assert.deepEqual(JSON.parse(on.text), { approvalRequired: true });
  const view = JSON.parse((await get('/api/owner', owner)).text);
  assert.equal(view.approvalRequired, true);
  assert.equal(view.signInFailedAt, null);
  const audits = await count(deps.db, "select count(*)::int as n from audit_log where table_name = 'settings'");
  assert.ok(audits >= 2, 'the insert and the toggle are audited');
});

test('with approval on, a new add waits; approving publishes it and empties the list', async () => {
  const added = await post('/api/add', member, { url: `https://x.com/i/status/${IDS.EVENT_A}` });
  assert.equal(added.status, 200, added.text);
  assert.equal(JSON.parse(added.text).status, 'pending');
  await api.settle();

  assert.equal((await api.call('GET', `/api/item/translation/${IDS.EVENT_A}`)).status, 404, 'not public yet');
  const view = JSON.parse((await get('/api/owner', owner)).text);
  assert.ok(view.waiting.some((item) => item.kind === 'translation' && item.sourceId === IDS.EVENT_A));

  const ok = await post(`/api/owner/items/translation/${IDS.EVENT_A}/review`, owner, { state: 'published' });
  assert.equal(ok.status, 200, ok.text);
  await api.settle();
  assert.equal((await api.call('GET', `/api/item/translation/${IDS.EVENT_A}`)).status, 200);
  const empty = JSON.parse((await get('/api/owner', owner)).text);
  assert.ok(!empty.waiting.some((item) => item.sourceId === IDS.EVENT_A));
});

test('rejecting hides the entry publicly but keeps it in the submitter\'s list', async () => {
  const added = await post('/api/add', member, { url: `https://x.com/i/status/${IDS.POST}` });
  assert.equal(JSON.parse(added.text).status, 'pending');
  await api.settle();
  assert.equal((await post(`/api/owner/items/translation/${IDS.POST}/review`, owner, { state: 'rejected' })).status, 200);
  assert.equal((await api.call('GET', `/api/item/translation/${IDS.POST}`)).status, 404);
  const mine = JSON.parse((await get('/api/me/added', member)).text);
  assert.equal(mine.items.find((item) => item.sourceId === IDS.POST).reviewState, 'rejected');
});

test('an unknown state or kind is refused', async () => {
  assert.equal((await post(`/api/owner/items/translation/${IDS.EVENT_A}/review`, owner, { state: 'sure' })).status, 400);
  assert.equal((await post('/api/owner/items/nope/123/review', owner, { state: 'published' })).status, 400);
});

test('the owner write limit is 300 an hour', async () => {
  const quiet = { db: deps.db, env: {}, now: () => new Date(), random: () => 1 };
  for (let i = 0; i < 300; i++) await limit(quiet, 'owner', 'x:limit-test');
  await assert.rejects(limit(quiet, 'owner', 'x:limit-test'), RateLimited);
  assert.equal(LIMITS.owner.limit, 300);
});

// --- Task 9: the reports queue ---------------------------------------------

/** @param {string} reason @returns {Promise<number>} the report id */
async function reportItem(reason) {
  const res = await api.call('POST', '/api/reports', {
    body: { target: { type: 'item', kind: 'translation', sourceId: IDS.EVENT_A }, reason },
    headers: { 'x-forwarded-for': `203.0.113.${200 + reason.length}` },
  });
  assert.equal(res.status, 200, res.text);
  return JSON.parse(res.text).id;
}

test('the owner sees open reports and can hide, restore and dismiss through the API', async () => {
  const id = await reportItem('owner queue route check');
  const queue = JSON.parse((await get('/api/owner', owner)).text);
  assert.ok(queue.reports.some((report) => report.id === id && report.reason === 'owner queue route check'));

  assert.equal((await post(`/api/owner/reports/${id}/hide`, owner)).status, 200);
  assert.equal((await api.call('GET', `/api/item/translation/${IDS.EVENT_A}`)).status, 404);
  const hidden = JSON.parse((await get('/api/owner', owner)).text).reports.find((report) => report.id === id);
  assert.equal(hidden.target.hidden, true);

  assert.equal((await post(`/api/owner/reports/${id}/restore`, owner)).status, 200);
  assert.equal((await api.call('GET', `/api/item/translation/${IDS.EVENT_A}`)).status, 200);

  assert.equal((await post(`/api/owner/reports/${id}/dismiss`, owner)).status, 200);
  assert.ok(!JSON.parse((await get('/api/owner', owner)).text).reports.some((report) => report.id === id));
});

test('a member cannot hide, restore or dismiss; an unknown report is 404', async () => {
  const id = await reportItem('member may not act');
  for (const action of ['hide', 'restore', 'dismiss']) {
    assert.equal((await post(`/api/owner/reports/${id}/${action}`, member)).status, 403);
  }
  assert.equal((await post('/api/owner/reports/999999/dismiss', owner)).status, 404);
});
