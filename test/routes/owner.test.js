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
import { routes } from '../../src/routes/index.js';

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
  // Chosen by path, not by `auth`, so a route that loses its owner check fails here.
  const ownerOnly = routes.filter((r) => r.path.startsWith('/api/owner'));
  assert.equal(ownerOnly.length, 18, 'every owner route (update when one is added)');
  for (const r of ownerOnly) assert.equal(r.auth, 'owner', `${r.method} ${r.path}`);
  assert.deepEqual(routes.filter((r) => r.auth === 'owner'), ownerOnly, 'no owner route outside /api/owner');
  for (const r of ownerOnly) {
    const path = r.path.replace(/:kind\b/, 'translation').replace(/:[A-Za-z]+/g, '1');
    const visitor = await api.call(r.method, path);
    assert.equal(visitor.status, 401, `${r.method} ${r.path}`);
    const refused = await api.call(r.method, path, { cookies: { sid: member } });
    assert.equal(refused.status, 403, `${r.method} ${r.path}`);
    assert.deepEqual(JSON.parse(refused.text), { error: 'forbidden' }, `${r.method} ${r.path}`);
  }
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

test('an unknown report is 404', async () => {
  assert.equal((await post('/api/owner/reports/999999/dismiss', owner)).status, 404);
});

// --- Task 10: users, blocking and the sign-in alert ------------------------

test('the owner searches users, blocks and unblocks one, and clears the alert', async () => {
  await post('/api/owner/approval', owner, { required: false });
  const fan = await sidFor({ via: 'x', subject: '8888009', handle: 'blockable_fan' });
  await post('/api/add', fan, { url: `https://x.com/i/status/${IDS.EVENT_B}` });
  await api.settle();

  const found = JSON.parse((await api.call('GET', '/api/owner/users?q=blockable_fan', { cookies: { sid: owner } })).text);
  assert.ok(found.users.some((user) => user.handle === 'blockable_fan'));

  const blocked = await post('/api/owner/users/block', owner, { userId: 'x:8888009' });
  assert.equal(blocked.status, 200, blocked.text);
  assert.equal((await api.call('GET', `/api/item/translation/${IDS.EVENT_B}`)).status, 404, 'their submission is hidden');
  assert.equal((await api.call('GET', '/api/me', { cookies: { sid: fan } })).status, 200);
  assert.equal((await post('/api/add', fan, { url: `https://x.com/i/status/${IDS.EVENT_B}` })).status, 403);

  assert.equal((await post('/api/owner/users/unblock', owner, { userId: 'x:8888009' })).status, 200);
  assert.equal((await api.call('GET', `/api/item/translation/${IDS.EVENT_B}`)).status, 200);

  await deps.db.transaction((tx) => tx.query("insert into settings (key, value) values ('xSignInFailedAt', '\"2026-10-28T00:00:00Z\"'::jsonb) on conflict (key) do update set value = excluded.value"), { actor: 'system' });
  assert.ok(JSON.parse((await get('/api/owner', owner)).text).signInFailedAt);
  assert.equal((await post('/api/owner/sign-in-alert/dismiss', owner)).status, 200);
  assert.equal(JSON.parse((await get('/api/owner', owner)).text).signInFailedAt, null);
});
