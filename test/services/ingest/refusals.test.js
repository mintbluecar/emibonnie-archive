// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IDS } from '../../helpers/fixtures.js';
import { ingestDeps, ingest, rows, count, SYSTEM } from '../../helpers/ingest.js';
import { usingPostgres } from '../../helpers/db.js';
import { kindsRegistry } from '../../../src/kinds/_registry.js';
import { set as setSetting } from '../../../src/repo/settings.js';

const translation = kindsRegistry.translation;

test('refusals: duplicate, removed, opted_out, deleted, unavailable -- none writes an item', async () => {
  const deps = await ingestDeps();
  try {
    const b = await ingest(deps, IDS.EVENT_B);
    assert.deepEqual(await ingest(deps, IDS.EVENT_B), { status: 'duplicate', sourceId: IDS.EVENT_B, itemId: b.itemId });
    await deps.db.transaction((tx) => tx.query("update items set deleted_at = now(), deleted_reason = 'spam' where id = $1", [b.itemId]), SYSTEM);
    assert.equal((await ingest(deps, IDS.EVENT_B)).status, 'removed');

    await deps.db.transaction((tx) => tx.query("update accounts set opted_out_at = now() where handle = 'tl_gamma'"), SYSTEM);
    assert.equal((await ingest(deps, IDS.THREAD_OTHER)).status, 'opted_out');

    assert.equal((await ingest(deps, IDS.TOMB)).status, 'deleted');
    assert.equal((await ingest(deps, '1900000000000000099')).status, 'unavailable');
    assert.equal(await count(deps.db, 'select count(*)::int as n from items'), 1);
  } finally {
    await deps.db.end();
  }
});

test('hand-typed text by someone other than the translator waits for review', async () => {
  const deps = await ingestDeps();
  try {
    await deps.db.transaction((tx) => tx.query("insert into users (id, display_name) values ('member-1', 'member')"), SYSTEM);
    const result = await ingest(deps, IDS.LIVE, { overrides: { text: '💬: typed in by hand' }, actor: 'member-1' });
    assert.equal(result.status, 'pending');
    const [item] = await rows(deps.db, 'select review_state, created_by from items where id = $1', [result.itemId]);
    assert.deepEqual(item, { review_state: 'pending', created_by: 'member-1' });
    const [row] = await rows(deps.db, 'select text_entered_manually from translations where item_id = $1', [result.itemId]);
    assert.equal(row.text_entered_manually, true);
    assert.equal((await ingest(deps, IDS.LIVE)).status, 'pending', 'a pending source is reported, not re-ingested');
  } finally {
    await deps.db.end();
  }
});

test('settings.approvalRequired makes every new item pending', async () => {
  const deps = await ingestDeps();
  try {
    await deps.db.transaction((tx) => setSetting(tx, 'approvalRequired', true), SYSTEM);
    assert.equal((await ingest(deps, IDS.EVENT_B)).status, 'pending');
  } finally {
    await deps.db.end();
  }
});

test('a failing persist rolls everything back: no items, events or audit rows', async () => {
  const deps = await ingestDeps();
  try {
    const before = await count(deps.db, 'select count(*)::int as n from audit_log');
    const failing = { ...translation, persist: async () => { throw new Error('persist exploded'); } };
    await assert.rejects(ingest({ ...deps, kinds: { translation: failing } }, IDS.JOINT_LIVE), /persist exploded/);
    assert.equal(await count(deps.db, 'select count(*)::int as n from items'), 0);
    assert.equal(await count(deps.db, 'select count(*)::int as n from events'), 0);
    assert.equal(await count(deps.db, 'select count(*)::int as n from audit_log'), before);
  } finally {
    await deps.db.end();
  }
});

test('no date anywhere gives needs_date and writes nothing; overrides.occurredOn supplies it', async () => {
  const deps = await ingestDeps();
  try {
    const undated = {
      ...translation,
      draft: (/** @type {any} */ input, /** @type {any} */ ctx) => {
        const draft = translation.draft(input, ctx);
        return { ...draft, common: { ...draft.common, occurredOn: null, postedAt: null } };
      },
    };
    const undatedDeps = { ...deps, kinds: { translation: undated } };
    const result = await ingest(undatedDeps, IDS.POST);
    assert.equal(result.status, 'needs_date');
    assert.equal(await count(deps.db, 'select count(*)::int as n from items'), 0);

    const dated = await ingest(undatedDeps, IDS.POST, { overrides: { occurredOn: '2026-10-01' } });
    assert.equal(dated.status, 'added');
    const [item] = await rows(deps.db, 'select occurred_on, posted_at from items where id = $1', [dated.itemId]);
    assert.deepEqual(item, { occurred_on: '2026-10-01', posted_at: null });
  } finally {
    await deps.db.end();
  }
});

test('a reply to a removed or pending item is refused with that state, and adds nothing', async () => {
  const deps = await ingestDeps();
  try {
    const thread = await ingest(deps, IDS.THREAD);
    const partCount = () => count(deps.db, 'select count(*)::int as n from translation_parts where item_id = $1', [thread.itemId]);
    await deps.db.transaction((tx) => tx.query("update items set review_state = 'pending' where id = $1", [thread.itemId]), SYSTEM);
    assert.deepEqual(await ingest(deps, IDS.THREAD_REPLY), { status: 'pending', sourceId: IDS.THREAD_REPLY, itemId: thread.itemId });
    await deps.db.transaction((tx) => tx.query("update items set review_state = 'published', deleted_at = now(), deleted_reason = 'removed_by_account' where id = $1", [thread.itemId]), SYSTEM);
    assert.deepEqual(await ingest(deps, IDS.THREAD_REPLY), { status: 'removed', sourceId: IDS.THREAD_REPLY, itemId: thread.itemId });
    assert.equal(await partCount(), 2);
    assert.equal(await count(deps.db, 'select count(*)::int as n from items'), 1);
  } finally {
    await deps.db.end();
  }
});

test('the same post ingested twice, the second write losing the race (interleaved, so it runs on PGlite too), is a duplicate', async () => {
  const deps = await ingestDeps();
  try {
    /** @type {Promise<any>|null} */
    let rival = null;
    const real = deps.fetchImpl;
    const racing = {
      ...deps,
      fetchImpl: /** @type {typeof fetch} */ (async (input, init) => {
        // the first fetch happens after this ingest's own "already archived?" check: the rival commits now
        rival ??= ingest(deps, IDS.EVENT_B);
        await rival;
        return real(input, init);
      }),
    };
    const loser = await ingest(racing, IDS.EVENT_B);
    const winner = await rival;
    assert.equal(winner.status, 'added');
    assert.deepEqual(loser, { status: 'duplicate', sourceId: IDS.EVENT_B, itemId: winner.itemId });
    assert.equal(await count(deps.db, 'select count(*)::int as n from items'), 1);
  } finally {
    await deps.db.end();
  }
});

test('two concurrent ingests of the same post: one added, one duplicate (Postgres only; PGlite runs the interleaved test above)', { skip: !usingPostgres && 'PGlite has one connection, so writes cannot truly race' }, async () => {
  const deps = await ingestDeps();
  try {
    const results = await Promise.all([ingest(deps, IDS.EVENT_B), ingest(deps, IDS.EVENT_B)]);
    const statuses = results.map((r) => r.status).sort();
    assert.deepEqual(statuses, ['added', 'duplicate']);
    assert.equal(results[0].itemId, results[1].itemId);
    assert.equal(await count(deps.db, 'select count(*)::int as n from items'), 1);
  } finally {
    await deps.db.end();
  }
});

test('dryRun writes nothing', async () => {
  const deps = await ingestDeps();
  try {
    const itemsBefore = await count(deps.db, 'select count(*)::int as n from items');
    const eventsBefore = await count(deps.db, 'select count(*)::int as n from events');
    const auditBefore = await count(deps.db, 'select count(*)::int as n from audit_log');
    const result = await ingest(deps, IDS.EVENT_B, { dryRun: true, allowUnmapped: true });
    assert.equal(result.status, 'ready');
    assert.equal(await count(deps.db, 'select count(*)::int as n from items'), itemsBefore);
    assert.equal(await count(deps.db, 'select count(*)::int as n from events'), eventsBefore);
    assert.equal(await count(deps.db, 'select count(*)::int as n from audit_log'), auditBefore, 'dryRun writes no audit rows');
  } finally {
    await deps.db.end();
  }
});
