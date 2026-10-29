// @ts-check
/**
 * Plan 3 Task 4: job views, readiness classification, the per-translator
 * marker table, and the 2b waiting-list exclusion.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { IDS } from '../helpers/fixtures.js';
import { ingestDeps, ingest, rows, SYSTEM } from '../helpers/ingest.js';
import { createJob, insertRows, updateRow, rowsPage } from '../../src/repo/imports.js';
import {
  jobView, rowsPage as serviceRows, markerTable, readinessOf, recomputeRow,
} from '../../src/services/importJob.js';
import { ownerView } from '../../src/services/owner.js';
import { set as setSetting } from '../../src/repo/settings.js';

/** @type {Awaited<ReturnType<typeof ingestDeps>>} */
let deps;
/** @type {number} */
let jobId;

/** @param {string} sourceId @param {Partial<any>} [extra] */
function heldIngest(sourceId, extra = {}) {
  return ingest(deps, sourceId, { allowUnmapped: true, holdForReview: true, ...extra });
}

before(async () => {
  deps = await ingestDeps();
  jobId = await deps.db.transaction((tx) => createJob(tx, { source: 'notion', actor: 'system' }), SYSTEM);
  const long = await heldIngest(IDS.LONG);
  const bare = await heldIngest(IDS.NO_MARKERS);
  await deps.db.transaction(async (tx) => {
    await insertRows(tx, jobId, [
      { platform: 'x', externalId: IDS.LONG, overrides: {} },
      { platform: 'x', externalId: IDS.NO_MARKERS, overrides: {} },
      { platform: 'x', externalId: '999999999', overrides: {} },
    ]);
    const { rows: all } = await rowsPage(tx, jobId, { offset: 0, limit: 10 });
    await updateRow(tx, all.find((row) => row.externalId === IDS.LONG).id, { state: 'needs_speakers', itemId: long.itemId });
    await updateRow(tx, all.find((row) => row.externalId === IDS.NO_MARKERS).id, { state: 'check', itemId: bare.itemId });
    await updateRow(tx, all.find((row) => row.externalId === '999999999').id, { state: 'failed', error: 'fetch failed (429)' });
  }, SYSTEM);
});
after(async () => { await deps.db.end(); });

test('a job view counts states and previews its held rows', async () => {
  const view = await jobView(deps, jobId);
  assert.ok(view);
  assert.equal(view.job.source, 'notion');
  assert.equal(view.counts.needs_speakers, 1);
  assert.equal(view.counts.check, 1);
  assert.equal(view.counts.failed, 1);
  const long = view.rows.find((row) => row.state === 'needs_speakers');
  assert.ok(long.preview, 'a held row carries its preview');
  assert.ok(long.sourceUrl.includes(IDS.LONG));
});

test('rows page filters by state and searches parsed text', async () => {
  const failed = await serviceRows(deps, jobId, { state: 'failed', offset: 0 });
  assert.equal(failed.rows.length, 1);
  assert.equal(failed.rows[0].error, 'fetch failed (429)');
  const long = await serviceRows(deps, jobId, { offset: 0 });
  const previewText = long.rows.find((row) => row.preview)?.preview.lines.find((line) => 'text' in line)?.text ?? '';
  const word = [...String(previewText).trim()].slice(0, 3).join('');
  const searched = await serviceRows(deps, jobId, { q: word, offset: 0 });
  assert.ok(searched.rows.some((row) => row.sourceUrl.includes(IDS.LONG)), `q=${word}`);
});

test('the marker table groups each translator\'s unmapped markers with a count and example', async () => {
  const table = await markerTable(deps, jobId);
  const alpha = table.find((entry) => entry.handle === 'tl_alpha');
  assert.ok(alpha, JSON.stringify(table));
  assert.ok(alpha.markers.length >= 1);
  const marker = alpha.markers[0];
  assert.ok(marker.count >= 1);
  assert.ok(marker.example.length > 0);
  assert.ok(marker.entries.length >= 1);
  assert.ok(marker.entries[0].itemId);
});

test('readiness: mapped -> fetched, unmapped -> needs_speakers', async () => {
  const long = await rows(deps.db, "select item_id from item_sources where external_id = $1 and role = 'primary'", [IDS.LONG]);
  const itemId = long[0].item_id;
  assert.equal(await readinessOf(deps, 'translation', itemId), 'needs_speakers');
  // Map every unmapped marker on this one item: it becomes ready.
  const table = await markerTable(deps, jobId);
  const markers = table.flatMap((entry) => entry.markers.map((marker) => marker.marker));
  await deps.db.transaction(async (tx) => {
    for (const marker of markers) {
      await tx.query("insert into translation_speakers (item_id, marker, role) values ($1, $2, 'fan') on conflict do nothing", [itemId, marker]);
    }
  }, SYSTEM);
  assert.equal(await readinessOf(deps, 'translation', itemId), 'fetched');
});

test('recomputeRow never disturbs published or skipped rows', async () => {
  const { rows: all } = await rowsPage(deps.db, jobId, { offset: 0, limit: 10 });
  const failedRow = all.find((row) => row.state === 'failed');
  await deps.db.transaction((tx) => updateRow(tx, failedRow.id, { state: 'skipped', error: 'skip' }), SYSTEM);
  await recomputeRow(deps, failedRow.id);
  const after = await rowsPage(deps.db, jobId, { offset: 0, limit: 10 });
  assert.equal(after.rows.find((row) => row.id === failedRow.id).state, 'skipped');
});

test('the 2b waiting list leaves import-held items out, but keeps a skipped row\'s item', async () => {
  await deps.db.transaction((tx) => setSetting(tx, 'approvalRequired', false), SYSTEM);
  const held = await deps.db.transaction((tx) => tx.query(
    "insert into items (kind, placement, occurred_on, added_via, review_state, sort_key) values ('translation','unsorted','2026-10-01','notion','pending',1) returning id",
  ), SYSTEM);
  const other = await deps.db.transaction((tx) => tx.query(
    "insert into items (kind, placement, occurred_on, added_via, review_state, sort_key) values ('translation','unsorted','2026-10-01','notion','pending',2) returning id",
  ), SYSTEM);
  const second = await deps.db.transaction((tx) => createJob(tx, { source: 'paste', actor: 'system' }), SYSTEM);
  await deps.db.transaction(async (tx) => {
    await insertRows(tx, second, [
      { platform: 'x', externalId: '8801', overrides: {} },
      { platform: 'x', externalId: '8802', overrides: {} },
    ]);
    const { rows: all } = await rowsPage(tx, second, { offset: 0, limit: 10 });
    await updateRow(tx, all[0].id, { state: 'fetched', itemId: held.rows[0].id });
    await updateRow(tx, all[1].id, { state: 'skipped', itemId: other.rows[0].id, error: 'duplicate' });
  }, SYSTEM);
  const waiting = await ownerView(deps);
  assert.ok(Array.isArray(waiting.waiting));
  const { importHeldItemIdSet } = await import('../../src/repo/imports.js');
  const set = await importHeldItemIdSet(deps.db);
  assert.ok(set.has(held.rows[0].id));
  assert.ok(!set.has(other.rows[0].id), 'a skipped row leaves the item to the waiting list');
});
