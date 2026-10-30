// @ts-check
/** Plan 3 Task 7: bulk speaker mapping semantics. */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { IDS } from '../helpers/fixtures.js';
import { HOST, ingestDeps, ingest, rows, SYSTEM } from '../helpers/ingest.js';
import { createJob, insertRows, rowsPage, updateRow } from '../../src/repo/imports.js';
import { applyMapping } from '../../src/services/importMapping.js';
import { ensureOwnerUser, markerTable } from '../../src/services/importJob.js';
import { publishRows } from '../../src/services/importActions.js';
import { personView } from '../../src/services/hubs.js';
import { createPeople } from '../../src/services/intakeRefs.js';
import { getPersonByHandle } from '../../src/repo/people.js';
import { listItemPeople } from '../../src/repo/itemPeople.js';
import { recall, remember } from '../../src/repo/speakerMemory.js';

/** @type {Awaited<ReturnType<typeof ingestDeps>>} */
let deps;
/** @type {number} */
let jobId;
/** @type {string} */
let owner;
/** @type {{ longId: number, liveId: number, otherId: number, accountId: number, hostId: number }} */
let data;

/**
 * A job holding the given items, each row in `state`.
 * @param {{ externalId: string, itemId: number }[]} entries @param {string} state
 */
async function jobOf(entries, state) {
  return deps.db.transaction(async (tx) => {
    const id = await createJob(tx, { source: 'notion', actor: 'system' });
    await insertRows(tx, id, entries.map((entry) => ({ platform: 'x', externalId: entry.externalId, overrides: {} })));
    const { rows: all } = await rowsPage(tx, id, { offset: 0, limit: 10 });
    for (const entry of entries) {
      await updateRow(tx, all.find((row) => row.externalId === entry.externalId).id, { state, itemId: entry.itemId });
    }
    return id;
  }, SYSTEM);
}

/** LONG's markers no answer covers yet. */
async function openOnLong() {
  const table = await markerTable(deps, jobId);
  return table.flatMap((group) => group.markers)
    .filter((m) => m.entries.some((item) => item.itemId === data.longId)).map((m) => m.marker);
}

/** @param {number} itemId @param {string} marker */
async function answerOf(itemId, marker) {
  const [row] = await rows(deps.db, 'select person_id, role from translation_speakers where item_id = $1 and marker = $2', [itemId, marker]);
  return row ?? null;
}

/** @param {number} itemId @param {string} line */
async function appendLine(itemId, line) {
  await deps.db.transaction((tx) => tx.query("update translation_parts set body = body || E'\\n' || $2 where item_id = $1 and position = 0", [itemId, line]), SYSTEM);
}

before(async () => {
  deps = await ingestDeps();
  owner = await ensureOwnerUser(deps);
  await createPeople(deps, [HOST], SYSTEM);
  const long = await ingest(deps, IDS.LONG, { allowUnmapped: true, holdForReview: true });
  const live = await ingest(deps, IDS.LIVE, { allowUnmapped: true, holdForReview: true });
  // Another translator's held entry that uses the same marker.
  const other = await ingest(deps, IDS.IMPORT_MARKERS, { allowUnmapped: true, holdForReview: true });
  await appendLine(other.itemId, '🐱: a line from someone else');
  jobId = await jobOf([
    { externalId: IDS.LONG, itemId: long.itemId },
    { externalId: IDS.LIVE, itemId: live.itemId },
    { externalId: IDS.IMPORT_MARKERS, itemId: other.itemId },
  ], 'needs_speakers');
  const { id: hostId } = /** @type {any} */ (await getPersonByHandle(deps.db, 'host_x'));
  const [{ id: accountId }] = await rows(deps.db, 'select credited_account_id as id from items where id = $1', [long.itemId]);
  data = { longId: long.itemId, liveId: live.itemId, otherId: other.itemId, accountId, hostId };
});
after(async () => { await deps.db.end(); });

test("mapping reaches every entry of that translator in the job and no one else's", async () => {
  const { updated } = await applyMapping(deps, { jobId, accountId: data.accountId, marker: '🐱', speaker: { person: data.hostId }, actor: owner });
  assert.equal(updated, 2);
  assert.equal((await answerOf(data.longId, '🐱'))?.person_id, data.hostId);
  assert.equal((await answerOf(data.liveId, '🐱'))?.person_id, data.hostId);
  assert.equal(await answerOf(data.otherId, '🐱'), null, "another translator's entry is untouched");
});

test("a mapped marker puts the person on the entry's people", async () => {
  const people = await listItemPeople(deps.db, data.liveId);
  assert.ok(people.some((p) => p.personId === data.hostId), JSON.stringify(people));
  assert.equal(await personView(deps, 'host_x'), null, 'no page while the entry is held');
  await publishRows(deps, { jobId, scope: 'ready', actor: /** @type {any} */ ({ id: owner }) });
  const view = /** @type {any} */ (await personView(deps, 'host_x'));
  assert.ok(view, 'the person hub exists once the entry is published');
  assert.equal(view.counts.items, 1);
  assert.ok(JSON.stringify(view.sections).includes(`"id":${data.liveId}`), 'the hub lists the entry');
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
  await applyMapping(deps, { jobId, accountId: group.accountId, marker, speaker: { role: 'fan' }, remember: false, actor: owner });
  let [row] = await rows(deps.db, 'select role from translation_speakers where item_id = $1 and marker = $2', [data.longId, marker]);
  assert.equal(row.role, 'host', 'batch mode never overwrites');
  // Per-entry mode does.
  await applyMapping(deps, { jobId, accountId: group.accountId, marker, speaker: { role: 'fan' }, entries: [data.longId], remember: false, actor: owner });
  [row] = await rows(deps.db, 'select role from translation_speakers where item_id = $1 and marker = $2', [data.longId, marker]);
  assert.equal(row.role, 'fan');
});

test('batch mode leaves an entry that already answers the marker alone', async () => {
  const [marker] = await openOnLong();
  assert.ok(marker, 'an open marker on LONG');
  await applyMapping(deps, { jobId, accountId: data.accountId, marker, speaker: { role: 'fan' }, entries: [data.longId], actor: owner });
  const { updated } = await applyMapping(deps, { jobId, accountId: data.accountId, marker, speaker: { person: data.hostId }, actor: owner });
  assert.equal(updated, 0, 'nothing changed');
  assert.deepEqual(await answerOf(data.longId, marker), { person_id: null, role: 'fan' });
});

test('remember merges into existing memory', async () => {
  await deps.db.transaction((tx) => remember(tx, data.accountId, { '🦊': { role: 'host' } }), SYSTEM);
  const [marker] = await openOnLong();
  assert.ok(marker, 'an open marker on LONG');
  await applyMapping(deps, { jobId, accountId: data.accountId, marker, speaker: { role: 'fan' }, remember: true, actor: owner });
  const memory = await recall(deps.db, data.accountId);
  assert.deepEqual(memory['🦊'], { role: 'host' }, 'the earlier marker is kept');
  assert.deepEqual(memory[marker], { role: 'fan' });
});

test('the audit log names the owner', async () => {
  await appendLine(data.longId, '🦔: one more line');
  const [{ last }] = await rows(deps.db, 'select coalesce(max(id), 0) as last from audit_log');
  await applyMapping(deps, { jobId, accountId: data.accountId, marker: '🦔', speaker: { person: data.hostId }, actor: owner });
  const audit = await rows(deps.db, "select actor from audit_log where id > $1 and table_name in ('translation_speakers', 'item_people')", [last]);
  assert.ok(audit.length > 0);
  assert.ok(audit.every((row) => row.actor === owner), JSON.stringify(audit));
});

test('mapping an attached row purges its public parent', async () => {
  const job = await jobOf([{ externalId: IDS.LIVE, itemId: data.liveId }], 'attached');
  await appendLine(data.liveId, '🦉: a later part');
  /** @type {string[][]} */
  const calls = [];
  const capture = async (/** @type {string[]} */ tags) => { calls.push(tags); };
  const purging = { ...deps, env: { VERCEL: '1' }, invalidateByTag: capture, dangerouslyDeleteByTag: capture };
  const { updated } = await applyMapping(purging, { jobId: job, accountId: data.accountId, marker: '🦉', speaker: { role: 'fan' }, actor: owner });
  assert.equal(updated, 1);
  assert.ok(calls.flat().includes(`item:${data.liveId}`), JSON.stringify(calls));
});
