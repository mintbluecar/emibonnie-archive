// @ts-check
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { IDS } from '../../helpers/fixtures.js';
import { seededDeps, itemIdOf, SYSTEM } from '../../helpers/ingest.js';
import { itemView } from '../../../src/services/hubs.js';
import { previewsFor, presenterContext } from '../../../src/services/cards.js';
import { addParts } from '../../../src/kinds/translation/repo.js';
import translation from '../../../src/kinds/translation/index.js';

/** @type {any} */
let deps;
before(async () => { deps = await seededDeps(); });
after(async () => { await deps.db.end(); });

/** @param {string} sourceId */
async function previewOf(sourceId) {
  const ctx = await presenterContext(deps);
  const [entry] = await previewsFor(deps, [await itemIdOf(deps.db, sourceId)], ctx);
  return /** @type {any} */ (entry.preview);
}

/** @param {string} sourceId */
async function detailOf(sourceId) {
  return /** @type {any} */ (await itemView(deps, 'translation', sourceId));
}

test("LONG's preview: the first 2 speech bubbles, the host's standard emoji first", async () => {
  const preview = await previewOf(IDS.LONG);
  assert.equal(preview.kind, 'translation');
  assert.equal(preview.sourceId, IDS.LONG);
  assert.equal(preview.url, `/t/${IDS.LONG}`);
  assert.equal(preview.accountHandle, 'tl_alpha');
  assert.equal(preview.hasVideo, true);
  assert.equal(preview.followsOnFrom, null);
  assert.equal(preview.lines.length, 2);
  assert.deepEqual(preview.lines[0], {
    kind: 'speech', emoji: '🦁', name: 'host', colour: '#b5651d',
    text: 'Can you tell everyone what it felt like when the lights went down for the countdown?', cont: false,
  });
  assert.deepEqual({ ...preview.lines[1], text: undefined }, { kind: 'speech', emoji: '🌧️', name: 'fan', text: undefined, cont: false });
  assert.deepEqual(preview.people.map((/** @type {any} */ p) => p.name).sort(), ['host', 'luna', 'sol']);
  const luna = preview.people.find((/** @type {any} */ p) => p.name === 'luna');
  assert.deepEqual(Object.keys(luna).sort(), ['colour', 'emoji', 'id', 'igHandle', 'name']);
  assert.equal(luna.igHandle, 'lunamoon');
});

test('a mapped 🐱 shows the standard 🌙, named luna, in her colour; a generic role keeps the translator\'s emoji and has no colour', async () => {
  const { bubbles } = await detailOf(IDS.LONG);
  const cat = bubbles.find((/** @type {any} */ b) => b.text === 'Same here, honestly, and I was on the opposite side of the stage.');
  assert.deepEqual(cat, { kind: 'speech', emoji: '🌙', name: 'luna', colour: '#6a5cd6', text: cat.text, cont: false });
  const fan = bubbles.find((/** @type {any} */ b) => b.emoji === '🌧️');
  assert.equal(fan.name, 'fan');
  assert.equal('colour' in fan, false);
});

test('consecutive lines by the same speaker set cont; crowd lines are crowd bubbles; footnotes are notes at the end', async () => {
  const { bubbles } = await detailOf(IDS.LONG);
  const rain = bubbles.filter((/** @type {any} */ b) => b.emoji === '🌧️');
  assert.deepEqual(rain.map((/** @type {any} */ b) => b.cont), [false, true]);
  assert.deepEqual(bubbles.find((/** @type {any} */ b) => b.kind === 'crowd'), { kind: 'crowd', text: 'Ahhh~' });
  const notes = bubbles.slice(-2);
  assert.deepEqual(notes.map((/** @type {any} */ b) => [b.kind, b.mark]), [['note', '*'], ['note', '**']]);
  assert.equal(bubbles[0].kind, 'plain');
  assert.equal(bubbles[0].text, 'SOLLUNA AT STARFEST');
});

test("EVENT_B's HTML-looking line stays raw text (escaping is the page's job)", async () => {
  const { bubbles, original } = await detailOf(IDS.EVENT_B);
  assert.ok(bubbles.some((/** @type {any} */ b) => b.text === "it's always you <b>&amp;</b> me, right?"));
  assert.ok(original.includes('<b>&amp;</b>'));
});

test('detail: cast, original, credits, sources; media prefers the own video', async () => {
  const view = await detailOf(IDS.EVENT_A);
  assert.deepEqual(view.cast.map((/** @type {any} */ c) => [c.kind, c.name, c.emoji]), [['person', 'sol', '☀️'], ['person', 'luna', '🌙']]);
  assert.equal(view.credits.account.handle, 'tl_beta');
  assert.equal(view.credits.clipBy, 'clipper_one');
  assert.equal(view.credits.occurredOn, '2026-10-19');
  assert.equal(view.credits.postedAt, '2026-10-19T08:00:00.000Z');
  assert.ok(view.original.startsWith('SOLLUNA HAPPY DAY'));
  assert.deepEqual(view.sources.map((/** @type {any} */ s) => s.role), ['primary', 'media']);
  assert.equal(view.media.type, 'video');
  assert.equal(view.media.width, 1280);
  assert.equal(view.media.height, 720);
  assert.ok(view.media.variants.every((/** @type {any} */ v) => new URL(v.url).hostname === 'video.twimg.com'));
  assert.deepEqual(Object.keys(view.media).sort(), ['height', 'type', 'variants', 'width']);
});

test('media: own images, then the quote card (with the quoted pictures inside), else null', async () => {
  const photo = await detailOf(IDS.PHOTO);
  assert.equal(photo.media.type, 'images');
  assert.equal(photo.media.images.length, 2);
  assert.equal(photo.credits.clipBy, null);

  const post = await detailOf(IDS.POST);
  assert.equal(post.media.type, 'quote');
  assert.equal(post.media.authorHandle, 'solsunny_x');
  assert.equal(post.media.text, 'คิดถึงเธอทุกวันเลยช่วงนี้ ดูแลตัวเองดี ๆ นะ');
  assert.equal(post.media.postedAt, '2026-10-19T09:00:00.000Z');
  assert.equal(post.media.inner.type, 'images');
  assert.equal(post.media.inner.images.length, 1);

  assert.equal((await detailOf(IDS.THREAD)).media, null);
});

test('media is shown only while its source is live; the quote card always shows, its pictures only while live', async () => {
  const longId = await itemIdOf(deps.db, IDS.LONG);
  const postId = await itemIdOf(deps.db, IDS.POST);
  await deps.db.transaction(async (/** @type {any} */ tx) => {
    await tx.query("update item_sources set status = 'deleted' where item_id = $1 and role = 'media'", [longId]);
    await tx.query("update item_sources set status = 'unavailable' where item_id = $1 and role = 'quoted'", [postId]);
  }, SYSTEM);
  try {
    const long = await detailOf(IDS.LONG);
    assert.equal(long.media.type, 'quote', 'the clip is gone, so the quoted teaser shows');
    assert.equal(long.media.inner, null);
    assert.equal((await previewOf(IDS.LONG)).hasVideo, false);
    const post = await detailOf(IDS.POST);
    assert.equal(post.media.type, 'quote');
    assert.equal(post.media.inner, null);
  } finally {
    await deps.db.transaction(async (/** @type {any} */ tx) => {
      await tx.query("update item_sources set status = 'live' where item_id = any($1::bigint[])", [[longId, postId]]);
    }, SYSTEM);
  }
});

test('a marker the item never mapped (from an attached follow-up) is a neutral speech bubble with the translator\'s own emoji', async () => {
  const threadId = await itemIdOf(deps.db, IDS.THREAD);
  await deps.db.transaction((/** @type {any} */ tx) => addParts(tx, threadId, [
    { sourceId: null, body: '🐸: a line nobody mapped\n🐸: and another' },
  ]), SYSTEM);
  const { bubbles } = await detailOf(IDS.THREAD);
  const frog = bubbles.filter((/** @type {any} */ b) => b.emoji === '🐸');
  assert.deepEqual(frog, [
    { kind: 'speech', emoji: '🐸', name: null, text: 'a line nobody mapped', cont: false },
    { kind: 'speech', emoji: '🐸', name: null, text: 'and another', cont: true },
  ]);
});

test('a post with no speech lines previews its first 2 plain lines that are not header', async () => {
  const preview = await previewOf(IDS.POST);
  assert.deepEqual(preview.lines, [{ kind: 'plain', text: "translation: can't stop thinking about you these past few days, take care of yourself okay?" }]);
  assert.equal(preview.hasVideo, false);
});

test('search.matchLines returns the verbatim lines containing q (case-insensitive), at most 3', () => {
  const details = { body: 'SOME HEADER\n\n🐱: Come and hug me.**\n🐶: We hug all the time anyway!\n🐱: We HUG all the time.\n🐶: hug hug' };
  assert.deepEqual(translation.search.matchLines(details, 'hug'), ['🐱: Come and hug me.**', '🐶: We hug all the time anyway!', '🐱: We HUG all the time.']);
  assert.deepEqual(translation.search.matchLines(details, 'nothing'), []);
});

test('search.textClause and rank only interpolate their placeholder index', () => {
  assert.match(translation.search.textClause(3), /\$3\b/);
  assert.match(translation.search.rank(4), /similarity\(.*\$4\)/);
  assert.throws(() => translation.search.textClause(/** @type {any} */ ('1; drop table items')), /index/);
});
