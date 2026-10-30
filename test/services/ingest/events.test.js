// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IDS } from '../../helpers/fixtures.js';
import { ingestDeps, ingest, rows, count, patchedFetch, SYSTEM, sourcesOf } from '../../helpers/ingest.js';
import { kindsRegistry } from '../../../src/kinds/_registry.js';
import { createPeople, resolveSpeakerRefs } from '../../../src/services/intakeRefs.js';
import { BadRequest } from '../../../src/domain/errors.js';

const translation = kindsRegistry.translation;

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
    assert.equal(media[0].external_id, '1900000000000000091');
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

test('SHARED, with its sharer known: starguest is sharing, the mapped 🪇 speaker is about, no event', async () => {
  const deps = await ingestDeps();
  try {
    await createPeople(deps, [{ igHandle: 'starguest', displayName: 'star guest', emoji: '⭐', colour: '#aa8800' }], SYSTEM);
    const chosen = await resolveSpeakerRefs(deps.db, { '🪇': { person: 'lunamoon' } });
    const result = await ingest(deps, IDS.SHARED, { chosen, overrides: { placement: 'shared_story' } });
    assert.equal(result.status, 'added');
    const [item] = await rows(deps.db, 'select placement, event_id from items where id = $1', [result.itemId]);
    assert.deepEqual(item, { placement: 'shared_story', event_id: null });
    const people = await rows(deps.db, `select p.display_name, ip.role from item_people ip join people p on p.id = ip.person_id
      where ip.item_id = $1 order by ip.role`, [result.itemId]);
    assert.deepEqual(people, [{ display_name: 'luna', role: 'about' }, { display_name: 'star guest', role: 'sharing' }]);
  } finally {
    await deps.db.end();
  }
});

test('overrides.people attaches people to a shared story whose speakers are only roles, on top of the derived ones (Task 9a item 6)', async () => {
  const deps = await ingestDeps();
  try {
    await createPeople(deps, [{ igHandle: 'starguest', displayName: 'star guest', emoji: '⭐', colour: '#aa8800' }], SYSTEM);
    const chosen = await resolveSpeakerRefs(deps.db, { '🪇': { role: 'speaker' } });
    const overrides = {
      placement: /** @type {const} */ ('shared_story'),
      people: [{ igHandle: 'solsunny', role: /** @type {const} */ ('about') }, { igHandle: '@LunaMoon', role: /** @type {const} */ ('about') },
        { igHandle: 'starguest', role: /** @type {const} */ ('sharing') }],
    };
    const result = await ingest(deps, IDS.SHARED, { chosen, overrides });
    assert.equal(result.status, 'added');
    const people = await rows(deps.db, `select p.display_name, ip.role from item_people ip join people p on p.id = ip.person_id
      where ip.item_id = $1 order by ip.role, p.display_name`, [result.itemId]);
    // starguest is also derived (its tag): the override adds no second row.
    assert.deepEqual(people, [
      { display_name: 'luna', role: 'about' }, { display_name: 'sol', role: 'about' }, { display_name: 'star guest', role: 'sharing' },
    ]);
  } finally {
    await deps.db.end();
  }
});

test('overrides.people refuses an unknown person or role clearly, before anything is fetched or written', async () => {
  const patched = patchedFetch((_kind, _id, json) => json);
  const deps = await ingestDeps({ fetchImpl: patched.fetchImpl });
  try {
    await assert.rejects(
      ingest(deps, IDS.SHARED, { overrides: { people: [{ igHandle: 'nobody_here', role: 'about' }] } }),
      /overrides\.people: unknown person @nobody_here/,
    );
    await assert.rejects(
      ingest(deps, IDS.SHARED, { overrides: { people: [{ igHandle: 'solsunny', role: /** @type {any} */ ('guest') }] } }),
      /overrides\.people: role for @solsunny must be one of present, sharing, about, author/,
    );
    for (const notAList of [{ igHandle: 'solsunny', role: 'about' }, 'solsunny', 7]) {
      await assert.rejects(
        ingest(deps, IDS.SHARED, { overrides: { people: /** @type {any} */ (notAList) } }),
        (/** @type {any} */ err) => err instanceof BadRequest && err.message === 'overrides.people: must be a list',
      );
    }
    assert.deepEqual(patched.calls, {});
    assert.equal(await count(deps.db, 'select count(*)::int as n from items'), 0);
  } finally {
    await deps.db.end();
  }
});

test('a clip is credited to a handle-only account, never to an account that used to hold the handle', async () => {
  const deps = await ingestDeps();
  try {
    await deps.db.transaction((tx) => tx.query("insert into accounts (platform, external_id, handle) values ('x', '7777', 'clipper_one')"), SYSTEM);
    const { itemId } = await ingest(deps, IDS.EVENT_A);
    const [media] = await rows(deps.db, `select a.external_id, a.handle from item_sources s join accounts a on a.id = s.account_id
      where s.item_id = $1 and s.role = 'media'`, [itemId]);
    assert.deepEqual(media, { external_id: null, handle: 'clipper_one' });
  } finally {
    await deps.db.end();
  }
});

test('a source with no credited handle is refused, not credited to a made-up account', async () => {
  const deps = await ingestDeps();
  try {
    const nameless = {
      ...translation,
      draft: (/** @type {any} */ input, /** @type {any} */ ctx) => {
        const draft = translation.draft(input, ctx);
        return { ...draft, common: { ...draft.common, credited: { ...draft.common.credited, handle: null } } };
      },
    };
    await assert.rejects(ingest({ ...deps, kinds: { translation: nameless } }, IDS.EVENT_B), /no handle/);
    assert.equal(await count(deps.db, 'select count(*)::int as n from items'), 0);
    assert.equal(await count(deps.db, "select count(*)::int as n from accounts where handle = 'unknown'"), 0);
  } finally {
    await deps.db.end();
  }
});

test("lookups:'existing' refuses a new category and a new client", async () => {
  const deps = await ingestDeps();
  try {
    await assert.rejects(
      ingest(deps, IDS.EVENT_B, { lookups: 'existing', overrides: { categoryName: 'brand new type' } }),
      /unknown category/,
    );
    await assert.rejects(
      ingest(deps, IDS.EVENT_B, { lookups: 'existing', overrides: { clientName: 'brand new client' } }),
      /unknown client/,
    );
    assert.equal(await count(deps.db, 'select count(*)::int as n from items'), 0);
  } finally {
    await deps.db.end();
  }
});
