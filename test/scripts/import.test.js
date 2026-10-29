// @ts-check
/** Plan 3 Task 5: the import CLI's run — held entries, states, resume, dry run. */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { IDS } from '../helpers/fixtures.js';
import { ingestDeps, count, rows } from '../helpers/ingest.js';
import { runImport } from '../../scripts/import.js';
import { countsByState } from '../../src/repo/imports.js';

/** @type {Awaited<ReturnType<typeof ingestDeps>>} */
let deps;
before(async () => { deps = await ingestDeps(); });
after(async () => { await deps.db.end(); });

const HEADER = 'Name,Date,Artist(s),Type,Client / Media,Keyword,Hashtag,Translation link,Original media';
const csvFor = (...ids) => [HEADER, ...ids.map((id, i) => `n${i},2026-10-0${i + 1},host,live,tiktok,an-event,#tag,https://x.com/tl/status/${id},`)].join('\n');

test('a notion run creates a held item per row and records states', async () => {
  const res = await runImport({
    args: ['--notion', 'x.csv', '--pace', '0'],
    deps, read: async () => csvFor(IDS.LONG, IDS.EVENT_A), log: () => {},
  });
  const jobId = res.jobs[0].jobId;
  const counts = await countsByState(deps.db, jobId);
  assert.equal(counts.queued, 0);
  assert.equal(counts.failed, 0);
  assert.ok(counts.fetched + counts.needs_speakers >= 2, JSON.stringify(counts));
  const { rows: items } = await deps.db.query("select review_state from items where added_via = 'notion'");
  assert.ok(items.length >= 2);
  assert.ok(items.every((item) => item.review_state === 'pending'));
});

test('a link run skips duplicates and marks a deleted tweet failed', async () => {
  const res = await runImport({
    args: ['--links', 'chat.txt', '--pace', '0'],
    deps, read: async () => `look https://x.com/a/status/${IDS.LONG} and https://x.com/a/status/${IDS.TOMB}`, log: () => {},
  });
  const counts = await countsByState(deps.db, res.jobs[0].jobId);
  assert.equal(counts.skipped, 1, 'LONG was already archived');
  assert.equal(counts.failed, 1, 'TOMB is deleted');
});

test('--dry-run writes no items', async () => {
  const before = await count(deps.db, 'select count(*)::int as n from items');
  const res = await runImport({
    args: ['--links', 'chat.txt', '--dry-run'],
    deps, read: async () => `https://x.com/a/status/${IDS.POST}`, log: () => {},
  });
  assert.equal(res.jobs.length, 0);
  assert.equal(await count(deps.db, 'select count(*)::int as n from items'), before);
});

test('--retry processes only unfinished rows and duplicates do not double-archive', async () => {
  const first = await runImport({
    args: ['--links', 'chat.txt', '--pace', '0'],
    deps, read: async () => `https://x.com/a/status/${IDS.POST}`, log: () => {},
  });
  const jobId = first.jobs[0].jobId;
  await deps.db.transaction((tx) => tx.query("update import_rows set state = 'failed', error = 'fetch failed' where job_id = $1", [jobId]), { actor: 'system' });
  const again = await runImport({ args: ['--retry', String(jobId), '--pace', '0'], deps, log: () => {} });
  assert.equal(again.jobs[0].jobId, jobId);
  const counts = await countsByState(deps.db, jobId);
  assert.equal(counts.failed, 0);
  assert.equal(counts.skipped, 1, 'the retry sees it already archived');
  const posts = await rows(deps.db, "select count(*)::int as n from item_sources where external_id = $1 and role = 'primary'", [IDS.POST]);
  assert.equal(posts[0].n, 1);
});
