// @ts-check
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { freshDb } from '../helpers/db.js';
import { insertEvent, insertItem, insertPerson } from '../helpers/seed.js';
import { countsForPerson, insertItem as insertItemRepo, neighbours, sourceState } from '../../src/repo/items.js';
import { setItemPeople, listItemPeople } from '../../src/repo/itemPeople.js';
import { addSources, primarySource, setStatus, touchCheck } from '../../src/repo/itemSources.js';
import { link, linksFrom } from '../../src/repo/itemLinks.js';
import { recall, remember } from '../../src/repo/speakerMemory.js';

/** @type {Awaited<ReturnType<typeof freshDb>>} */
let db;
before(async () => { db = await freshDb(); });
after(async () => { await db.end(); });

const system = { actor: 'system' };

/** @param {string} table @param {string | number} key */
async function auditCount(table, key) {
  const { rows } = await db.query('select count(*)::int as n from audit_log where table_name = $1 and row_key = $2', [table, String(key)]);
  return rows[0].n;
}

test('sourceState: none -> visible -> removed, and resolves through source_aliases', async () => {
  assert.equal(await sourceState(db, 'translation', 'x', '9001'), 'none');

  const itemId = await db.transaction((tx) => insertItem(tx), system);
  const sourceId = await db.transaction(
    (tx) => addSources(tx, itemId, 'translation', [{ platform: 'x', externalId: '9001', url: 'https://x.example/status/9001' }]),
    system,
  ).then((ids) => ids[0]);
  assert.equal(await sourceState(db, 'translation', 'x', '9001'), 'visible');

  // An edited post's new version id maps to the same source via source_aliases.
  await db.transaction((tx) => tx.query('insert into source_aliases (platform, external_id, source_id) values ($1, $2, $3)', ['x', '9001-v2', sourceId]), system);
  assert.equal(await sourceState(db, 'translation', 'x', '9001-v2'), 'visible');

  await db.transaction((tx) => tx.query("update items set deleted_at = now(), deleted_reason = 'hidden_by_owner' where id = $1", [itemId]), system);
  assert.equal(await sourceState(db, 'translation', 'x', '9001'), 'removed');
  assert.equal(await sourceState(db, 'translation', 'x', '9001-v2'), 'removed');
});

test('insertItem defaults sort_key to extract(epoch from posted_at) when not given', async () => {
  const postedAt = '2026-02-13T10:00:00Z';
  const itemId = await db.transaction(
    (tx) => insertItemRepo(tx, { kind: 'translation', placement: 'unsorted', occurredOn: '2026-02-13', postedAt, addedVia: 'cli' }),
    system,
  );
  const { rows } = await db.query('select sort_key from items where id = $1', [itemId]);
  assert.equal(rows[0].sort_key, Math.floor(new Date(postedAt).getTime() / 1000));
});

test('insertItem keeps an explicit sort_key over the posted_at default', async () => {
  const itemId = await db.transaction(
    (tx) => insertItemRepo(tx, {
      kind: 'translation', placement: 'unsorted', occurredOn: '2026-02-13', postedAt: '2026-02-13T10:00:00Z', addedVia: 'cli', sortKey: 42,
    }),
    system,
  );
  const { rows } = await db.query('select sort_key from items where id = $1', [itemId]);
  assert.equal(rows[0].sort_key, 42);
});

test('neighbours: ordering is stable when two items share a sort_key (id tiebreaks)', async () => {
  const eventId = await db.transaction((tx) => insertEvent(tx, { slug: 'neighbours-tie' }), system);
  const a = await db.transaction((tx) => insertItem(tx, { placement: 'event', eventId, sortKey: 5 }), system);
  const b = await db.transaction((tx) => insertItem(tx, { placement: 'event', eventId, sortKey: 5 }), system);
  const c = await db.transaction((tx) => insertItem(tx, { placement: 'event', eventId, sortKey: 9 }), system);
  assert.ok(a < b, 'ids are assigned in insertion order');

  const midNeighbours = await neighbours(db, b);
  assert.equal(midNeighbours.prev, a);
  assert.equal(midNeighbours.next, c);

  const lastNeighbours = await neighbours(db, c);
  assert.equal(lastNeighbours.prev, b);
  assert.equal(lastNeighbours.next, null);
});

test('setItemPeople: {1:present,2:present} -> {1:present} logs exactly one delete, zero inserts for person 1', async () => {
  const itemId = await db.transaction((tx) => insertItem(tx), system);
  const personA = await db.transaction((tx) => insertPerson(tx, { name: 'A' }), system);
  const personB = await db.transaction((tx) => insertPerson(tx, { name: 'B' }), system);

  await db.transaction((tx) => setItemPeople(tx, itemId, [{ personId: personA, role: 'present' }, { personId: personB, role: 'present' }]), system);
  await db.transaction((tx) => setItemPeople(tx, itemId, [{ personId: personA, role: 'present' }]), system);

  const rows = await listItemPeople(db, itemId);
  assert.deepEqual(rows, [{ personId: personA, role: 'present' }]);

  const { rows: auditRows } = await db.query(
    "select action from audit_log where table_name = 'item_people' and row_key = $1 order by id",
    [String(itemId)],
  );
  assert.deepEqual(auditRows.map((r) => r.action), ['insert', 'insert', 'delete']);
});

test('setItemPeople called again with the same set writes nothing new', async () => {
  const itemId = await db.transaction((tx) => insertItem(tx), system);
  const personA = await db.transaction((tx) => insertPerson(tx, { name: 'Same' }), system);
  await db.transaction((tx) => setItemPeople(tx, itemId, [{ personId: personA, role: 'present' }]), system);
  const before1 = await auditCount('item_people', itemId);
  await db.transaction((tx) => setItemPeople(tx, itemId, [{ personId: personA, role: 'present' }]), system);
  assert.equal(await auditCount('item_people', itemId), before1);
});

test('setStatus writes only when the status actually changes', async () => {
  const itemId = await db.transaction((tx) => insertItem(tx), system);
  const sourceId = await db.transaction(
    (tx) => addSources(tx, itemId, 'translation', [{ platform: 'x', externalId: '9100', url: 'https://x.example/status/9100' }]),
    system,
  ).then((ids) => ids[0]);

  await db.transaction((tx) => setStatus(tx, sourceId, 'live'), system); // same as the default: no change
  assert.equal(await auditCount('item_sources', itemId), 1); // just the insert from addSources

  await db.transaction((tx) => setStatus(tx, sourceId, 'deleted'), system);
  assert.equal(await auditCount('item_sources', itemId), 2);

  await db.transaction((tx) => setStatus(tx, sourceId, 'deleted'), system); // unchanged again
  assert.equal(await auditCount('item_sources', itemId), 2);

  const primary = await primarySource(db, itemId);
  assert.equal(primary?.status, 'deleted');
});

test('touchCheck writes only source_checks (unaudited): zero item_sources audit rows', async () => {
  const itemId = await db.transaction((tx) => insertItem(tx), system);
  const sourceId = await db.transaction(
    (tx) => addSources(tx, itemId, 'translation', [{ platform: 'x', externalId: '9200', url: 'https://x.example/status/9200' }]),
    system,
  ).then((ids) => ids[0]);
  const before1 = await auditCount('item_sources', itemId);

  await touchCheck(db, sourceId);
  await touchCheck(db, sourceId);

  assert.equal(await auditCount('item_sources', itemId), before1);
  const { rows } = await db.query('select consecutive_failures from source_checks where source_id = $1', [sourceId]);
  assert.equal(rows[0].consecutive_failures, 0);

  const { rows: auditRows } = await db.query("select count(*)::int as n from audit_log where table_name = 'source_checks'");
  assert.equal(auditRows[0].n, 0);
});

test('addSources stores media and the follow-up position; primarySource finds the primary role', async () => {
  const itemId = await db.transaction((tx) => insertItem(tx), system);
  await db.transaction(
    (tx) => addSources(tx, itemId, 'translation', [
      { platform: 'x', externalId: '9300', url: 'https://x.example/status/9300', media: [{ kind: 'video', url: 'https://cdn.example/9300.mp4' }] },
      { platform: 'x', externalId: '9301', url: 'https://x.example/status/9301', role: 'follow_up', position: 1 },
    ]),
    system,
  );
  const primary = await primarySource(db, itemId);
  assert.equal(primary?.externalId, '9300');
  assert.deepEqual(primary?.media, [{ kind: 'video', url: 'https://cdn.example/9300.mp4' }]);
});

test('link is idempotent: linking the same pair+relation twice writes one row', async () => {
  const a = await db.transaction((tx) => insertItem(tx), system);
  const b = await db.transaction((tx) => insertItem(tx), system);
  await db.transaction((tx) => tx.query("insert into link_relations (code) values ('follows_on') on conflict do nothing"), system);

  await db.transaction((tx) => link(tx, a, b, 'follows_on'), system);
  await db.transaction((tx) => link(tx, a, b, 'follows_on'), system);

  const links = await linksFrom(db, a);
  assert.deepEqual(links, [{ toItemId: b, relation: 'follows_on' }]);
});

test('speakerMemory: remember then recall round-trips a person and a role marker', async () => {
  const accountId = await db.transaction((tx) => tx.query("insert into accounts (platform, handle) values ('x', 'speaker_acct') returning id"), system)
    .then((r) => r.rows[0].id);
  const personId = await db.transaction((tx) => insertPerson(tx, { name: 'Speaker' }), system);

  await db.transaction((tx) => remember(tx, accountId, { A: { person: personId }, B: { role: 'host' } }), system);
  assert.deepEqual(await recall(db, accountId), { A: { person: personId }, B: { role: 'host' } });

  // Rewritten, not merged: a second remember() with a smaller map drops what it leaves out.
  await db.transaction((tx) => remember(tx, accountId, { A: { person: personId } }), system);
  assert.deepEqual(await recall(db, accountId), { A: { person: personId } });
});

test('countsForPerson counts only visible items', async () => {
  const personId = await db.transaction((tx) => insertPerson(tx, { name: 'Counted' }), system);
  const itemId = await db.transaction((tx) => insertItem(tx), system);
  await db.transaction((tx) => setItemPeople(tx, itemId, [{ personId, role: 'present' }]), system);
  assert.equal(await countsForPerson(db, personId), 1);

  await db.transaction((tx) => tx.query("update items set deleted_at = now(), deleted_reason = 'erased' where id = $1", [itemId]), system);
  assert.equal(await countsForPerson(db, personId), 0);
});
