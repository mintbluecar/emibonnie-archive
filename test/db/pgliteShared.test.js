// @ts-check
/**
 * Task 9a item 3: one PGlite instance per data directory per process.
 *
 * The dev server builds deps (and so a `Db`) per request, like the
 * deployed function. With `PGLITE_DIR` set, each one used to open its own
 * `new PGlite({ dataDir })`, and a deferred edit-window refresh kept its
 * instance open while later requests opened more on the same directory:
 * several single-user Postgres backends writing one cluster, which ends in
 * `RuntimeError: Aborted()` and a corrupt directory. PGlite only
 * serialises work inside one instance (its query/transaction mutexes are
 * per instance), so `createDb({ dir })` now shares one instance per
 * directory and closes it when its last user ends.
 *
 * PGlite only: the Postgres pass (`TEST_DATABASE_URL`) never uses a dir.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDb } from '../../src/db/client.js';
import { migrate } from '../../src/db/migrate.js';
import { createHandler } from '../../src/http/handler.js';
import { routes } from '../../src/routes/index.js';
import { runSetup } from '../../scripts/setup.js';
import { ENGINE_MIGRATIONS } from '../helpers/db.js';
import { patchedFetch, site, SITE_DIR, SYSTEM } from '../helpers/ingest.js';
import { seedDev } from '../../src/services/seedDev.js';

const SKIP = process.env.TEST_DATABASE_URL ? 'PGlite only (TEST_DATABASE_URL is set)' : false;

/** @type {string} */ let scratch;
before(() => { scratch = mkdtempSync(path.join(tmpdir(), 'fan-archive-pglite-')); });
after(() => { if (scratch) rmSync(scratch, { recursive: true, force: true }); });

describe('createDb({ dir }) shares one PGlite per directory', { skip: SKIP }, () => {
  test('a second Db on the same dir sees the first one\'s writes, and outlives its end()', async () => {
    const dir = path.join(scratch, 'shared');
    const a = createDb({ dir });
    const b = createDb({ dir });
    await b.query('select 1'); // b is open before a writes anything
    await a.transaction((tx) => tx.exec('create table shared_probe (n int); insert into shared_probe values (7)'), SYSTEM);
    assert.deepEqual((await b.query('select n from shared_probe')).rows, [{ n: 7 }]);
    await a.end();
    assert.deepEqual((await b.query('select n from shared_probe')).rows, [{ n: 7 }], 'b still works after a ended');
    await b.end();
    const c = createDb({ dir });
    assert.deepEqual((await c.query('select n from shared_probe')).rows, [{ n: 7 }], 'reopens cleanly after the last end()');
    await c.end();
  });

  test('in-memory Dbs stay separate', async () => {
    const a = createDb();
    const b = createDb();
    await a.transaction((tx) => tx.exec('create table mem_probe (n int)'), SYSTEM);
    await assert.rejects(b.query('select * from mem_probe'), /mem_probe/);
    await a.end();
    await b.end();
  });
});

/** Every seeded post's edit window closes here; requests start an hour later, so each schedules a refresh. */
const WINDOW_CLOSES = new Date('2026-10-14T00:00:00.000Z').getTime();
const REFETCH_DELAY_MS = 300;
/** Large edits extend relation and TOAST files: small ones never tripped the crash (Task 9a report). */
const EDIT = 'an edited line '.repeat(2000);

/** @param {'syn'|'fx'|'thread'} kind @param {any} json */
function withClosedWindow(kind, json) {
  return kind === 'syn' ? { ...json, edit_control: { ...(json.edit_control ?? {}), editable_until_msecs: String(WINDOW_CLOSES) } } : json;
}

let edits = 0;
/** A different large edit on every read, so every refresh rewrites the part. @param {'syn'|'fx'|'thread'} kind @param {any} json */
function editedLong(kind, json) {
  const out = withClosedWindow(kind, json);
  edits += 1;
  if (kind === 'syn') out.text = `${out.text}\nedit ${edits} ${EDIT}`;
  if (kind === 'fx' && out.tweet) out.tweet = { ...out.tweet, text: `${out.tweet.text}\nedit ${edits} ${EDIT}` };
  return out;
}

describe('item requests whose deferred edit refreshes overlap, one Db per request (the dev server\'s shape)', { skip: SKIP }, () => {
  test('every response is 200, no background work fails, and the directory reopens', async () => {
    const dir = path.join(scratch, 'dev');
    const seedDb = createDb({ dir });
    await migrate(seedDb, { dirs: [{ namespace: 'engine', dir: ENGINE_MIGRATIONS }] });
    await runSetup({ db: seedDb, site, siteDir: SITE_DIR, log: () => {} });
    const maps = JSON.parse(readFileSync(path.join(SITE_DIR, 'seed', 'maps.json'), 'utf8'));
    const seedFetch = patchedFetch((kind, _id, json) => withClosedWindow(kind, json)).fetchImpl;
    const seeded = await seedDev({ db: seedDb, site, fetchImpl: seedFetch, now: () => new Date(WINDOW_CLOSES - 3_600_000) }, maps);
    await seedDb.end();
    const ids = seeded.filter((r) => r.status === 'added').map((r) => r.sourceId);
    assert.ok(ids.length >= 6, 'several seeded items');

    const edited = patchedFetch((kind, _id, json) => editedLong(kind, json));
    const fetchImpl = /** @type {typeof fetch} */ (async (input, init) => {
      await new Promise((resolve) => setTimeout(resolve, REFETCH_DELAY_MS));
      return edited.fetchImpl(input, init);
    });
    let clock = WINDOW_CLOSES + 3_600_000;
    /** @type {string[]} */ const logs = [];
    /** @type {Promise<unknown>[]} */ const pending = [];
    const handle = createHandler({
      routes, env: {}, log: (line) => logs.push(line), waitUntil: (p) => { pending.push(p); },
      makeDeps: () => ({ db: createDb({ dir }), site, fetchImpl, now: () => new Date((clock += 61_000)) }),
    });
    for (let round = 0; round < 4; round += 1) {
      /** @type {number[]} */ const statuses = [];
      // One after another, like a browser or curl: each response returns before its refresh has finished.
      for (const id of ids) statuses.push((await handle(new Request(`https://archive.example/api/item/translation/${id}`))).status);
      assert.deepEqual(statuses, ids.map(() => 200), `round ${round}: ${logs.join('\n')}`);
    }
    await Promise.all(pending);
    assert.deepEqual(logs, []);
    assert.ok(Object.keys(edited.calls).length >= ids.length, 'the deferred refreshes re-read the posts');

    const reopened = createDb({ dir });
    const { rows } = await reopened.query("select count(*)::int as n from item_sources where edit_finalized_at is not null");
    assert.ok(rows[0].n >= ids.length, 'the refreshes finalized the closed windows');
    await reopened.end();
  });
});
