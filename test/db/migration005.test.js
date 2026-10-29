// @ts-check
/**
 * Plan 3 Task 1: migration 005 — the skip reason, the attached row state,
 * and the job/state index.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { freshDb } from '../helpers/db.js';

/** @type {Awaited<ReturnType<typeof freshDb>>} */
let db;
before(async () => { db = await freshDb(); });
after(async () => { await db.end(); });

test('005 adds import_skipped and the attached row state', async () => {
  const { rows: reason } = await db.query("select code from deleted_reasons where code = 'import_skipped'");
  assert.equal(reason.length, 1);
  const { rows: row } = await db.transaction(async (tx) => {
    const { rows: job } = await tx.query("insert into import_jobs (source, created_by) values ('notion', 'system') returning id");
    return tx.query(
      "insert into import_rows (job_id, platform, external_id, state) values ($1, 'x', '123', 'attached') returning state",
      [job[0].id],
    );
  }, { actor: 'system' });
  assert.equal(row[0].state, 'attached');
});

test('005 adds the job/state index', async () => {
  const { rows } = await db.query("select indexname from pg_indexes where tablename = 'import_rows'");
  assert.ok(rows.some((r) => r.indexname === 'import_rows_job_state'));
});

test('an unknown row state is still refused', async () => {
  const jobId = await db.transaction(async (tx) => {
    const { rows } = await tx.query("insert into import_jobs (source, created_by) values ('paste', 'system') returning id");
    return rows[0].id;
  }, { actor: 'system' });
  await assert.rejects(
    db.transaction((tx) => tx.query("insert into import_rows (job_id, platform, external_id, state) values ($1, 'x', '9', 'made_up')", [jobId]), { actor: 'system' }),
    (/** @type {any} */ err) => err.code === '23514',
  );
});
