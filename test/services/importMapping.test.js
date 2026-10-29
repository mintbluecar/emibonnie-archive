// @ts-check
/** Plan 3 Task 7: bulk speaker mapping semantics. */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { IDS } from '../helpers/fixtures.js';
import { ingestDeps, ingest, rows, SYSTEM } from '../helpers/ingest.js';
import { createJob, insertRows, rowsPage, updateRow } from '../../src/repo/imports.js';
import { applyMapping } from '../../src/services/importMapping.js';
import { markerTable } from '../../src/services/importJob.js';
import { recall } from '../../src/repo/speakerMemory.js';

/** @type {Awaited<ReturnType<typeof ingestDeps>>} */
let deps;
/** @type {number} */
let jobId;
/** @type {{ longId: number, liveId: number, accountId: number, marker: string }} */
let data;

before(async () => {
  deps = await ingestDeps();
  jobId = await deps.db.transaction((tx) => createJob(tx, { source: 'notion', actor: 'system' }), SYSTEM);
  const long = await ingest(deps, IDS.LONG, { allowUnmapped: true, holdForReview: true });
  const live = await ingest(deps, IDS.LIVE, { allowUnmapped: true, holdForReview: true });
  await deps.db.transaction(async (tx) => {
    await insertRows(tx, jobId, [
      { platform: 'x', externalId: IDS.LONG, overrides: {} },
      { platform: 'x', externalId: IDS.LIVE, overrides: {} },
    ]);
    const { rows: all } = await rowsPage(tx, jobId, { offset: 0, limit: 10 });
    await updateRow(tx, all.find((row) => row.externalId === IDS.LONG).id, { state: 'needs_speakers', itemId: long.itemId });
    await updateRow(tx, all.find((row) => row.externalId === IDS.LIVE).id, { state: 'needs_speakers', itemId: live.itemId });
  }, SYSTEM);
  const table = await markerTable(deps, jobId);
  data = { longId: long.itemId, liveId: live.itemId, accountId: table[0].accountId, marker: table[0].markers[0].marker };
});
after(async () => { await deps.db.end(); });

test('batch mapping fills the marker wherever the translator used it', async () => {
  const table = await markerTable(deps, jobId);
  const group = table[0];
  const marker = group.markers[0].marker;
  await applyMapping(deps, { jobId, accountId: group.accountId, marker, speaker: { role: 'fan' }, remember: false });
  const mapped = await rows(deps.db, 'select item_id from translation_speakers where marker = $1 and item_id = any($2::bigint[])', [marker, [data.longId, data.liveId]]);
  assert.ok(mapped.length >= 1, 'the marker reached the entries that use it');
});

test('a per-entry answer overrides that item while the batch mode does not', async () => {
  const table = await markerTable(deps, jobId);
  const group = table.find((entry) => entry.markers.some((marker) => marker.entries.some((item) => item.itemId === data.longId)));
  assert.ok(group, 'a marker on the seeded item');
  const marker = group.markers.find((entry) => entry.entries.some((item) => item.itemId === data.longId)).marker;
  // Existing answer on the item: the batch must leave it alone.
  await deps.db.transaction((tx) => tx.query(
    `insert into translation_speakers (item_id, marker, role) values ($1, $2, 'host')
     on conflict (item_id, marker) do update set role = 'host'`, [data.longId, marker],
  ), SYSTEM);
  await applyMapping(deps, { jobId, accountId: group.accountId, marker, speaker: { role: 'fan' }, remember: false });
  let [row] = await rows(deps.db, 'select role from translation_speakers where item_id = $1 and marker = $2', [data.longId, marker]);
  assert.equal(row.role, 'host', 'batch mode never overwrites');
  // Per-entry mode does.
  await applyMapping(deps, { jobId, accountId: group.accountId, marker, speaker: { role: 'fan' }, entries: [data.longId], remember: false });
  [row] = await rows(deps.db, 'select role from translation_speakers where item_id = $1 and marker = $2', [data.longId, marker]);
  assert.equal(row.role, 'fan');
});

test('remember is opt-in and merges one marker into memory', async () => {
  assert.deepEqual(await recall(deps.db, data.accountId), {});
  await applyMapping(deps, { jobId, accountId: data.accountId, marker: data.marker, speaker: { role: 'fan' }, remember: true });
  const memory = await recall(deps.db, data.accountId);
  assert.deepEqual(memory[data.marker], { role: 'fan' });
});
