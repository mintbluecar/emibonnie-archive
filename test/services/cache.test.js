// @ts-check
/**
 * Plan 2b Task 3: the purge service. It names the same cache tags the
 * public pages carry, invalidates them through `invalidateByTag` only
 * when the request runs on Vercel, defers the call so it never delays a
 * response, and never lets a purge failure fail the write.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { seededDeps } from '../helpers/ingest.js';
import { itemChangeTags, accountChangeTags, purgeItem, purgeTags } from '../../src/services/cache.js';
import { editItem } from '../../src/services/editItem.js';
import { insertItem } from '../helpers/seed.js';

/** @type {Awaited<ReturnType<typeof seededDeps>>} */
let deps;
/** @type {{ id: number, personId: number, slug: string, handle: string }} */
let sample;

before(async () => {
  deps = await seededDeps();
  const { rows } = await deps.db.query(
    `select i.id, ev.slug, a.handle, ip.person_id
     from items i
     join events ev on ev.id = i.event_id
     join accounts a on a.id = i.credited_account_id
     join item_people ip on ip.item_id = i.id
     where i.deleted_at is null and i.review_state = 'published'
     order by i.id limit 1`,
  );
  sample = { id: rows[0].id, slug: rows[0].slug, handle: rows[0].handle, personId: rows[0].person_id };
});
after(async () => { await deps.db.end(); });

/** @param {Partial<{ env: Record<string, string>, calls: string[][], logs: string[], deferred: (() => Promise<unknown>)[] }>} [options] */
function depsWith({ env = { VERCEL: '1' }, calls = [], logs = [], deferred = [] } = {}) {
  return {
    ...deps,
    env,
    invalidateByTag: async (/** @type {string[]} */ tags) => { calls.push(tags); },
    log: (/** @type {string} */ line) => { logs.push(line); },
    defer: (/** @type {() => Promise<unknown>} */ task) => { deferred.push(task); },
  };
}

test('itemChangeTags names home, search, the item, its event, its people and its translator', async () => {
  const tags = await itemChangeTags(deps.db, sample.id);
  for (const expected of [
    'home', 'search', `item:${sample.id}`, `event:${sample.slug}`, `person:${sample.personId}`, `account:${sample.handle.toLowerCase()}`,
  ]) {
    assert.ok(tags.includes(expected), `${expected} in ${tags.join(',')}`);
  }
  assert.deepEqual(await itemChangeTags(deps.db, 999999), ['home', 'search']);
});

test('accountChangeTags covers the translator page and every credited entry', async () => {
  const { rows } = await deps.db.query('select id from accounts where handle = $1', [sample.handle]);
  const tags = await accountChangeTags(deps.db, rows[0].id);
  assert.ok(tags.includes(`account:${sample.handle.toLowerCase()}`));
  assert.ok(tags.includes(`item:${sample.id}`));
  assert.ok(tags.includes('home'));
});

test('nothing is purged off Vercel', async () => {
  const calls = /** @type {string[][]} */ ([]);
  const deps = depsWith({ env: {}, calls });
  await purgeTags(deps, ['home', 'item:1']);
  assert.deepEqual(calls, []);
});

test('purgeTags dedupes and calls invalidateByTag once on Vercel', async () => {
  const calls = /** @type {string[][]} */ ([]);
  await purgeTags(depsWith({ calls }), ['home', 'home', 'item:1']);
  assert.deepEqual(calls, [['home', 'item:1']]);
});

test('a purge failure is logged once and never thrown', async () => {
  const logs = /** @type {string[]} */ ([]);
  const failing = { ...depsWith({ logs }), invalidateByTag: async () => { throw new Error('nope'); } };
  await purgeTags(failing, ['home']);
  assert.deepEqual(logs, ['cache purge failed']);
});

test('purgeItem computes the tags and defers the call when it can', async () => {
  const calls = /** @type {string[][]} */ ([]);
  const deferred = /** @type {(() => Promise<unknown>)[]} */ ([]);
  await purgeItem(depsWith({ calls, deferred }), sample.id);
  assert.deepEqual(calls, [], 'not called yet');
  assert.equal(deferred.length, 1);
  await deferred[0]();
  assert.equal(calls[0][0], 'home');
  assert.ok(calls[0].includes(`item:${sample.id}`));
});

test('an edit purges the item it changed', async () => {
  const calls = /** @type {string[][]} */ ([]);
  const deferred = /** @type {(() => Promise<unknown>)[]} */ ([]);
  await deps.db.transaction((tx) => tx.query("insert into users (id, display_name, role) values ('x:0', 'owner', 'owner')"), { actor: 'system' });
  const owner = { id: 'x:0', via: 'x', xUserId: '0', handle: 'owner', displayName: null, isOwner: true, isBlocked: false, translatorAccountIds: [], welcomedTranslator: true };
  const { rows } = await deps.db.query("select external_id from item_sources where item_id = $1 and role = 'primary'", [sample.id]);
  // The entry's own tag is hard-deleted (review Task 13, R30), so capture that call too.
  const capture = async (/** @type {string[]} */ tags) => { calls.push(tags); };
  await editItem({ ...depsWith({ calls, deferred }), dangerouslyDeleteByTag: capture }, {
    kind: 'translation', sourceId: rows[0].external_id, changes: { subbed: true }, actor: owner,
  });
  while (deferred.length > 0) await /** @type {any} */ (deferred.shift())();
  const purged = calls.flat();
  assert.ok(purged.includes(`item:${sample.id}`), purged.join(','));
  assert.ok(purged.includes('home'));
});

// --- fix pass: deletion semantics, complete account coverage, old relationships

test('a hard purge deletes (dangerouslyDeleteByTag), not invalidates', async () => {
  const hard = /** @type {string[][]} */ ([]);
  const soft = /** @type {string[][]} */ ([]);
  const deps = {
    ...depsWith({ env: { VERCEL: '1' } }),
    invalidateByTag: async (tags) => soft.push(tags),
    dangerouslyDeleteByTag: async (tags) => hard.push(tags),
  };
  await purgeTags(deps, ['item:1'], { hard: true });
  assert.deepEqual(hard, [['item:1']]);
  assert.deepEqual(soft, []);
  await purgeTags(deps, ['item:1']);
  assert.deepEqual(soft, [['item:1']]);
  assert.equal(hard.length, 1);
});

test('a prolific translator\'s account purge reaches every item', async () => {
  const accountId = await deps.db.transaction(async (tx) => {
    const { rows } = await tx.query("insert into accounts (platform, handle) values ('x', 'prolific_tl') returning id");
    for (let i = 0; i < 205; i++) await insertItem(tx, { creditedAccountId: rows[0].id });
    return rows[0].id;
  }, { actor: 'system' });
  const tags = await accountChangeTags(deps.db, accountId);
  const itemTags = tags.filter((tag) => tag.startsWith('item:'));
  assert.equal(itemTags.length, 205, 'every credited item is named, not just the first 200');
});

test('an edit purges the old event as well as the new one', async () => {
  const calls = /** @type {string[][]} */ ([]);
  const deferred = /** @type {(() => Promise<unknown>)[]} */ ([]);
  const editing = depsWith({ calls, deferred });
  const { rows } = await deps.db.query(
    `select i.id, s.external_id as source_id, ev.slug as old_slug
     from items i join item_sources s on s.item_id = i.id and s.role = 'primary'
     join events ev on ev.id = i.event_id
     where i.deleted_at is null order by i.id limit 1`,
  );
  const { rows: other } = await deps.db.query(
    "select id, slug from events where slug <> $1 and deleted_at is null limit 1", [rows[0].old_slug],
  );
  const owner = /** @type {any} */ ({ id: 'x:0', isOwner: true, translatorAccountIds: [] });
  await editItem(editing, {
    kind: 'translation', sourceId: rows[0].source_id,
    changes: { placement: 'event', eventId: other[0].id }, actor: owner,
  });
  while (deferred.length > 0) await /** @type {any} */ (deferred.shift())();
  const purged = calls.flat();
  assert.ok(purged.includes(`event:${rows[0].old_slug}`), `old event in ${purged.join(',')}`);
  assert.ok(purged.includes(`event:${other[0].slug}`), `new event in ${purged.join(',')}`);
});
