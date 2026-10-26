// @ts-check
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { IDS } from '../helpers/fixtures.js';
import { seededDeps, itemIdOf, ingest, rows, SYSTEM, LONG_REFS } from '../helpers/ingest.js';
import { itemView } from '../../src/services/itemView.js';
import { search } from '../../src/services/search.js';
import { searchSql } from '../../src/repo/search.js';
import { kindsRegistry } from '../../src/kinds/_registry.js';
import { BadRequest } from '../../src/sources/errors.js';
import { upsertAccount } from '../../src/repo/accounts.js';
import { addParts } from '../../src/kinds/translation/repo.js';

/** @type {any} */
let deps;
before(async () => { deps = await seededDeps(); });
after(async () => { await deps.db.end(); });

/** @param {any} params */
async function ids(params) {
  const { results } = await search(deps, params);
  return results.map((r) => r.sourceId);
}

/** @param {string[]} handles */
async function personIds(handles) {
  const found = await rows(deps.db, `select person_id from accounts where platform = 'instagram' and handle = any($1::text[]) order by person_id`, [handles]);
  return found.map((r) => r.person_id);
}

test('"hug" finds LONG, with its matching lines and event', async () => {
  const { count, results } = await search(deps, { q: 'hug' });
  assert.equal(count, 1);
  const [long] = results;
  assert.equal(long.sourceId, IDS.LONG);
  assert.equal(long.event?.slug, 'solluna-at-starfest-2026-10-18');
  assert.ok(long.matchLines.length > 0 && long.matchLines.length <= 3);
  assert.ok(long.matchLines.every((line) => line.toLowerCase().includes('hug')));
  assert.equal(long.lines.length, 2);
});

test('"hug": match lines show speakers as the item page does, by standard emoji, never the translator\'s marker (Task 9a item 4)', async () => {
  const { results: [long] } = await search(deps, { q: 'hug' });
  const view = /** @type {any} */ (await itemView(deps, 'translation', IDS.LONG));
  const speakerEmoji = new Set(view.bubbles.filter((/** @type {any} */ b) => b.kind === 'speech').map((/** @type {any} */ b) => b.emoji));
  const rawMarkers = Object.keys(LONG_REFS).filter((marker) => !speakerEmoji.has(marker));
  assert.ok(rawMarkers.length > 0, 'LONG has markers that resolve to a different standard emoji');
  for (const line of long.matchLines) {
    assert.ok(!rawMarkers.some((marker) => line.startsWith(marker)), `raw marker shown: ${line}`);
    assert.ok(!/^\S+:/u.test(line), `marker colon shown: ${line}`);
  }
  assert.ok(long.matchLines.some((line) => [...speakerEmoji].some((emoji) => line.startsWith(`${emoji} `))), long.matchLines.join(' | '));
});

test('Thai: "ครบ" ranks LONG first', async () => {
  const { results } = await search(deps, { q: 'ครบ' });
  assert.equal(results[0].sourceId, IDS.LONG);
});

test('a subbed item is left out of a typed query, but a filter-only browse still lists it (Plan 2a Task 7)', async () => {
  const id = await itemIdOf(deps.db, IDS.LONG);
  await deps.db.transaction((/** @type {any} */ tx) => tx.query('update translations set subbed = true where item_id = $1', [id]), SYSTEM);
  try {
    // Typed query: no LONG.
    assert.ok(!(await ids({ q: 'hug' })).includes(IDS.LONG), 'typed query skips a subbed item');
    // Filter-only browse (empty q): still listed.
    const browsing = await search(deps, { q: null });
    assert.ok(browsing.results.some((r) => r.sourceId === IDS.LONG), 'a filter-only browse lists the subbed item');
  } finally {
    await deps.db.transaction((/** @type {any} */ tx) => tx.query('update translations set subbed = false where item_id = $1', [id]), SYSTEM);
  }
});

test('the text clause can use the trigram index (EXPLAIN)', async () => {
  const kinds = Object.values(kindsRegistry);
  const { sql, params } = searchSql({ q: 'ครบ', kinds, filters: {}, limit: 50, offset: 0 });
  const plan = await deps.db.transaction(async (/** @type {any} */ tx) => {
    await tx.query('set local enable_seqscan = off');
    const { rows: lines } = await tx.query(`explain ${sql}`, params);
    return lines.map((/** @type {any} */ r) => r['QUERY PLAN']).join('\n');
  }, SYSTEM);
  assert.match(plan, /translation_parts_body_trgm/, plan);
});

test('ranking: equal rank orders newer posted_at first, then id desc', async () => {
  const aId = await itemIdOf(deps.db, IDS.EVENT_A);
  const bId = await itemIdOf(deps.db, IDS.EVENT_B);
  const [{ posted_at: original }] = await rows(deps.db, 'select posted_at from items where id = $1', [aId]);
  // every "everyone" match is a whole word: all rank 1, so the order is posted_at desc, id desc
  const expected = await rows(deps.db, `select s.external_id from items i join item_sources s on s.item_id = i.id and s.role = 'primary'
    where i.id in (select item_id from translation_parts where body ilike '%everyone%') order by i.posted_at desc, i.id desc`);
  assert.deepEqual((await search(deps, { q: 'everyone' })).results.map((r) => r.sourceId), expected.map((r) => r.external_id));

  await deps.db.transaction((/** @type {any} */ tx) => tx.query('update items set posted_at = (select posted_at from items where id = $2) where id = $1', [aId, bId]), SYSTEM);
  try {
    const order = (await search(deps, { q: 'everyone' })).results.map((r) => r.sourceId);
    assert.ok(bId > aId);
    assert.ok(order.indexOf(IDS.EVENT_B) === order.indexOf(IDS.EVENT_A) - 1, 'same posted_at: higher id first');
  } finally {
    await deps.db.transaction((/** @type {any} */ tx) => tx.query('update items set posted_at = $2 where id = $1', [aId, original]), SYSTEM);
  }
});

test('ranking: the best-matching part decides, ahead of recency', async () => {
  const threadId = await itemIdOf(deps.db, IDS.THREAD);
  await deps.db.transaction((/** @type {any} */ tx) => addParts(tx, threadId, [{ sourceId: null, body: 'so many hugs tonight' }]), SYSTEM);
  try {
    // THREAD is newer than LONG, but "hugs" only partly matches the word "hug": LONG (whole word) ranks first
    assert.deepEqual(await ids({ q: 'hug' }), [IDS.LONG, IDS.THREAD]);
    await deps.db.transaction((/** @type {any} */ tx) => addParts(tx, threadId, [{ sourceId: null, body: 'one last hug' }]), SYSTEM);
    // now THREAD's best part is a whole-word match too: equal rank, so the newer THREAD comes first
    assert.deepEqual(await ids({ q: 'hug' }), [IDS.THREAD, IDS.LONG]);
  } finally {
    await deps.db.transaction((/** @type {any} */ tx) => tx.query('delete from translation_parts where item_id = $1 and position >= 2', [threadId]), SYSTEM);
  }
});

test('no q: every visible item, newest first', async () => {
  const { count, results } = await search(deps, {});
  assert.equal(count, 9);
  assert.equal(results[0].sourceId, IDS.THREAD);
  assert.deepEqual(results.map((r) => r.matchLines), results.map(() => []));
});

test('people: all-of returns no more than any-of, and more than 0', async () => {
  const people = await personIds(['solsunny', 'lunamoon']);
  const any = await search(deps, { people, peopleMode: 'any' });
  const all = await search(deps, { people, peopleMode: 'all' });
  assert.ok(all.count > 0);
  assert.ok(all.count <= any.count);
  assert.deepEqual((await ids({ people, peopleMode: 'all' })).sort(), [IDS.LONG, IDS.EVENT_A, IDS.EVENT_B, IDS.JOINT_LIVE].sort());
});

test('placements: shared story and posts', async () => {
  assert.deepEqual(await ids({ placements: ['shared_story'] }), [IDS.SHARED]);
  assert.ok((await ids({ placements: ['post'] })).includes(IDS.POST));
});

test('filters: event, account, dates, categories, kinds; limit 0 gives the count only', async () => {
  assert.deepEqual((await ids({ eventSlug: 'solluna-happy-day-2026-10-19' })).sort(), [IDS.EVENT_A, IDS.EVENT_B].sort());
  assert.deepEqual(await ids({ accountHandle: 'TL_GAMMA' }), [IDS.EVENT_B]);
  assert.equal((await search(deps, { categories: [32767], clientId: 32767 })).count, 0, 'the smallint maximum is accepted');
  assert.deepEqual(await ids({ from: '2026-03-01', to: '2026-03-01' }), [IDS.JOINT_LIVE]);
  assert.equal((await search(deps, { categories: [1] })).count, 0);
  assert.equal((await search(deps, { kinds: ['translation'] })).count, 9);
  assert.deepEqual(await search(deps, { q: 'hug', limit: 0 }), { count: 1, results: [] });
  assert.equal((await search(deps, { limit: 2, offset: 1 })).results.length, 2);
});

test('accountHandle also matches a handle the account held before a change', async () => {
  await deps.db.transaction((/** @type {any} */ tx) => upsertAccount(tx, { platform: 'x', externalId: '9003', handle: 'gamma_renamed' }), SYSTEM);
  try {
    assert.deepEqual(await ids({ accountHandle: 'tl_gamma' }), [IDS.EVENT_B]);
    assert.deepEqual(await ids({ accountHandle: 'Gamma_Renamed' }), [IDS.EVENT_B]);
  } finally {
    await deps.db.transaction((/** @type {any} */ tx) => upsertAccount(tx, { platform: 'x', externalId: '9003', handle: 'tl_gamma' }), SYSTEM);
  }
});

test('tags, event names, people names and translator handles match too', async () => {
  assert.ok((await ids({ q: '#SLHappyDay2026' })).includes(IDS.EVENT_A));
  assert.ok((await ids({ q: 'tl_gamma' })).includes(IDS.EVENT_B));
  assert.ok((await ids({ q: 'tiktok live' })).includes(IDS.LIVE));
});

test('bad input throws BadRequest', async () => {
  const bad = [
    { q: 'a' }, { q: 'x'.repeat(101) }, { offset: 5000 }, { offset: -1 }, { offset: 1.5 }, { offset: 'abc' },
    { limit: 51 }, { limit: Number.NaN }, { people: ['x'] }, { peopleMode: 'some' }, { placements: ['nope'] },
    { kinds: ['nope'] }, { from: '2026-13-45' }, { categories: [-1] }, { clientId: 'one' },
    { people: Array.from({ length: 51 }, (_, i) => i + 1) },
    { categories: [32768] }, { categories: [2 ** 31] }, { clientId: 32768 }, { clientId: '99999999999' },
    { people: [Number.MAX_SAFE_INTEGER + 2] },
    { q: 'hu\u0000g' }, { q: 'hug\u0007' }, { q: 'line\nbreak' }, { q: 'tab\there' }, { q: 'del\u007f' },
    { eventSlug: 'a\u0000b' }, { accountHandle: 'tl_\u001fgamma' }, { from: '2026-01-01\u0000' },
  ];
  for (const params of bad) {
    await assert.rejects(search(deps, params), BadRequest, JSON.stringify(params));
  }
  const accented = 'é'; // two code points, one after NFC
  await assert.rejects(search(deps, { q: accented }), BadRequest);
});

test('removed, opted-out and blocked-submitter items never appear', async () => {
  const longId = await itemIdOf(deps.db, IDS.LONG);
  await deps.db.transaction((/** @type {any} */ tx) => tx.query("insert into users (id, display_name) values ('member-b', 'b')"), SYSTEM);
  const byMember = await ingest(deps, IDS.EDITED_OLD, { actor: 'member-b' });
  assert.equal(byMember.status, 'added');
  assert.equal((await search(deps, { q: 'fanmeet' })).count, 1, 'visible before the block');
  await deps.db.transaction(async (/** @type {any} */ tx) => {
    await tx.query("update items set deleted_at = now(), deleted_reason = 'removed_by_account' where id = $1", [longId]);
    await tx.query("update accounts set opted_out_at = now() where handle = 'tl_gamma'");
    await tx.query("update users set blocked_at = now() where id = 'member-b'");
  }, SYSTEM);
  try {
    const all = await ids({ limit: 50 });
    for (const hidden of [IDS.LONG, IDS.EVENT_B, IDS.EDITED_NEW]) assert.ok(!all.includes(hidden), hidden);
    assert.equal(all.length, 7);
    assert.equal((await search(deps, { q: 'hug' })).count, 0);
    assert.equal((await search(deps, { q: 'tl_gamma' })).count, 0);
    assert.equal((await search(deps, { q: 'fanmeet' })).count, 0);
  } finally {
    // the blocked member stays blocked: their item stays hidden for the tests below
    await deps.db.transaction(async (/** @type {any} */ tx) => {
      await tx.query('update items set deleted_at = null, deleted_reason = null where id = $1', [longId]);
      await tx.query("update accounts set opted_out_at = null where handle = 'tl_gamma'");
    }, SYSTEM);
  }
});

test('injection-shaped and wildcard queries match nothing and change nothing', async () => {
  const before = (await rows(deps.db, 'select count(*)::int as n from items'))[0].n;
  for (const q of ["'; drop table items; --", "' or 1=1 --", '%%', '__', '\\%']) {
    assert.equal((await search(deps, { q })).count, 0, q);
  }
  assert.equal((await rows(deps.db, 'select count(*)::int as n from items'))[0].n, before);
});
