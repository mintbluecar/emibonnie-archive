// @ts-check
/**
 * Plan 3 Task 1: the import repo — jobs, rows, states and the held-item
 * queries the review page and the 2b waiting list need.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { freshDb } from '../helpers/db.js';
import { insertItem } from '../helpers/seed.js';
import {
  createJob, insertRows, getJob, setJobStatus, updateRow, getRow, rowsPage,
  countsByState, heldItemIds, rowsWithItems, importHeldItemIdSet, jobsRecent,
} from '../../src/repo/imports.js';

/** @type {Awaited<ReturnType<typeof freshDb>>} */
let db;
before(async () => { db = await freshDb(); });
after(async () => { await db.end(); });

const system = { actor: 'system' };

/** @param {string} [source] */
const jobOf = (source = 'notion') => db.transaction((tx) => createJob(tx, { source, actor: 'system' }), system);

test('createJob + insertRows dedupe by (job, platform, external id)', async () => {
  const jobId = await jobOf();
  const rows = [
    { platform: 'x', externalId: '1900000000000000001', overrides: { occurredOn: '2026-10-01' } },
    { platform: 'x', externalId: '1900000000000000002', overrides: {} },
  ];
  assert.equal(await db.transaction((tx) => insertRows(tx, jobId, rows), system), 2);
  assert.equal(await db.transaction((tx) => insertRows(tx, jobId, rows), system), 0, 'the second insert adds nothing');
  const job = await getJob(db, jobId);
  assert.equal(job?.source, 'notion');
  assert.equal(job?.status, 'queued');
});

test('row states move and countsByState reports zeros too', async () => {
  const jobId = await jobOf('paste');
  await db.transaction((tx) => insertRows(tx, jobId, [
    { platform: 'x', externalId: '11', overrides: {} },
    { platform: 'x', externalId: '12', overrides: {} },
  ]), system);
  const { rows } = await rowsPage(db, jobId, { offset: 0, limit: 10 });
  const first = rows[0];
  await db.transaction((tx) => updateRow(tx, first.id, { state: 'failed', error: 'fetch failed (429)' }), system);
  const counts = await countsByState(db, jobId);
  assert.equal(counts.failed, 1);
  assert.equal(counts.queued, 1);
  assert.equal(counts.published, 0);
  const row = await getRow(db, first.id);
  assert.equal(row?.error, 'fetch failed (429)');
  assert.equal(row?.jobId, jobId);
});

test('rowsPage filters by state and pages', async () => {
  const jobId = await jobOf('telegram');
  const many = Array.from({ length: 51 }, (_, i) => ({ platform: 'x', externalId: `5${String(i).padStart(3, '0')}`, overrides: {} }));
  await db.transaction((tx) => insertRows(tx, jobId, many), system);
  const page = await rowsPage(db, jobId, { offset: 0, limit: 50 });
  assert.equal(page.rows.length, 50);
  assert.equal(page.hasMore, true);
  await db.transaction((tx) => updateRow(tx, page.rows[0].id, { state: 'skipped', error: 'duplicate' }), system);
  const skipped = await rowsPage(db, jobId, { state: 'skipped', offset: 0, limit: 50 });
  assert.equal(skipped.rows.length, 1);
  assert.equal(skipped.rows[0].error, 'duplicate');
});

test('heldItemIds covers held states only; importHeldItemIdSet spans jobs', async () => {
  const jobId = await jobOf();
  const publishedItem = await db.transaction((tx) => insertItem(tx), system);
  const heldItem = await db.transaction((tx) => insertItem(tx), system);
  await db.transaction(async (tx) => {
    await insertRows(tx, jobId, [
      { platform: 'x', externalId: '701', overrides: {} },
      { platform: 'x', externalId: '702', overrides: {} },
      { platform: 'x', externalId: '703', overrides: {} },
    ]);
    const { rows } = await rowsPage(tx, jobId, { offset: 0, limit: 50 });
    await updateRow(tx, rows[0].id, { state: 'fetched', itemId: heldItem });
    await updateRow(tx, rows[1].id, { state: 'published', itemId: publishedItem });
    await updateRow(tx, rows[2].id, { state: 'skipped', itemId: publishedItem, error: 'duplicate' });
  }, system);
  assert.deepEqual(await heldItemIds(db, jobId), [heldItem]);
  const set = await importHeldItemIdSet(db);
  assert.ok(set.has(heldItem));
  assert.ok(!set.has(publishedItem), 'a skipped row does not claim the item');
  const rows = await rowsWithItems(db, jobId);
  assert.equal(rows.length, 1, 'only held rows with an item');
});

test('jobsRecent lists the newest jobs with counts', async () => {
  const jobId = await jobOf('notion');
  await db.transaction((tx) => setJobStatus(tx, jobId, 'done'), system);
  const jobs = await jobsRecent(db, { limit: 5 });
  assert.ok(jobs.some((job) => job.id === jobId && job.status === 'done'));
  assert.ok(jobs.every((job) => typeof job.counts === 'object'));
  assert.ok(jobs.every((job) => job.createdAt));
});
