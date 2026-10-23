// @ts-check
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { IDS } from '../helpers/fixtures.js';
import { seededDeps, itemIdOf, ingest, SYSTEM } from '../helpers/ingest.js';
import { homeView, eventView, personView, accountView, filterOptions } from '../../src/services/hubs.js';
import { itemView, addedByOf } from '../../src/services/itemView.js';
import { search } from '../../src/services/search.js';
import { upsertAccount } from '../../src/repo/accounts.js';
import { addPerson } from '../../src/repo/people.js';
import { ensureCategory, ensureClient } from '../../src/repo/lookups.js';
import { setItemPeople } from '../../src/repo/itemPeople.js';
import { insertItem, insertUser } from '../helpers/seed.js';

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

test('eventView: order=desc reverses each section (the event page\'s "newest first" toggle); an unknown order is a BadRequest', async () => {
  const slug = 'solluna-happy-day-2026-10-19';
  const asc = /** @type {any} */ (await eventView(deps, slug));
  assert.deepEqual(asc.sections[0].items.map((/** @type {any} */ i) => i.sourceId), [IDS.EVENT_A, IDS.EVENT_B]);
  const defaulted = /** @type {any} */ (await eventView(deps, slug, { order: 'asc' }));
  assert.deepEqual(defaulted.sections[0].items.map((/** @type {any} */ i) => i.sourceId), [IDS.EVENT_A, IDS.EVENT_B]);
  const desc = /** @type {any} */ (await eventView(deps, slug, { order: 'desc' }));
  assert.deepEqual(desc.sections[0].items.map((/** @type {any} */ i) => i.sourceId), [IDS.EVENT_B, IDS.EVENT_A]);
  await assert.rejects(eventView(deps, slug, { order: 'bogus' }), { name: 'BadRequest' });
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
  // review round 1, I3: the translation kind's own profileUrl(handle), never hardcoded by a page.
  assert.equal(view.account.profileUrl, 'https://x.com/tl_gamma');
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
  // LONG (task-6-brief.md carried item #2: seed/maps.json overrides its category/client,
  // so a browser dev-seed can exercise them without relying on the gitignored site/).
  assert.deepEqual(before.categories.map((c) => c.name), ['live']);
  assert.deepEqual(before.clients.map((c) => c.name), ['Test Media Co']);
  assert.deepEqual(before.people.map((p) => p.name), ['sol', 'luna', 'host', 'star guest']);

  await deps.db.transaction((/** @type {any} */ tx) => tx.query("update accounts set opted_out_at = now() where handle = 'tl_gamma'"), SYSTEM);
  try {
    const after = await filterOptions(deps);
    assert.deepEqual(after.accounts, [{ handle: 'tl_alpha' }, { handle: 'tl_beta' }]);
  } finally {
    await deps.db.transaction((/** @type {any} */ tx) => tx.query("update accounts set opted_out_at = null where handle = 'tl_gamma'"), SYSTEM);
  }
});

test('filterOptions: a client used only on a hidden item is excluded (review round 1, I3)', async () => {
  const { itemId, clientId } = await deps.db.transaction(async (/** @type {any} */ tx) => {
    const client = await ensureClient(tx, 'Hidden Channel');
    const item = await insertItem(tx, { reviewState: 'pending' });
    await tx.query('update items set client_id = $1 where id = $2', [client, item]);
    return { itemId: item, clientId: client };
  }, SYSTEM);
  const clientNames = async () => (await filterOptions(deps)).clients.map((c) => c.name);
  try {
    assert.ok(!(await clientNames()).includes('Hidden Channel'), 'pending: client not listed');
    await deps.db.transaction((/** @type {any} */ tx) => tx.query("update items set review_state = 'published' where id = $1", [itemId]), SYSTEM);
    assert.ok((await clientNames()).includes('Hidden Channel'), 'published: client listed');
  } finally {
    await deps.db.transaction((/** @type {any} */ tx) => tx.query(
      "update items set deleted_at = now(), deleted_reason = 'spam', client_id = null where id = $1", [itemId],
    ), SYSTEM);
    await deps.db.transaction((/** @type {any} */ tx) => tx.query('update clients set deleted_at = now() where id = $1', [clientId]), SYSTEM);
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

test('previews carry the shared occurredOn and placement; search results too', async () => {
  const view = /** @type {any} */ (await eventView(deps, 'solluna-happy-day-2026-10-19'));
  const first = view.sections[0].items[0];
  assert.equal(first.occurredOn, '2026-10-19');
  assert.equal(first.placement, 'event');
  const person = /** @type {any} */ (await personView(deps, 'solsunny'));
  const post = person.sections[0].items.find((/** @type {any} */ i) => i.sourceId === IDS.POST);
  assert.equal(post.placement, 'post');
  const { results } = await search(deps, { kinds: ['translation'], placements: ['shared_story'] });
  assert.ok(results.length > 0);
  for (const r of results) {
    assert.equal(r.placement, 'shared_story');
    assert.match(r.occurredOn, /^\d{4}-\d{2}-\d{2}$/);
  }
});

test('eventView: type and client names, and visible counts per kind from a count query', async () => {
  const slug = 'solluna-happy-day-2026-10-19';
  const plain = /** @type {any} */ (await eventView(deps, slug));
  assert.equal(plain.event.type, null);
  assert.equal(plain.event.client, null);
  assert.deepEqual(plain.counts, { translation: 2 });
  await deps.db.transaction(async (/** @type {any} */ tx) => {
    const category = (await tx.query("select id from categories where name = 'live'")).rows[0].id;
    const client = (await tx.query("insert into clients (name) values ('Some Channel') returning id")).rows[0].id;
    await tx.query('update events set category_id = $1, client_id = $2 where slug = $3', [category, client, slug]);
  }, SYSTEM);
  const id = await itemIdOf(deps.db, IDS.EVENT_B);
  await deps.db.transaction((/** @type {any} */ tx) => tx.query("update items set review_state = 'pending' where id = $1", [id]), SYSTEM);
  try {
    const view = /** @type {any} */ (await eventView(deps, slug));
    assert.equal(view.event.type, 'live');
    assert.equal(view.event.client, 'Some Channel');
    assert.deepEqual(view.counts, { translation: 1 }, 'a pending item is not counted');
  } finally {
    await deps.db.transaction(async (/** @type {any} */ tx) => {
      await tx.query("update items set review_state = 'published' where id = $1", [id]);
      await tx.query('update events set category_id = null, client_id = null where slug = $1', [slug]);
    }, SYSTEM);
  }
});

test('itemView: placement, tags as first written, category name, and addedBy null for system writes', async () => {
  const id = await itemIdOf(deps.db, IDS.EVENT_A);
  const plain = /** @type {any} */ (await itemView(deps, 'translation', IDS.EVENT_A));
  assert.equal(plain.placement, 'event');
  assert.deepEqual(plain.tags, { keyword: 'SOLLUNA HAPPY DAY', hashtags: ['SLHappyDay2026', 'fanclip'] });
  assert.equal(plain.category, null);
  assert.equal(plain.addedBy, null);
  await deps.db.transaction((/** @type {any} */ tx) => tx.query("update items set category_id = (select id from categories where name = 'live') where id = $1", [id]), SYSTEM);
  try {
    assert.equal((/** @type {any} */ (await itemView(deps, 'translation', IDS.EVENT_A))).category, 'live');
  } finally {
    await deps.db.transaction((/** @type {any} */ tx) => tx.query('update items set category_id = null where id = $1', [id]), SYSTEM);
  }
});

test('itemView addedBy: an X user\'s handle, "a fan" once opted out or deleted, else the chosen display name; never an id', async () => {
  await deps.db.transaction(async (/** @type {any} */ tx) => {
    await tx.query("insert into users (id, display_name) values ('member-added', 'kind reader')");
    await tx.query("insert into accounts (platform, handle, user_id) values ('x', 'submitter_x', 'member-added')");
  }, SYSTEM);
  assert.equal((await ingest(deps, IDS.EDITED_OLD, { actor: 'member-added' })).status, 'added');
  const addedBy = async () => (/** @type {any} */ (await itemView(deps, 'translation', IDS.EDITED_NEW))).addedBy;
  const set = (/** @type {string} */ sql) => deps.db.transaction((/** @type {any} */ tx) => tx.query(sql), SYSTEM);
  assert.deepEqual(await addedBy(), { kind: 'handle', handle: 'submitter_x' });
  assert.ok(!JSON.stringify(await itemView(deps, 'translation', IDS.EDITED_NEW)).includes('member-added'));
  await set("update accounts set opted_out_at = now() where handle = 'submitter_x'");
  assert.deepEqual(await addedBy(), { kind: 'fan' });
  await set("update accounts set deleted_at = now() where handle = 'submitter_x'");
  assert.deepEqual(await addedBy(), { kind: 'name', name: 'kind reader' });
  await set("update users set deleted_at = now() where id = 'member-added'");
  assert.deepEqual(await addedBy(), { kind: 'fan' });
});

test('addedByOf: the public form of a submitter', () => {
  const base = { role: 'member', deleted: false, name: 'n', onX: false, xHandle: null };
  assert.equal(addedByOf(null), null);
  assert.equal(addedByOf({ ...base, role: 'system' }), null);
  assert.deepEqual(addedByOf({ ...base, name: '  ' }), { kind: 'fan' });
  assert.deepEqual(addedByOf({ ...base, name: null }), { kind: 'fan' });
  assert.deepEqual(addedByOf({ ...base, onX: true, xHandle: 'h' }), { kind: 'handle', handle: 'h' });
  assert.deepEqual(addedByOf({ ...base, deleted: true, onX: true, xHandle: 'h' }), { kind: 'fan' });
});

test('hub sections page with limit/offset: real totals, hasMore, and counts that ignore the page', async () => {
  const slug = 'solluna-happy-day-2026-10-19';
  const first = /** @type {any} */ (await eventView(deps, slug, { limit: '1' }));
  assert.deepEqual(first.sections.map((/** @type {any} */ s) => [s.kind, s.total, s.hasMore, s.items.length]), [['translation', 2, true, 1]]);
  assert.equal(first.sections[0].items[0].sourceId, IDS.EVENT_A);
  assert.deepEqual(first.counts, { translation: 2 });
  const second = /** @type {any} */ (await eventView(deps, slug, { limit: '1', offset: '1' }));
  assert.deepEqual(second.sections[0].items.map((/** @type {any} */ i) => i.sourceId), [IDS.EVENT_B]);
  assert.equal(second.sections[0].hasMore, false);
  const whole = /** @type {any} */ (await eventView(deps, slug));
  assert.equal(whole.sections[0].items.length, 2);
  assert.equal(whole.sections[0].hasMore, false);

  const person = /** @type {any} */ (await personView(deps, 'solsunny', { limit: 2 }));
  assert.equal(person.sections[0].items.length, 2);
  assert.equal(person.sections[0].total, person.counts.items);
  assert.equal(person.sections[0].hasMore, true);

  const full = /** @type {any} */ (await accountView(deps, 'tl_alpha'));
  const paged = /** @type {any} */ (await accountView(deps, 'tl_alpha', { limit: 1, offset: 0 }));
  assert.ok(full.counts.items > 1, 'tl_alpha has several items');
  assert.equal(paged.counts.items, full.counts.items, 'counts.items is a count, not the page length');
  assert.equal(paged.sections[0].items.length, 1);
  assert.equal(paged.sections[0].hasMore, true);
});

test('hub paging params out of range are a BadRequest', async () => {
  for (const params of [{ limit: '0' }, { limit: '51' }, { limit: 'abc' }, { limit: '-1' }, { offset: '10001' }, { offset: '1.5' }, { limit: Number.NaN }]) {
    await assert.rejects(eventView(deps, 'solluna-happy-day-2026-10-19', params), { name: 'BadRequest' }, JSON.stringify(params));
    await assert.rejects(personView(deps, 'solsunny', params), { name: 'BadRequest' });
    await assert.rejects(accountView(deps, 'tl_alpha', params), { name: 'BadRequest' });
  }
  assert.ok(await eventView(deps, 'solluna-happy-day-2026-10-19', { limit: '50', offset: '10000' }));
});

test('filters and person pages only through visible items: a person and category known only from a hidden item stay out', async () => {
  // `created_by` is fixed at insert time by the `set_common` trigger (src/db/migrations/001_initial.sql)
  // and never changes on a later UPDATE, so the "blocked submitter" and "system submitter" cases below
  // are two separate items, each inserted under its own actor, rather than one item whose created_by
  // is rewritten. Both stay `pending` except during the phase that needs them published.
  const { personId, categoryId, blockedId } = await deps.db.transaction(async (/** @type {any} */ tx) => {
    const person = await addPerson(tx, { igHandle: 'hidden_only', displayName: 'Hidden', emoji: '🫥', colour: '#123456' });
    const category = await ensureCategory(tx, 'backstage');
    const blocked = await insertUser(tx, { blockedAt: true });
    return { personId: person.id, categoryId: category, blockedId: blocked };
  }, SYSTEM);
  const systemItemId = await deps.db.transaction((/** @type {any} */ tx) => insertItem(tx, { reviewState: 'pending' }), SYSTEM);
  const blockedItemId = await deps.db.transaction((/** @type {any} */ tx) => insertItem(tx, { reviewState: 'pending' }), { actor: blockedId });
  await deps.db.transaction(async (/** @type {any} */ tx) => {
    for (const id of [systemItemId, blockedItemId]) {
      await tx.query('update items set category_id = $1 where id = $2', [categoryId, id]);
      await setItemPeople(tx, id, [{ personId, role: 'present' }]);
    }
  }, SYSTEM);
  const names = async () => (await filterOptions(deps)).people.map((p) => p.igHandle);
  const categories = async () => (await filterOptions(deps)).categories.map((c) => c.name);
  try {
    assert.ok(!(await names()).includes('hidden_only'), 'pending: person not listed');
    assert.ok(!(await categories()).includes('backstage'), 'pending: category not listed');
    assert.equal(await personView(deps, 'hidden_only'), null, 'pending: no person page');

    await deps.db.transaction((/** @type {any} */ tx) => tx.query("update items set review_state = 'published' where id = $1", [blockedItemId]), SYSTEM);
    assert.ok(!(await names()).includes('hidden_only'), 'blocked submitter: person not listed');
    assert.ok(!(await categories()).includes('backstage'), 'blocked submitter: category not listed');
    assert.equal(await personView(deps, 'hidden_only'), null, 'blocked submitter: no person page');

    await deps.db.transaction(async (/** @type {any} */ tx) => {
      await tx.query("update items set review_state = 'pending' where id = $1", [blockedItemId]);
      await tx.query("update items set review_state = 'published' where id = $1", [systemItemId]);
    }, SYSTEM);
    assert.ok((await names()).includes('hidden_only'), 'visible: listed');
    assert.deepEqual(await categories(), ['live', 'backstage']);
    assert.equal((/** @type {any} */ (await personView(deps, 'hidden_only'))).counts.items, 1);

    await deps.db.transaction((/** @type {any} */ tx) => tx.query("update items set review_state = 'pending' where id = $1", [systemItemId]), SYSTEM);
    await deps.db.transaction((/** @type {any} */ tx) => tx.query('update people set featured = true where id = $1', [personId]), SYSTEM);
    assert.ok((await names()).includes('hidden_only'), 'a featured person is always listed');
    assert.ok(await personView(deps, 'hidden_only'), 'and always has a page');
  } finally {
    await deps.db.transaction(async (/** @type {any} */ tx) => {
      await tx.query('delete from item_people where item_id = any($1)', [[systemItemId, blockedItemId]]);
      await tx.query("update items set deleted_at = now(), deleted_reason = 'spam', category_id = null where id = any($1)", [[systemItemId, blockedItemId]]);
      await tx.query('update people set featured = false, deleted_at = now() where id = $1', [personId]);
      await tx.query('update categories set deleted_at = now() where id = $1', [categoryId]);
    }, SYSTEM);
  }
});

test('lowercaseNames (on for the example) lowercases people only: a person page keeps its events\' stored case (Task 9a item 7)', async () => {
  assert.equal(deps.site.lowercaseNames, true);
  const view = /** @type {any} */ (await personView(deps, 'solsunny'));
  assert.equal(view.person.name, 'sol');
  const eventNames = view.sections.flatMap((/** @type {any} */ s) => s.items).map((/** @type {any} */ i) => i.event?.name).filter(Boolean);
  assert.ok(eventNames.includes('SOLLUNA HAPPY DAY'), JSON.stringify(eventNames));
});
