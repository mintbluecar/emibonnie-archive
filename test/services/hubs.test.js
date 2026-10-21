// @ts-check
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { IDS } from '../helpers/fixtures.js';
import { seededDeps, itemIdOf, SYSTEM } from '../helpers/ingest.js';
import { homeView, eventView, personView, accountView, filterOptions, itemView } from '../../src/services/hubs.js';
import { upsertAccount } from '../../src/repo/accounts.js';

/** @type {any} */
let deps;
before(async () => { deps = await seededDeps(); });
after(async () => { await deps.db.end(); });

test('homeView: visible events newest first, grouped by month, counts per kind', async () => {
  const { months } = await homeView(deps);
  assert.deepEqual(months.map((m) => m.month), ['2026-10', '2026-03', '2026-02']);
  const october = months[0].events;
  assert.deepEqual(october.map((e) => e.slug), ['solluna-happy-day-2026-10-19', 'solluna-at-starfest-2026-10-18']);
  assert.deepEqual(october[0], {
    slug: 'solluna-happy-day-2026-10-19', name: 'SOLLUNA HAPPY DAY', occurredOn: '2026-10-19',
    hashtag: 'SLHappyDay2026', counts: { translation: 2 },
  });
  assert.deepEqual(october[1].counts, { translation: 1 });
});

test('eventView: the event, its translator count, people, and per-kind sections in event order', async () => {
  const view = /** @type {any} */ (await eventView(deps, 'solluna-happy-day-2026-10-19'));
  assert.equal(view.event.name, 'SOLLUNA HAPPY DAY');
  assert.equal(view.event.occurredOn, '2026-10-19');
  assert.equal(view.accountCount, 2);
  assert.deepEqual(view.people.map((/** @type {any} */ p) => p.name), ['sol', 'luna']);
  assert.deepEqual(view.sections.map((/** @type {any} */ s) => s.kind), ['translation']);
  assert.deepEqual(view.sections[0].items.map((/** @type {any} */ i) => i.sourceId), [IDS.EVENT_A, IDS.EVENT_B]);
  assert.equal(await eventView(deps, 'no-such-event'), null);
});

test('an event whose items are all hidden is not visible', async () => {
  const id = await itemIdOf(deps.db, IDS.LIVE);
  await deps.db.transaction((/** @type {any} */ tx) => tx.query("update items set deleted_at = now(), deleted_reason = 'spam' where id = $1", [id]), SYSTEM);
  try {
    assert.equal(await eventView(deps, 'luna-tiktok-live-2026-02-12'), null);
    const { months } = await homeView(deps);
    assert.ok(!months.some((m) => m.month === '2026-02'));
  } finally {
    await deps.db.transaction((/** @type {any} */ tx) => tx.query('update items set deleted_at = null, deleted_reason = null where id = $1', [id]), SYSTEM);
  }
});

test('personView: the person, counts, and their items newest first with each item\'s event', async () => {
  const view = /** @type {any} */ (await personView(deps, 'solsunny'));
  assert.equal(view.person.name, 'sol');
  assert.equal(view.person.igHandle, 'solsunny');
  assert.equal(view.redirectTo, undefined);
  assert.deepEqual(view.counts, { items: 6, events: 3, sharedStories: 0 });
  const items = view.sections[0].items;
  assert.equal(items[0].sourceId, IDS.PHOTO);
  assert.equal(items[0].event, null);
  const long = items.find((/** @type {any} */ i) => i.sourceId === IDS.LONG);
  assert.deepEqual(long.event, { slug: 'solluna-at-starfest-2026-10-18', name: 'SOLLUNA AT STARFEST', occurredOn: '2026-10-18' });
  assert.equal((/** @type {any} */ (await personView(deps, 'SolSunny'))).redirectTo, 'solsunny');
  assert.equal(await personView(deps, 'nobody_here'), null);
});

test('accountView: the translator\'s items; an old handle after a handle change redirects to the current one', async () => {
  const view = /** @type {any} */ (await accountView(deps, 'tl_gamma'));
  assert.equal(view.account.handle, 'tl_gamma');
  assert.equal(view.redirectTo, undefined);
  assert.deepEqual(view.sections[0].items.map((/** @type {any} */ i) => i.sourceId), [IDS.EVENT_B]);
  assert.equal(view.counts.items, 1);

  await deps.db.transaction((/** @type {any} */ tx) => upsertAccount(tx, { platform: 'x', externalId: '9003', handle: 'gamma_renamed' }), SYSTEM);
  try {
    const old = /** @type {any} */ (await accountView(deps, 'tl_gamma'));
    assert.equal(old.redirectTo, 'gamma_renamed');
    assert.equal(old.account.handle, 'gamma_renamed');
    assert.equal((/** @type {any} */ (await accountView(deps, 'gamma_renamed'))).redirectTo, undefined);
  } finally {
    await deps.db.transaction((/** @type {any} */ tx) => upsertAccount(tx, { platform: 'x', externalId: '9003', handle: 'tl_gamma' }), SYSTEM);
  }
  assert.equal(await accountView(deps, 'nobody_here'), null);
});

test('accountView: an opted-out account says only that', async () => {
  await deps.db.transaction((/** @type {any} */ tx) => tx.query("update accounts set opted_out_at = now() where handle = 'tl_gamma'"), SYSTEM);
  try {
    assert.deepEqual(await accountView(deps, 'tl_gamma'), { account: { handle: 'tl_gamma', optedOut: true } });
  } finally {
    await deps.db.transaction((/** @type {any} */ tx) => tx.query("update accounts set opted_out_at = null where handle = 'tl_gamma'"), SYSTEM);
  }
});

test('filterOptions: people, categories, visible events, and only accounts with a visible item that have not opted out', async () => {
  const before = await filterOptions(deps);
  assert.deepEqual(before.accounts, [{ handle: 'tl_alpha' }, { handle: 'tl_beta' }, { handle: 'tl_gamma' }]);
  assert.equal(before.events.length, 4);
  assert.deepEqual(Object.keys(before.events[0]).sort(), ['name', 'slug']);
  assert.ok(before.categories.some((c) => c.name === 'live'));
  assert.deepEqual(before.people.map((p) => p.name), ['sol', 'luna', 'host']);

  await deps.db.transaction((/** @type {any} */ tx) => tx.query("update accounts set opted_out_at = now() where handle = 'tl_gamma'"), SYSTEM);
  try {
    const after = await filterOptions(deps);
    assert.deepEqual(after.accounts, [{ handle: 'tl_alpha' }, { handle: 'tl_beta' }]);
  } finally {
    await deps.db.transaction((/** @type {any} */ tx) => tx.query("update accounts set opted_out_at = null where handle = 'tl_gamma'"), SYSTEM);
  }
});

test('itemView: neighbours in the event, follows-on, and null for an unknown kind, unknown id or removed item', async () => {
  const a = /** @type {any} */ (await itemView(deps, 'translation', IDS.EVENT_A));
  assert.equal(a.prev, null);
  assert.deepEqual(a.next, { sourceId: IDS.EVENT_B, url: `/t/${IDS.EVENT_B}` });
  assert.equal(a.event.slug, 'solluna-happy-day-2026-10-19');
  assert.equal(await itemView(deps, 'no_such_kind', IDS.EVENT_A), null);
  assert.equal(await itemView(deps, 'translation', '1'), null);

  const id = await itemIdOf(deps.db, IDS.EVENT_B);
  await deps.db.transaction((/** @type {any} */ tx) => tx.query("update items set deleted_at = now(), deleted_reason = 'spam' where id = $1", [id]), SYSTEM);
  try {
    assert.equal(await itemView(deps, 'translation', IDS.EVENT_B), null);
    assert.equal((/** @type {any} */ (await itemView(deps, 'translation', IDS.EVENT_A))).next, null);
  } finally {
    await deps.db.transaction((/** @type {any} */ tx) => tx.query('update items set deleted_at = null, deleted_reason = null where id = $1', [id]), SYSTEM);
  }
});

test('followsOnFrom names the visible item this one follows on from', async () => {
  const longId = await itemIdOf(deps.db, IDS.LONG);
  const aId = await itemIdOf(deps.db, IDS.EVENT_A);
  await deps.db.transaction((/** @type {any} */ tx) => tx.query("insert into item_links (from_item_id, to_item_id, relation) values ($1, $2, 'follows_on')", [longId, aId]), SYSTEM);
  try {
    const view = /** @type {any} */ (await itemView(deps, 'translation', IDS.LONG));
    assert.deepEqual(view.followsOnFrom, { sourceId: IDS.EVENT_A, url: `/t/${IDS.EVENT_A}` });
    await deps.db.transaction((/** @type {any} */ tx) => tx.query("update items set review_state = 'pending' where id = $1", [aId]), SYSTEM);
    assert.equal((/** @type {any} */ (await itemView(deps, 'translation', IDS.LONG))).followsOnFrom, null);
  } finally {
    await deps.db.transaction(async (/** @type {any} */ tx) => {
      await tx.query("update items set review_state = 'published' where id = $1", [aId]);
      await tx.query('delete from item_links where from_item_id = $1', [longId]);
    }, SYSTEM);
  }
});
