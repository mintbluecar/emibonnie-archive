// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IDS } from '../../helpers/fixtures.js';
import { ingestDeps, ingest, ingestLong, rows, count, patchedFetch, sourcesOf } from '../../helpers/ingest.js';
import { kindsRegistry } from '../../../src/kinds/_registry.js';
import { sourceState } from '../../../src/repo/items.js';
import { runSeedDev } from '../../../scripts/seedDev.js';

const translation = kindsRegistry.translation;

/** @param {any} db @param {number} itemId */
async function partsOf(db, itemId) {
  return rows(db, 'select position, body, source_id from translation_parts where item_id = $1 order by position', [itemId]);
}

test('POST is a post by sol with the quoted original archived; PHOTO keeps its 2 pictures', async () => {
  const deps = await ingestDeps();
  try {
    const post = await ingest(deps, IDS.POST);
    const [item] = await rows(deps.db, 'select placement from items where id = $1', [post.itemId]);
    assert.equal(item.placement, 'post');
    const people = await rows(deps.db, `select p.display_name, ip.role from item_people ip join people p on p.id = ip.person_id
      where ip.item_id = $1`, [post.itemId]);
    assert.deepEqual(people, [{ display_name: 'sol', role: 'author' }]);
    const quoted = (await sourcesOf(deps.db, /** @type {number} */ (post.itemId))).filter((s) => s.role === 'quoted');
    assert.equal(quoted.length, 1);
    assert.equal(quoted[0].external_id, IDS.POST_QUOTED);
    assert.equal(quoted[0].media.text, 'คิดถึงเธอทุกวันเลยช่วงนี้ ดูแลตัวเองดี ๆ นะ');
    assert.equal(quoted[0].media.images.length, 1);
    assert.equal(await sourceState(deps.db, 'translation', 'x', IDS.POST_QUOTED), 'none', 'a quoted original is not archived as a source');

    const photo = await ingest(deps, IDS.PHOTO);
    const media = (await sourcesOf(deps.db, /** @type {number} */ (photo.itemId))).filter((s) => s.role === 'media');
    assert.equal(media.length, 1);
    assert.equal(media[0].media.images.length, 2);
  } finally {
    await deps.db.end();
  }
});

test('THREAD stores one follow-up source and two parts linked to their sources', async () => {
  const deps = await ingestDeps();
  try {
    const { itemId } = await ingest(deps, IDS.THREAD);
    const sources = await sourcesOf(deps.db, /** @type {number} */ (itemId));
    assert.deepEqual(sources.filter((s) => s.role === 'follow_up').map((s) => [s.external_id, s.position]), [[IDS.THREAD_FOLLOWUP, 1]]);
    const parts = await partsOf(deps.db, /** @type {number} */ (itemId));
    assert.deepEqual(parts.map((p) => p.position), [0, 1]);
    assert.ok(parts[1].body.startsWith('The list in the pic'));
    assert.ok(parts.every((p) => p.source_id !== null));
  } finally {
    await deps.db.end();
  }
});

test('a pasted follow-up is attached: an archived one is a no-op, a new same-author reply becomes the next part', async () => {
  const deps = await ingestDeps();
  try {
    const thread = await ingest(deps, IDS.THREAD);
    assert.deepEqual(await ingest(deps, IDS.THREAD_FOLLOWUP), { status: 'attached', sourceId: IDS.THREAD_FOLLOWUP, itemId: thread.itemId });
    assert.equal(await count(deps.db, 'select count(*)::int as n from items'), 1);
    assert.equal((await partsOf(deps.db, /** @type {number} */ (thread.itemId))).length, 2);

    assert.deepEqual(await ingest(deps, IDS.THREAD_REPLY), { status: 'attached', sourceId: IDS.THREAD_REPLY, itemId: thread.itemId });
    const parts = await partsOf(deps.db, /** @type {number} */ (thread.itemId));
    assert.deepEqual(parts.map((p) => p.position), [0, 1, 2]);
    assert.ok(parts[2].body.startsWith('One more: the lanterns'));
    const followUps = (await sourcesOf(deps.db, /** @type {number} */ (thread.itemId))).filter((s) => s.role === 'follow_up');
    assert.deepEqual(followUps.map((s) => [s.external_id, s.position]), [[IDS.THREAD_FOLLOWUP, 1], [IDS.THREAD_REPLY, 2]]);
    assert.equal((await ingest(deps, IDS.THREAD_REPLY)).status, 'attached');

    const other = await ingest(deps, IDS.THREAD_OTHER);
    assert.equal(other.status, 'added', 'a reply by another account is its own item');
    assert.notEqual(other.itemId, thread.itemId);
  } finally {
    await deps.db.end();
  }
});

test('an edited post is archived at its latest version, every version id resolves to it', async () => {
  const deps = await ingestDeps();
  try {
    const result = await ingest(deps, IDS.EDITED_OLD);
    assert.equal(result.status, 'added');
    const [primary] = (await sourcesOf(deps.db, /** @type {number} */ (result.itemId))).filter((s) => s.role === 'primary');
    assert.equal(primary.external_id, IDS.EDITED_NEW);
    assert.equal(new Date(primary.editable_until).toISOString(), '2026-10-14T00:00:00.000Z');
    const aliases = await rows(deps.db, 'select external_id from source_aliases order by external_id');
    assert.deepEqual(aliases.map((r) => r.external_id), [IDS.EDITED_OLD, IDS.EDITED_NEW]);
    assert.equal((await ingest(deps, IDS.EDITED_OLD)).status, 'duplicate');
    assert.equal((await ingest(deps, IDS.EDITED_NEW)).status, 'duplicate');
  } finally {
    await deps.db.end();
  }
});

test('every tweet source gets an alias row for its own id', async () => {
  const deps = await ingestDeps();
  try {
    await ingest(deps, IDS.THREAD);
    const aliases = await rows(deps.db, 'select external_id from source_aliases order by external_id');
    assert.deepEqual(aliases.map((r) => r.external_id), [IDS.THREAD, IDS.THREAD_FOLLOWUP]);
  } finally {
    await deps.db.end();
  }
});

test('a self-quote links follows_on to the archived original', async () => {
  const deps = await ingestDeps();
  try {
    const original = await ingest(deps, IDS.LONG_QUOTED);
    assert.equal(original.status, 'added');
    const long = await ingestLong(deps);
    const links = await rows(deps.db, 'select to_item_id, relation from item_links where from_item_id = $1', [long.itemId]);
    assert.deepEqual(links, [{ to_item_id: original.itemId, relation: 'follows_on' }]);
  } finally {
    await deps.db.end();
  }
});

test('translation.loadDetails returns parts, the joined body, speakers and sources', async () => {
  const deps = await ingestDeps();
  try {
    const { itemId } = await ingest(deps, IDS.THREAD);
    const id = /** @type {number} */ (itemId);
    const details = /** @type {any} */ ((await translation.loadDetails(deps.db, [id, 999999])).get(id));
    assert.equal(details.parts.length, 2);
    assert.equal(details.body, details.parts.join('\n\n'));
    assert.ok('🌙' in details.speakers);
    assert.deepEqual(details.sources.map((/** @type {any} */ s) => s.role), ['primary', 'follow_up']);
    assert.equal((await translation.loadDetails(deps.db, [999999])).size, 0);
  } finally {
    await deps.db.end();
  }
});

test('seed-dev ingests the 9 listed posts of the example site', async () => {
  const deps = await ingestDeps();
  try {
    /** @type {string[]} */
    const lines = [];
    const results = await runSeedDev({ siteDir: 'examples/solluna', db: deps.db, log: (line) => lines.push(line) });
    assert.equal(results.length, 9);
    assert.ok(lines.includes('seeded 9'), lines.join('\n'));
  } finally {
    await deps.db.end();
  }
});

test('an attached reply aliases every version id it has had', async () => {
  const OLDER = '1900000000000000019';
  const { fetchImpl } = patchedFetch((kind, id, json) => (kind === 'syn' && id === IDS.THREAD_REPLY
    ? { ...json, edit_control: { edit_tweet_ids: [OLDER, IDS.THREAD_REPLY], editable_until_msecs: String(Date.parse('2026-10-20T13:00:00Z')) } }
    : json));
  const deps = await ingestDeps({ fetchImpl });
  try {
    const thread = await ingest(deps, IDS.THREAD);
    assert.equal((await ingest(deps, IDS.THREAD_REPLY)).status, 'attached');
    assert.deepEqual(await ingest(deps, OLDER), { status: 'attached', sourceId: OLDER, itemId: thread.itemId });
  } finally {
    await deps.db.end();
  }
});
