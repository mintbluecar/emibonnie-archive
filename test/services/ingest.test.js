// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IDS } from '../helpers/fixtures.js';
import { ingestDeps, ingest, ingestLong, rows, count, SYSTEM, HOST } from '../helpers/ingest.js';
import { kindsRegistry } from '../../src/kinds/_registry.js';
import { createPeople } from '../../src/services/intakeRefs.js';
import { sourceState } from '../../src/repo/items.js';
import { set as setSetting } from '../../src/repo/settings.js';
import { runSeedDev } from '../../scripts/seedDev.js';

const translation = kindsRegistry.translation;

/** @param {any} db @param {number} itemId */
async function sourcesOf(db, itemId) {
  return rows(db, `select s.role, s.position, s.external_id, s.media, s.editable_until, a.handle
    from item_sources s left join accounts a on a.id = s.account_id where s.item_id = $1 order by s.role, s.position`, [itemId]);
}

/** @param {any} db @param {number} itemId */
async function partsOf(db, itemId) {
  return rows(db, 'select position, body, source_id from translation_parts where item_id = $1 order by position', [itemId]);
}

test('speakers carry over between tweets by the same translator', async () => {
  const deps = await ingestDeps();
  try {
    const first = await ingest(deps, IDS.LONG);
    assert.equal(first.status, 'needs_speakers');
    assert.deepEqual(first.missing?.map((/** @type {any} */ m) => m.marker), ['🦁', '🌧️', '🐶', '🐱']);
    assert.equal(await count(deps.db, 'select count(*)::int as n from items'), 0);

    const long = await ingestLong(deps);
    assert.equal(long.status, 'added');
    const speakers = await rows(deps.db, 'select marker from translation_speakers where item_id = $1 order by marker', [long.itemId]);
    assert.deepEqual(speakers.map((r) => r.marker).sort(), ['🌧️', '🐱', '🐶', '🗣️', '🦁'].sort());

    const live = await ingest(deps, IDS.LIVE);
    assert.equal(live.status, 'added', `LIVE should not need 🐱 again: ${JSON.stringify(live.missing)}`);
  } finally {
    await deps.db.end();
  }
});

test('EVENT_A then EVENT_B land in one event, with one hashtag row and two item_tags', async () => {
  const deps = await ingestDeps();
  try {
    const a = await ingest(deps, IDS.EVENT_A);
    const b = await ingest(deps, IDS.EVENT_B);
    assert.equal(a.status, 'added');
    assert.equal(b.status, 'added');
    assert.equal(a.eventId, b.eventId);
    assert.equal(await count(deps.db, 'select count(*)::int as n from events'), 1);
    const tags = await rows(deps.db, "select id from tags where kind = 'hashtag' and norm = 'slhappyday2026'");
    assert.equal(tags.length, 1);
    assert.equal(await count(deps.db, 'select count(*)::int as n from item_tags where tag_id = $1', [tags[0].id]), 2);
  } finally {
    await deps.db.end();
  }
});

test('EVENT_A stores a media source credited to the clipper, with the video.twimg.com variants', async () => {
  const deps = await ingestDeps();
  try {
    const { itemId } = await ingest(deps, IDS.EVENT_A);
    const media = (await sourcesOf(deps.db, /** @type {number} */ (itemId))).filter((s) => s.role === 'media');
    assert.equal(media.length, 1);
    assert.equal(media[0].handle, 'clipper_one');
    assert.equal(media[0].external_id, '1800000000000000001');
    const variants = media[0].media.variants;
    assert.ok(variants.length > 0);
    assert.ok(variants.every((/** @type {any} */ v) => new URL(v.url).hostname === 'video.twimg.com'));
  } finally {
    await deps.db.end();
  }
});

test('JOINT_LIVE creates an event with two live people', async () => {
  const deps = await ingestDeps();
  try {
    const result = await ingest(deps, IDS.JOINT_LIVE);
    assert.equal(result.status, 'added');
    assert.equal(await count(deps.db, 'select count(*)::int as n from event_people where event_id = $1', [result.eventId]), 2);
  } finally {
    await deps.db.end();
  }
});

test('SHARED with 🪇 as a speaker is a shared story with no event, and only sharing/about people', async () => {
  const deps = await ingestDeps();
  try {
    const result = await ingest(deps, IDS.SHARED, { chosen: { '🪇': { role: 'speaker' } } });
    assert.equal(result.status, 'added');
    const [item] = await rows(deps.db, 'select placement, event_id from items where id = $1', [result.itemId]);
    assert.equal(item.placement, 'shared_story');
    assert.equal(item.event_id, null);
    const roles = await rows(deps.db, 'select role from item_people where item_id = $1', [result.itemId]);
    assert.ok(roles.every((r) => r.role === 'sharing' || r.role === 'about'));
  } finally {
    await deps.db.end();
  }
});

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

test('createPeople skips a known handle', async () => {
  const deps = await ingestDeps();
  try {
    assert.equal(await createPeople(deps, [HOST], SYSTEM), 1);
    assert.equal(await createPeople(deps, [HOST], SYSTEM), 0);
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
