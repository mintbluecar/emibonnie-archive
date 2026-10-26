// @ts-check
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { freshDb } from '../helpers/db.js';
import { insertItem, insertPerson } from '../helpers/seed.js';

/** @type {Awaited<ReturnType<typeof freshDb>>} */
let db;
before(async () => { db = await freshDb(); });
after(async () => { await db.end(); });

const system = { actor: 'system' };
const write = (/** @type {(tx: any) => Promise<unknown>} */ fn) => db.transaction(fn, system);
const pgError = (/** @type {string} */ code) => (/** @type {any} */ err) => err.code === code;

/** A translation item with a `translations` and a `translation_parts` row, so child tables can point at it. */
async function translationItem(tx) {
  const itemId = await insertItem(tx);
  await tx.query('insert into translations (item_id) values ($1)', [itemId]);
  await tx.query("insert into translation_parts (item_id, position, body) values ($1, 0, 'hello')", [itemId]);
  return itemId;
}

test('002 adds sessions, rate_limits, line fixes, item_edits, subbed and pending', async () => {
  await write(async (tx) => {
    const itemId = await translationItem(tx);

    // sessions: `subbed` and `pending` defaults are read from the migration's other tables below.
    await tx.query(
      "insert into sessions (token_hash, user_id, expires_at) values ('h1', 'system', now() + interval '7 days')",
    );
    await tx.query(
      "insert into rate_limits (key, window_start, hits) values ('signIn:ip:unknown', date_trunc('hour', now()), 1)",
    );
    await tx.query(
      "insert into translation_line_fixes (item_id, position, line, as_kind) values ($1, 0, 0, 'plain')",
      [itemId],
    );
    await tx.query(
      "insert into item_edits (item_id, before, after, created_by) values ($1, '{}', '{}', 'system')",
      [itemId],
    );
  });

  const translations = await db.query("select subbed from translations order by item_id");
  assert.equal(translations.rows.length, 1);
  assert.equal(translations.rows[0].subbed, false);

  const parts = await db.query("select pending from translation_parts order by item_id, position");
  assert.equal(parts.rows.length, 1);
  assert.equal(parts.rows[0].pending, false);
});

test('a plain line fix may not name a speaker', async () => {
  await assert.rejects(
    write(async (tx) => {
      const itemId = await translationItem(tx);
      const personId = await insertPerson(tx);
      await tx.query(
        "insert into translation_line_fixes (item_id, position, line, as_kind, person_id) values ($1, 0, 0, 'plain', $2)",
        [itemId, personId],
      );
    }),
    pgError('23514'),
  );
});

test('a speech line fix names exactly one of person or role', async () => {
  // Both set is rejected.
  await assert.rejects(
    write(async (tx) => {
      const itemId = await translationItem(tx);
      const personId = await insertPerson(tx);
      await tx.query(
        "insert into translation_line_fixes (item_id, position, line, as_kind, person_id, role) values ($1, 0, 0, 'speech', $2, 'host')",
        [itemId, personId],
      );
    }),
    pgError('23514'),
  );
  // Neither set is rejected.
  await assert.rejects(
    write(async (tx) => {
      const itemId = await translationItem(tx);
      await tx.query(
        "insert into translation_line_fixes (item_id, position, line, as_kind) values ($1, 0, 0, 'speech')",
        [itemId],
      );
    }),
    pgError('23514'),
  );
});

test('line fixes and item edits are audited; sessions are not', async () => {
  await write(async (tx) => {
    const itemId = await translationItem(tx);
    const personId = await insertPerson(tx);
    await tx.query(
      "insert into translation_line_fixes (item_id, position, line, as_kind, person_id) values ($1, 0, 0, 'speech', $2)",
      [itemId, personId],
    );
    await tx.query(
      "insert into item_edits (item_id, before, after, created_by) values ($1, '{}', '{}', 'system')",
      [itemId],
    );
    await tx.query(
      "insert into sessions (token_hash, user_id, expires_at) values ('h2', 'system', now() + interval '7 days')",
    );
  });
  const { rows } = await db.query(
    "select table_name, row_key from audit_log where table_name in ('translation_line_fixes', 'item_edits', 'sessions') order by table_name",
  );
  const tables = rows.map((r) => r.table_name);
  assert.ok(tables.includes('translation_line_fixes'));
  assert.ok(tables.includes('item_edits'));
  assert.ok(!tables.includes('sessions'), 'sessions must not be audited');
  const fixes = rows.find((r) => r.table_name === 'translation_line_fixes');
  assert.ok(fixes.row_key, 'line fixes audit by item_id');
});
