// @ts-check
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { freshDb } from '../helpers/db.js';
import { ensureTags, ignoredHashtags, setIgnoredIfMissing } from '../../src/repo/tags.js';

/** @type {Awaited<ReturnType<typeof freshDb>>} */
let db;
before(async () => { db = await freshDb(); });
after(async () => { await db.end(); });

const system = { actor: 'system' };

test('#SLHappyDay2026 and #slhappyday2026 give one row', async () => {
  const [firstId] = await db.transaction((tx) => ensureTags(tx, [{ kind: 'hashtag', display: '#SLHappyDay2026' }]), system);
  const [secondId] = await db.transaction((tx) => ensureTags(tx, [{ kind: 'hashtag', display: '#slhappyday2026' }]), system);
  assert.equal(firstId, secondId);

  const { rows } = await db.query("select count(*)::int as n from tags where kind = 'hashtag' and norm = '#slhappyday2026'");
  assert.equal(rows[0].n, 1);
});

test('ensureTags keeps the first spelling, and a hashtag and a keyword with the same text are distinct rows', async () => {
  const [hashtagId] = await db.transaction((tx) => ensureTags(tx, [{ kind: 'hashtag', display: '#Same' }]), system);
  const [keywordId] = await db.transaction((tx) => ensureTags(tx, [{ kind: 'keyword', display: '#Same' }]), system);
  assert.notEqual(hashtagId, keywordId);

  await db.transaction((tx) => ensureTags(tx, [{ kind: 'hashtag', display: '#SAME' }]), system);
  const { rows } = await db.query('select display from tags where id = $1', [hashtagId]);
  assert.equal(rows[0].display, '#Same');
});

test('setIgnoredIfMissing adds a missing hashtag as ignored, and leaves an existing row alone', async () => {
  await db.transaction((tx) => ensureTags(tx, [{ kind: 'hashtag', display: '#alreadythere' }]), system);
  await db.transaction((tx) => setIgnoredIfMissing(tx, ['#alreadythere', '#brandnew']), system);

  const { rows } = await db.query(
    "select display, ignored from tags where kind = 'hashtag' and norm in ('#alreadythere', '#brandnew') order by display",
  );
  assert.deepEqual(rows, [
    { display: '#alreadythere', ignored: false },
    { display: '#brandnew', ignored: true },
  ]);
});

test('ignoredHashtags lists only ignored hashtag tags', async () => {
  await db.transaction((tx) => setIgnoredIfMissing(tx, ['#ign1', '#ign2']), system);
  const list = await ignoredHashtags(db);
  assert.ok(list.includes('#ign1'));
  assert.ok(list.includes('#ign2'));
});
