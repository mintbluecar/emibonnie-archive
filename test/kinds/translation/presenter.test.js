// @ts-check
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { IDS } from '../../helpers/fixtures.js';
import { seededDeps, itemIdOf, SYSTEM, ingestDeps, ingest } from '../../helpers/ingest.js';
import { itemView } from '../../../src/services/itemView.js';
import { previewsFor, presenterContext } from '../../../src/services/cards.js';
import { addParts, setSpeakers } from '../../../src/kinds/translation/repo.js';
import { resolveSpeakerRefs } from '../../../src/services/intakeRefs.js';
import translation from '../../../src/kinds/translation/index.js';

/** @type {any} */
let deps;
before(async () => { deps = await seededDeps(); });
after(async () => { await deps.db.end(); });

/**
 * A fresh, isolated item (its own db) with four joint lines: two generic
 * 'host' markers (twice, to check continuation), two known people (sol &
 * luna), one with a never-mapped component, and one with a crowd
 * component. Task 7b (joint speaker lines).
 * @returns {Promise<{ jointDeps: any, view: any }>}
 */
async function jointLinesFixture() {
  const jointDeps = await ingestDeps();
  const refs = {
    '💬': { role: 'fan' }, '🪇': { role: 'host' },
    '👦🏻': { role: 'host' }, '👩🏻': { role: 'host' },
    '☀️': { person: 'solsunny' }, '🌙': { person: 'lunamoon' },
    '🗣️': { role: 'crowd' },
  };
  const chosen = await resolveSpeakerRefs(jointDeps.db, refs);
  const result = await ingest(jointDeps, IDS.SHARED, { chosen });
  const itemId = /** @type {number} */ (result.itemId);
  const body = [
    '👦🏻👩🏻: joint hosts, line one',
    '👦🏻👩🏻: joint hosts, line two (same speakers, should collapse)',
    '☀️🌙: joint known people',
    '🐸👦🏻: one component never mapped',
    '🗣️👦🏻: one component is crowd',
  ].join('\n');
  await jointDeps.db.transaction((/** @type {any} */ tx) => addParts(tx, itemId, [{ sourceId: null, body }]), SYSTEM);
  await jointDeps.db.transaction((/** @type {any} */ tx) => setSpeakers(tx, itemId, chosen), SYSTEM);
  const view = await itemView(jointDeps, 'translation', IDS.SHARED);
  return { jointDeps, view };
}

/** @type {any} */
let jointDeps;
/** @type {any} */
let jointView;
before(async () => { ({ jointDeps, view: jointView } = await jointLinesFixture()); });
after(async () => { await jointDeps.db.end(); });

/** @param {any[]} bubbles @param {string} text */
function jointBubbleFor(bubbles, text) {
  return bubbles.find((/** @type {any} */ b) => b.kind === 'joint' && b.text === text);
}

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
  assert.ok(!('postedAt' in view.credits), 'no post time in the item view (Task 10b, M7)');
  assert.ok(view.original.startsWith('SOLLUNA HAPPY DAY'));
  assert.deepEqual(view.sources.map((/** @type {any} */ s) => s.role), ['primary', 'media']);
  assert.equal(view.media.type, 'video');
  assert.equal(view.media.width, 1280);
  assert.equal(view.media.height, 720);
  assert.ok(view.media.variants.every((/** @type {any} */ v) => new URL(v.url).hostname === 'video.twimg.com'));
  assert.deepEqual(Object.keys(view.media).sort(), ['height', 'poster', 'type', 'variants', 'width']);
  assert.match(view.media.poster, /^https:\/\/pbs\.twimg\.com\//, 'the clip\'s still, for the box before play (Task 9b)');
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

test('a joint line of two markers both mapped to the generic "host" role is one neutral bubble, both named "host"', () => {
  const bubble = jointBubbleFor(jointView.bubbles, 'joint hosts, line one');
  assert.equal(bubble.kind, 'joint');
  assert.equal('colour' in bubble, false);
  assert.deepEqual(bubble.parts, [{ emoji: '👦🏻', name: 'host' }, { emoji: '👩🏻', name: 'host' }]);
});

test('a joint line of two known people is one neutral bubble, no colour', () => {
  const bubble = jointBubbleFor(jointView.bubbles, 'joint known people');
  assert.equal('colour' in bubble, false);
  assert.deepEqual(bubble.parts, [{ emoji: '☀️', name: 'sol' }, { emoji: '🌙', name: 'luna' }]);
});

test('a joint line\'s never-mapped component gets the same treatment as an unmapped single marker: its own emoji, name: null', () => {
  const bubble = jointBubbleFor(jointView.bubbles, 'one component never mapped');
  assert.deepEqual(bubble.parts, [{ emoji: '🐸', name: null }, { emoji: '👦🏻', name: 'host' }]);
});

test('a joint line\'s crowd component stays in the bubble, labelled with the crowd role name (not a kind: \'crowd\' bubble)', () => {
  const bubble = jointBubbleFor(jointView.bubbles, 'one component is crowd');
  assert.deepEqual(bubble.parts, [{ emoji: '🗣️', name: 'crowd' }, { emoji: '👦🏻', name: 'host' }]);
});

test('consecutive identical joint lines collapse the same way single speakers do (cont, keyed on the whole joint)', () => {
  const first = jointBubbleFor(jointView.bubbles, 'joint hosts, line one');
  const second = jointBubbleFor(jointView.bubbles, 'joint hosts, line two (same speakers, should collapse)');
  assert.equal(first.cont, false);
  assert.equal(second.cont, true);
});

test('cast (review round 1, M5): a component that only ever speaks inside a joint line still appears, deduped, in order of first appearance; crowd (🗣️) and the never-mapped 🐸 stay out, as usual', () => {
  assert.deepEqual(jointView.cast.map((/** @type {any} */ c) => [c.emoji, c.name]), [
    ['💬', 'fan'],
    ['🪇', 'host'],
    ['👦🏻', 'host'],
    ['👩🏻', 'host'],
    ['☀️', 'sol'],
    ['🌙', 'luna'],
  ]);
});

/**
 * A bare-bones `PresentContext` for calling `translation.present.preview`
 * directly, with no DB (review round 1, I2's preview tests): the bug it
 * covers is entirely inside `previewLines`'s speech filter, so there's
 * no need to round-trip through ingest/review-state at all.
 */
function fakePreviewCtx() {
  return { urlFor: (/** @type {string} */ kind, /** @type {string} */ id) => `/${kind}/${id}`, chips: () => [], people: new Map(), formatName: (/** @type {string} */ n) => n };
}

test('preview (review round 1, I2): an item that opens with a joint line gets a non-empty preview including it', () => {
  const details = { body: '👦🏻👩🏻: hi everyone\n👦🏻: a solo line after', speakers: { '👦🏻': { role: 'host' }, '👩🏻': { role: 'host' } }, sources: [] };
  const card = { sourceId: 'x', followsOn: null, people: [], account: null };
  const preview = /** @type {any} */ (translation.present.preview(card, details, fakePreviewCtx()));
  assert.ok(preview.lines.length > 0, 'non-empty preview');
  assert.equal(preview.lines[0].kind, 'joint');
});

test('preview (review round 1, I2): an item whose only speech is a joint line still gets a non-empty preview, not the plain-line fallback', () => {
  const details = { body: 'SOME HEADER\n\n👦🏻👩🏻: only joint speaker here', speakers: { '👦🏻': { role: 'host' }, '👩🏻': { role: 'host' } }, sources: [] };
  const card = { sourceId: 'x', followsOn: null, people: [], account: null };
  const preview = /** @type {any} */ (translation.present.preview(card, details, fakePreviewCtx()));
  assert.ok(preview.lines.length > 0, 'non-empty preview');
  assert.ok(preview.lines.some((/** @type {any} */ l) => l.kind === 'joint'));
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

test('search.matchLines with the present context shows each speaker as the item page does: a known person\'s standard emoji, a role\'s own marker (Task 9a item 4)', () => {
  const people = new Map([[1, { id: 1, emoji: '☀️', displayName: 'Sol', colour: '#d9a400', igHandle: 'solsunny' }]]);
  const ctx = /** @type {any} */ ({ people, formatName: (/** @type {string} */ n) => n.toLowerCase() });
  const details = {
    body: 'A HEADER about hugs\n🐶: a hug from sol\n🌧️: a fan wants a hug\n🐶🌧️: hug together\n🐸: an unmapped hug',
    speakers: { '🐶': { person: 1 }, '🌧️': { role: 'fan' } },
  };
  assert.deepEqual(translation.search.matchLines(details, 'hug', ctx), [
    'A HEADER about hugs', '☀️ a hug from sol', '🌧️ a fan wants a hug',
  ]);
  assert.deepEqual(translation.search.matchLines({ ...details, body: '🐶🌧️: hug together\n🐸: an unmapped hug' }, 'hug', ctx), [
    '☀️🌧️ hug together', '🐸 an unmapped hug',
  ]);
});

test('search.textClause and rank only interpolate their placeholder index', () => {
  assert.match(translation.search.textClause(3), /\$3\b/);
  assert.match(translation.search.rank(4), /word_similarity\(\$4, tp\.body\)/);
  assert.throws(() => translation.search.textClause(/** @type {any} */ ('1; drop table items')), /index/);
});

/** @param {string} handle @param {boolean} out */
async function setOptedOut(handle, out) {
  await deps.db.transaction((/** @type {any} */ tx) => tx.query(
    `update accounts set opted_out_at = ${out ? 'now()' : 'null'} where platform = 'x' and handle = $1`, [handle],
  ), SYSTEM);
}

test('an opted-out clipper vanishes from the item: no handle, no clip, media null', async () => {
  await setOptedOut('clipper_one', true);
  try {
    const view = await detailOf(IDS.EVENT_A);
    const json = JSON.stringify(view);
    assert.ok(!json.includes('clipper_one'), json);
    assert.ok(!json.includes('video.twimg.com'), 'no media URL');
    assert.ok(!json.includes('1900000000000000091'), 'no media source id');
    assert.equal(view.media, null);
    assert.equal(view.credits.clipBy, null);
    assert.deepEqual(view.sources.map((/** @type {any} */ s) => s.role), ['primary']);
    assert.equal((await previewOf(IDS.EVENT_A)).hasVideo, false);
    assert.ok(view.bubbles.length > 0, 'the translation itself stays');
  } finally {
    await setOptedOut('clipper_one', false);
  }
});

test('an opted-out quoted author vanishes: no quote card, no handle anywhere', async () => {
  await setOptedOut('solsunny_x', true);
  try {
    const view = await detailOf(IDS.POST);
    const json = JSON.stringify(view);
    assert.equal(view.media, null);
    assert.ok(!json.includes('solsunny_x'), json);
    assert.ok(!json.includes('คิดถึงเธอ'), 'no quoted text');
    assert.ok(!JSON.stringify(await previewOf(IDS.POST)).includes('solsunny_x'));
  } finally {
    await setOptedOut('solsunny_x', false);
  }
});

test('search.matchLines (Task 9b): a long matching line is trimmed to a window around the match, the speaker emoji kept in front', () => {
  const people = new Map([[1, { id: 1, emoji: '☀️', displayName: 'Sol', colour: '#d9a400', igHandle: 'solsunny' }]]);
  const ctx = /** @type {any} */ ({ people, formatName: (/** @type {string} */ n) => n.toLowerCase() });
  const long = `${'so many things happened before my eyes that night, '.repeat(4)}and then she hugged me in front of everyone ${'and we all cried about it for hours afterwards. '.repeat(3)}`;
  const [line] = translation.search.matchLines({ body: `🐶: ${long}`, speakers: { '🐶': { person: 1 } } }, 'hug', ctx);
  assert.ok(line.startsWith('☀️ …'), line);
  assert.ok(line.endsWith('…'), line);
  assert.match(line, /she hugged me/);
  assert.ok([...line].length < 130, `${[...line].length}`);
});

test('Task 10c (a): a bare ":" mapped to role fan is a neutral bubble named "fan" with the role\'s default 💬 (the translator gave no emoji)', () => {
  const details = { body: ': hello there, I have news\n💜: really?', speakers: { ':': { role: 'fan' } }, sources: [] };
  const card = { sourceId: 'x', followsOn: null, people: [], account: null };
  const preview = /** @type {any} */ (translation.present.preview(card, details, fakePreviewCtx()));
  assert.deepEqual(preview.lines[0], { kind: 'speech', emoji: '💬', name: 'fan', text: 'hello there, I have news', cont: false });
  assert.ok(!('colour' in preview.lines[0]), 'neutral: no person colour');
});

test('Task 10c (a): role defaults are 💬 fan, 🎤 host, 🗣 speaker, only for a bare ":"; a translator emoji wins; crowd stays a note; the cast and joint parts agree', () => {
  const ctx = fakePreviewCtx();
  for (const [role, emoji] of [['fan', '💬'], ['host', '🎤'], ['speaker', '🗣']]) {
    const view = /** @type {any} */ (translation.present.detail(/** @type {any} */ ({ account: null }), { body: ': hi', speakers: { ':': { role } }, sources: [] }, ctx));
    assert.equal(view.bubbles[0].emoji, emoji, role);
    assert.deepEqual(view.cast, [{ kind: 'role', role, emoji, name: role }]);
  }
  const own = /** @type {any} */ (translation.present.detail(/** @type {any} */ ({ account: null }), { body: '👩🏻: hi\n:: joint', speakers: { '👩🏻': { role: 'host' } }, sources: [] }, ctx));
  assert.equal(own.bubbles[0].emoji, '👩🏻', 'the translator\'s own emoji wins');
  const crowd = /** @type {any} */ (translation.present.detail(/** @type {any} */ ({ account: null }), { body: ': wooo', speakers: { ':': { role: 'crowd' } }, sources: [] }, ctx));
  assert.deepEqual(crowd.bubbles[0], { kind: 'crowd', text: 'wooo' });
  assert.deepEqual(crowd.cast, []);
});

test('Task 10c (a): ctx.roleEmoji (the site\'s roleEmoji over ROLE_EMOJI) overrides a default', () => {
  const ctx = { ...fakePreviewCtx(), roleEmoji: { fan: '💬', host: '🎙️', speaker: '🗣' } };
  const view = /** @type {any} */ (translation.present.detail(/** @type {any} */ ({ account: null }), { body: ': hi', speakers: { ':': { role: 'host' } }, sources: [] }, ctx));
  assert.equal(view.bubbles[0].emoji, '🎙️');
  assert.equal(view.cast[0].emoji, '🎙️');
});

test('fix round 2: an unmapped ":" shows no emoji and no name (the client says "unknown speaker"); mapped to a person, it is that person', () => {
  const card = { sourceId: 'x', followsOn: null, people: [], account: null };
  const unmapped = /** @type {any} */ (translation.present.preview(card, { body: ': hello', speakers: {}, sources: [] }, fakePreviewCtx()));
  assert.deepEqual(unmapped.lines[0], { kind: 'speech', emoji: '', name: null, text: 'hello', cont: false });
  const people = new Map([[1, { id: 1, emoji: '☀️', displayName: 'Sol', colour: '#d9a400', igHandle: 'solsunny' }]]);
  const ctx = { ...fakePreviewCtx(), people, formatName: (/** @type {string} */ n) => n.toLowerCase() };
  const person = /** @type {any} */ (translation.present.preview(card, { body: ': hello', speakers: { ':': { person: 1 } }, sources: [] }, ctx));
  assert.equal(person.lines[0].emoji, '☀️');
  assert.equal(person.lines[0].name, 'sol');
});

test('Task 10c (a): search shows a mapped bare ":" line with its role\'s default emoji ("💬 …"), an unmapped one as written', () => {
  const ctx = /** @type {any} */ ({ people: new Map(), formatName: (/** @type {string} */ n) => n.toLowerCase() });
  assert.deepEqual(translation.search.matchLines({ body: ': luna, I have news\n🐶: what news?', speakers: { ':': { role: 'fan' } } }, 'news', ctx), ['💬 luna, I have news', '🐶 what news?']);
  assert.deepEqual(translation.search.matchLines({ body: ': luna, I have news', speakers: {} }, 'news', ctx), [': luna, I have news']);
});

test('Task 10c (c): the preview thumbnail is the clip poster (video), else the first picture, else a quote\'s own; none for text only or a posterless clip', async () => {
  const { thumbOf } = await import('../../../src/kinds/translation/media.js');
  const video = { type: 'video', variants: [{ bitrate: 1, url: 'https://video.twimg.com/a.mp4' }], width: 720, height: 1280, poster: 'https://pbs.twimg.com/p.jpg' };
  const images = { type: 'images', images: [{ url: 'https://pbs.twimg.com/1.jpg', width: 4, height: 3 }, { url: 'https://pbs.twimg.com/2.jpg', width: 1, height: 1 }] };
  assert.deepEqual(thumbOf(/** @type {any} */ (video)), { url: 'https://pbs.twimg.com/p.jpg', width: 720, height: 1280, video: true });
  assert.deepEqual(thumbOf(/** @type {any} */ (images)), { url: 'https://pbs.twimg.com/1.jpg', width: 4, height: 3, video: false });
  assert.deepEqual(thumbOf(/** @type {any} */ ({ type: 'quote', inner: images })), { url: 'https://pbs.twimg.com/1.jpg', width: 4, height: 3, video: false });
  assert.equal(thumbOf(/** @type {any} */ ({ ...video, poster: null })), null);
  assert.equal(thumbOf(/** @type {any} */ ({ type: 'quote', inner: null })), null);
  assert.equal(thumbOf(null), null);
  // Review M3: only https on pbs.twimg.com, like the video player's poster.
  for (const url of ['http://pbs.twimg.com/p.jpg', 'https://evil.example/p.jpg', 'https://pbs.twimg.com.evil.example/p.jpg', 'javascript:alert(1)']) {
    assert.equal(thumbOf(/** @type {any} */ ({ ...video, poster: url })), null, url);
    assert.equal(thumbOf(/** @type {any} */ ({ type: 'images', images: [{ url, width: 1, height: 1 }] })), null, url);
  }
});
