// @ts-check
/** Plan 3 Task 8: publish, skip, archive and retry on a job. */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { IDS } from '../helpers/fixtures.js';
import { ingestDeps, ingest, rows, SYSTEM } from '../helpers/ingest.js';
import { createJob, insertRows, rowsPage, updateRow, getRow } from '../../src/repo/imports.js';
import { publishRows, skipRow, archiveRow, retryRows } from '../../src/services/importActions.js';

/** @type {Awaited<ReturnType<typeof ingestDeps>>} */
let deps;
/** @type {number} */
let jobId;
/** @type {{ needs: number, check: number, attached: number, parentId: number, replyId: string }} */
let data;
const actor = /** @type {any} */ ({ id: 'system' });

before(async () => {
  deps = await ingestDeps();
  jobId = await deps.db.transaction((tx) => createJob(tx, { source: 'notion', actor: 'system' }), SYSTEM);
  const long = await ingest(deps, IDS.LONG, { allowUnmapped: true, holdForReview: true });
  const bare = await ingest(deps, IDS.POST, { allowUnmapped: true, holdForReview: true });
  const thread = await ingest(deps, IDS.THREAD); // published parent
  await ingest(deps, IDS.THREAD_REPLY, { holdForReview: true }); // attached, held part
  await deps.db.transaction(async (tx) => {
    await insertRows(tx, jobId, [
      { platform: 'x', externalId: IDS.LONG, overrides: {} },
      { platform: 'x', externalId: IDS.POST, overrides: {} },
      { platform: 'x', externalId: IDS.THREAD_REPLY, overrides: {} },
    ]);
    const { rows: all } = await rowsPage(tx, jobId, { offset: 0, limit: 10 });
    const rowOf = (id) => all.find((row) => row.externalId === id);
    await updateRow(tx, rowOf(IDS.LONG).id, { state: 'needs_speakers', itemId: long.itemId });
    await updateRow(tx, rowOf(IDS.POST).id, { state: 'check', itemId: bare.itemId });
    await updateRow(tx, rowOf(IDS.THREAD_REPLY).id, { state: 'attached', itemId: thread.itemId });
  }, SYSTEM);
  const { rows: all } = await rowsPage(deps.db, jobId, { offset: 0, limit: 10 });
  data = {
    needs: all.find((row) => row.externalId === IDS.LONG).id,
    check: all.find((row) => row.externalId === IDS.POST).id,
    attached: all.find((row) => row.externalId === IDS.THREAD_REPLY).id,
    parentId: thread.itemId,
    replyId: IDS.THREAD_REPLY,
  };
});
after(async () => { await deps.db.end(); });

test('publish ready leaves needs_speakers and check held; all clears them', async () => {
  const ready = await publishRows(deps, { jobId, scope: 'ready', actor });
  assert.equal(ready.published, 0, 'nothing is fetched in this job');
  const all = await publishRows(deps, { jobId, scope: 'all', actor });
  assert.equal(all.published, 3);
  const items = await rows(deps.db, "select i.review_state from items i join import_rows r on r.item_id = i.id where r.job_id = $1", [jobId]);
  assert.ok(items.every((item) => item.review_state === 'published'));
  const parts = await rows(deps.db, 'select pending from translation_parts where item_id = $1 order by position', [data.parentId]);
  assert.ok(parts.some((part) => part.pending === false), 'the attached part is approved');
});

test('skipping an item row hides it with import_skipped', async () => {
  const itemId = await deps.db.transaction((tx) => tx.query(
    "insert into items (kind, placement, occurred_on, added_via, review_state, sort_key) values ('translation','unsorted','2026-10-01','notion','pending',9) returning id",
  ), SYSTEM).then((result) => result.rows[0].id);
  const rowId = await deps.db.transaction(async (tx) => {
    await insertRows(tx, jobId, [{ platform: 'x', externalId: '990001', overrides: {} }]);
    const { rows: all } = await rowsPage(tx, jobId, { offset: 0, limit: 50 });
    const row = all.find((entry) => entry.externalId === '990001');
    await updateRow(tx, row.id, { state: 'check', itemId });
    return row.id;
  }, SYSTEM);
  await skipRow(deps, { jobId, rowId, actor });
  const item = await rows(deps.db, 'select deleted_reason from items where id = $1', [itemId]);
  assert.equal(item[0].deleted_reason, 'import_skipped');
  assert.equal((await getRow(deps.db, rowId)).state, 'skipped');
});

/**
 * A held follow-up part on `parentId` with its own source row, at `position`.
 * @param {number} parentId @param {string} externalId @param {number} position
 * @returns {Promise<{ position: number }>}
 */
async function heldPart(parentId, externalId, position) {
  await deps.db.transaction(async (tx) => {
    const { rows: source } = await tx.query(
      "insert into item_sources (item_id, kind, platform, external_id, url, role) values ($1, 'translation', 'x', $2, $3, 'follow_up') returning id",
      [parentId, externalId, `https://x.com/tl_beta/status/${externalId}`],
    );
    await tx.query(
      'insert into translation_parts (item_id, position, source_id, body, pending) values ($1, $2, $3, $4, true)',
      [parentId, position, source[0].id, `held follow-up ${externalId}`],
    );
  }, SYSTEM);
  return { position };
}

/**
 * A job with one attached row for `externalId`, pointing at `parentId`.
 * @param {number} parentId @param {string} externalId
 * @returns {Promise<{ jobId: number, rowId: number }>}
 */
async function attachedJob(parentId, externalId) {
  return deps.db.transaction(async (tx) => {
    const job = await createJob(tx, { source: 'notion', actor: 'system' });
    await insertRows(tx, job, [{ platform: 'x', externalId, overrides: {} }]);
    const { rows: all } = await rowsPage(tx, job, { offset: 0, limit: 10 });
    const row = all.find((entry) => entry.externalId === externalId);
    await updateRow(tx, row.id, { state: 'attached', itemId: parentId });
    return { jobId: job, rowId: row.id };
  }, SYSTEM);
}

/** @param {number} parentId @param {number} position */
function partAt(parentId, position) {
  return rows(deps.db, 'select pending, rejected from translation_parts where item_id = $1 and position = $2', [parentId, position])
    .then((found) => found[0]);
}

test('publishing one attached row leaves another held part on the parent held', async () => {
  const mine = await heldPart(data.parentId, '990020', 80);
  const sibling = await heldPart(data.parentId, '990021', 81);
  const job = await attachedJob(data.parentId, '990020');
  await attachedJob(data.parentId, '990021');

  await publishRows(deps, { jobId: job.jobId, scope: 'all', actor });

  assert.equal((await partAt(data.parentId, mine.position)).pending, false, 'its own part is approved');
  assert.equal((await partAt(data.parentId, sibling.position)).pending, true, "the other job's part is untouched");
});

test('skipping an attached row rejects only its own held part', async () => {
  const mine = await heldPart(data.parentId, '990022', 82);
  const sibling = await heldPart(data.parentId, '990023', 83);
  const job = await attachedJob(data.parentId, '990022');
  await attachedJob(data.parentId, '990023');

  await skipRow(deps, { jobId: job.jobId, rowId: job.rowId, actor });

  assert.equal((await partAt(data.parentId, mine.position)).rejected, true, 'its own part is rejected');
  assert.equal((await partAt(data.parentId, sibling.position)).rejected, false, "the other job's part is untouched");
  const parent = await rows(deps.db, 'select review_state from items where id = $1', [data.parentId]);
  assert.equal(parent[0].review_state, 'published', 'the parent is untouched');
});

test('archive publishes a check row; skipping a published row is refused', async () => {
  const itemId = await deps.db.transaction((tx) => tx.query(
    "insert into items (kind, placement, occurred_on, added_via, review_state, sort_key) values ('translation','unsorted','2026-10-01','notion','pending',10) returning id",
  ), SYSTEM).then((result) => result.rows[0].id);
  const rowId = await deps.db.transaction(async (tx) => {
    await insertRows(tx, jobId, [{ platform: 'x', externalId: '990003', overrides: {} }]);
    const { rows: all } = await rowsPage(tx, jobId, { offset: 0, limit: 50 });
    const row = all.find((entry) => entry.externalId === '990003');
    await updateRow(tx, row.id, { state: 'check', itemId });
    return row.id;
  }, SYSTEM);
  await archiveRow(deps, { jobId, rowId, actor });
  assert.equal((await getRow(deps.db, rowId)).state, 'published');
  await assert.rejects(skipRow(deps, { jobId, rowId, actor }), { name: 'Conflict' });
});

test('retry processes at most ten rows and reports the remainder', async () => {
  const retryJob = await deps.db.transaction((tx) => createJob(tx, { source: 'paste', actor: 'system' }), SYSTEM);
  await deps.db.transaction((tx) => insertRows(tx, retryJob, Array.from({ length: 12 }, (_, i) => ({ platform: 'x', externalId: `7000${i}`, overrides: {} }))), SYSTEM);
  const res = await retryRows(deps, { jobId: retryJob, actor });
  assert.equal(res.processed, 10);
  assert.equal(res.remaining, 2);
});
