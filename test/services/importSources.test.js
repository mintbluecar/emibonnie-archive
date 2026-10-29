// @ts-check
/** Plan 3 Task 5: the source readers — Notion CSV, link extraction, artists, events. */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { seededDeps } from '../helpers/ingest.js';
import {
  parseCsv, parseNotionCsv, extractStatusLinks, resolveArtists, eventOverrideOf,
} from '../../src/services/importSources.js';

test('parseNotionCsv maps the agreed columns and ignores Name', () => {
  const csv = [
    'Name,Date,Artist(s),Type,Client / Media,Keyword,Hashtag,Translation link,Original media',
    '"My title","2026-10-15","emi, bonnie","live","tiktok","LOVE TO THE MOON","#Moonshadow","https://x.com/tl/status/1900000000000000001","https://pbs/x.jpg"',
    'x,2026-10-01,emi,live,tiktok,K,"#H",not-a-link,',
    'x,y,z,a,b,c,d,,',
  ].join('\n');
  const { rows, skipped } = parseNotionCsv(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].url, 'https://x.com/i/status/1900000000000000001');
  assert.equal(rows[0].overrides.occurredOn, '2026-10-15');
  assert.equal(rows[0].overrides.categoryName, 'live');
  assert.equal(rows[0].overrides.clientName, 'tiktok');
  assert.equal(rows[0].extra.keyword, 'LOVE TO THE MOON');
  assert.ok(!('name' in rows[0].overrides), 'Name is ignored');
  assert.deepEqual(skipped.map((s) => s.reason), ['not a tweet link', 'no translation link']);
});

test('parseCsv handles quoted commas, quotes and newlines', () => {
  const rows = parseCsv('a,"b,c","say ""hi""\nthere"\n1,2,3');
  assert.deepEqual(rows, [['a', 'b,c', 'say "hi"\nthere'], ['1', '2', '3']]);
});

test('extractStatusLinks dedupes and accepts the URL shapes', () => {
  const text = `x.com/a/status/111111 twitter.com/i/status/222222 https://x.com/a/status/111111?s=20
    https://mobile.twitter.com/b/status/333333 x.com/notalink`;
  assert.deepEqual(extractStatusLinks(text), ['111111', '222222', '333333']);
});

/** @type {Awaited<ReturnType<typeof seededDeps>>} */
let deps;
before(async () => { deps = await seededDeps(); });
after(async () => { await deps.db.end(); });

test('resolveArtists matches names and warns on strangers', async () => {
  const { people, warnings } = await resolveArtists(deps, 'luna, Nobody Here');
  assert.deepEqual(people, [{ igHandle: 'lunamoon', role: 'present' }]);
  assert.deepEqual(warnings, ['unknown artist: Nobody Here']);
});

test('eventOverrideOf matches an existing event, else proposes one', async () => {
  const matched = await eventOverrideOf(deps, 'solluna-happy-day-2026-10-19');
  assert.ok('eventId' in matched);
  const fresh = await eventOverrideOf(deps, 'a brand new keyword');
  assert.deepEqual(fresh, { newEvent: true, eventName: 'a brand new keyword' });
  assert.deepEqual(await eventOverrideOf(deps, '  '), {});
});
