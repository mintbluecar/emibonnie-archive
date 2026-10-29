// @ts-check
/** Plan 3 Task 6: the owner import API and the dev seed. */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { IDS } from '../helpers/fixtures.js';
import { ingestDeps } from '../helpers/ingest.js';
import { apiFor } from '../helpers/api.js';
import { signInUser } from '../../src/services/session.js';

/** @type {Awaited<ReturnType<typeof ingestDeps>>} */
let deps;
/** @type {ReturnType<typeof apiFor>} */
let api;
/** @type {{ sid: string }} */
let owner;
/** @type {{ sid: string }} */
let member;
/** @type {number} */
let jobId;

/** @param {string} subject @param {string} handle */
async function sidFor(subject, handle) {
  const { cookie } = await signInUser(deps, { via: 'x', subject, handle });
  return { sid: cookie.replace(/^sid=/, '').split(';')[0] };
}

before(async () => {
  deps = await ingestDeps();
  api = apiFor({ ...deps, env: { DEV_SIGN_IN: '1' } }, { env: { DEV_SIGN_IN: '1' } });
  owner = await sidFor(deps.site.ownerXUserId, 'the_owner');
  member = await sidFor('660001', 'a_member');
  const seeded = await api.call('POST', '/api/dev/import', {
    cookies: owner,
    body: { urls: [`https://x.com/a/status/${IDS.LONG}`, `https://x.com/a/status/${IDS.EVENT_A}`] },
  });
  assert.equal(seeded.status, 200, seeded.text);
  jobId = JSON.parse(seeded.text).jobId;
  assert.ok(jobId);
});
after(async () => { await deps.db.end(); });

test('a member and a visitor are refused on every import route', async () => {
  assert.equal((await api.call('GET', '/api/owner/imports')).status, 401);
  assert.equal((await api.call('GET', '/api/owner/imports', { cookies: member })).status, 403);
  assert.equal((await api.call('GET', `/api/owner/imports/${jobId}`, { cookies: member })).status, 403);
  assert.equal((await api.call('GET', `/api/owner/imports/${jobId}/rows`, { cookies: member })).status, 403);
});

test('the owner reads a job and a filtered rows page', async () => {
  const job = await api.call('GET', `/api/owner/imports/${jobId}`, { cookies: owner });
  assert.equal(job.status, 200, job.text);
  const view = JSON.parse(job.text);
  assert.equal(view.counts.queued, 0);
  assert.ok(Object.values(view.counts).some((count) => count > 0));
  assert.ok(Array.isArray(view.markers));

  const rows = await api.call('GET', `/api/owner/imports/${jobId}/rows?state=needs_speakers`, { cookies: owner });
  assert.equal(rows.status, 200, rows.text);
  assert.ok(JSON.parse(rows.text).rows.every((row) => row.state === 'needs_speakers'));

  const list = await api.call('GET', '/api/owner/imports', { cookies: owner });
  assert.ok(JSON.parse(list.text).jobs.some((job_) => job_.id === jobId));
});

test('mapping is owner-only and refuses a bad speaker', async () => {
  const view = JSON.parse((await api.call('GET', `/api/owner/imports/${jobId}`, { cookies: owner })).text);
  const group = view.markers[0];
  assert.ok(group, 'a marker to map');
  const body = { accountId: group.accountId, marker: group.markers[0].marker, speaker: { role: 'fan' }, remember: false };
  assert.equal((await api.call('POST', `/api/owner/imports/${jobId}/map`, { cookies: member, body })).status, 403);
  assert.equal((await api.call('POST', `/api/owner/imports/${jobId}/map`, { body })).status, 401);
  const bad = await api.call('POST', `/api/owner/imports/${jobId}/map`, { cookies: owner, body: { ...body, speaker: {} } });
  assert.equal(bad.status, 400, bad.text);
  const ok = await api.call('POST', `/api/owner/imports/${jobId}/map`, { cookies: owner, body });
  assert.equal(ok.status, 200, ok.text);
  assert.ok(JSON.parse(ok.text).updated >= 1);
});

test('an unknown job is 404', async () => {
  assert.equal((await api.call('GET', '/api/owner/imports/999999', { cookies: owner })).status, 404);
  assert.equal((await api.call('GET', '/api/owner/imports/999999/rows', { cookies: owner })).status, 404);
});

test('the dev seed is a 404 without DEV_SIGN_IN', async () => {
  const off = apiFor(deps, { env: {} });
  const res = await off.call('POST', '/api/dev/import', { cookies: owner, body: { urls: [`https://x.com/a/status/${IDS.POST}`] } });
  assert.equal(res.status, 404);
});
