// @ts-check
/**
 * Spike (Plan 1a, Task 2, Step 2): proves Thai `pg_trgm` trigram search and
 * PGlite/Neon result-shape parity before the engine's search and db layers
 * are built on top of them.
 *
 * Always runs against an in-memory PGlite instance. When `DATABASE_URL` is
 * set, also runs the same probes against that Postgres (expected: the Neon
 * dev project, via its pooled `-pooler` endpoint) using a single checked-out
 * `Pool` client, so the set_config probe stays on one session.
 *
 * Reads and prints no tweet content; all sample text below is a fixed Thai
 * sentence invented for this spike, not fixture data.
 *
 * Run: node scripts/spikes/db.mjs
 * Run with Neon too: DATABASE_URL=<connection string> node scripts/spikes/db.mjs
 */
import { PGlite } from '@electric-sql/pglite';
// eslint-import-resolver-node (used by eslint-plugin-import) doesn't follow
// package.json subpath export patterns like `./contrib/*`; this import
// resolves fine at runtime (verified by running this script) and matches
// the path @electric-sql/pglite documents for the pg_trgm contrib module.
// eslint-disable-next-line import/no-unresolved
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { Pool } from '@neondatabase/serverless';

const THAI_NEEDLE = 'ครบถ้วน';
const THAI_FILLER = 'สวัสดีครับนี่คือข้อความทดสอบภาษาไทยสำหรับการค้นหา';
const ROW_COUNT = 5000;
const INSERT_CHUNK = 500;

/**
 * @typedef {{ query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> }} Session
 */

/**
 * `select show_trgm(...)` must return a non-empty array of trigrams.
 * @param {Session} session
 * @returns {Promise<unknown>}
 */
async function probeShowTrgm(session) {
  await session.query('create extension if not exists pg_trgm');
  const result = await session.query('select show_trgm($1) as t', [THAI_NEEDLE]);
  return result.rows[0].t;
}

/**
 * Builds `spike_trgm` with a GIN `gin_trgm_ops` index and `ROW_COUNT` rows
 * (one row in 37 containing the needle), then returns the EXPLAIN plan text
 * for an `ilike '%...%'` search, to check for a Bitmap Index Scan.
 * @param {Session} session
 * @returns {Promise<string>}
 */
async function probeGinIndexScan(session) {
  await session.query('drop table if exists spike_trgm');
  await session.query('create table spike_trgm (id serial primary key, body text)');
  await session.query('create index spike_trgm_body_idx on spike_trgm using gin (body gin_trgm_ops)');

  for (let start = 0; start < ROW_COUNT; start += INSERT_CHUNK) {
    const chunkSize = Math.min(INSERT_CHUNK, ROW_COUNT - start);
    /** @type {string[]} */
    const bodies = [];
    for (let offset = 0; offset < chunkSize; offset += 1) {
      const n = start + offset;
      bodies.push(n % 37 === 0 ? `${THAI_FILLER} ${THAI_NEEDLE} ${n}` : `${THAI_FILLER} ${n}`);
    }
    const placeholders = bodies.map((_, index) => `($${index + 1})`).join(',');
    await session.query(`insert into spike_trgm (body) values ${placeholders}`, bodies);
  }

  // Plain ANALYZE (without VACUUM) left stale relpages after the bulk
  // insert above and the planner chose a Seq Scan; VACUUM ANALYZE fixed it.
  await session.query('vacuum analyze spike_trgm');
  const plan = await session.query("explain select * from spike_trgm where body ilike '%ครบ%'");
  return plan.rows.map((row) => row['QUERY PLAN']).join('\n');
}

/**
 * Records whether the driver returns an `int8`/`bigint` value as a JS
 * string or a JS number.
 * @param {Session} session
 */
async function probeBigintRoundTrip(session) {
  const result = await session.query('select 1::bigint as v, pg_typeof(1::bigint) as t');
  const row = result.rows[0];
  return { value: row.v, jsType: typeof row.v, pgTypeofText: row.t };
}

/**
 * Records the raw JS value a `date` column round-trips as, with no date
 * parser registered (Task 7 registers one).
 * @param {Session} session
 */
async function probeDateRoundTrip(session) {
  const result = await session.query("select '2026-02-12'::date as d");
  const row = result.rows[0];
  return { value: row.d, jsType: typeof row.d };
}

/**
 * `set_config(..., true)` (the `is_local` transaction-scoped form) inside a
 * transaction, then confirms it has reverted after commit -- on the SAME
 * session, which matters on a pooled (`-pooler`) endpoint where separate
 * `pool.query()` calls can land on different backend connections.
 * @param {Session} session
 */
async function probeLocalSetConfig(session) {
  await session.query('begin');
  await session.query("select set_config('app.actor', 'x', true)");
  const inside = await session.query("select current_setting('app.actor', true) as s");
  await session.query('commit');
  const after = await session.query("select current_setting('app.actor', true) as s");
  return { insideTransaction: inside.rows[0].s, afterCommit: after.rows[0].s };
}

/**
 * @param {string} label
 * @param {Session} session
 */
async function runProbes(label, session) {
  console.log(`\n--- ${label} ---`);
  console.log('show_trgm:', JSON.stringify(await probeShowTrgm(session)));
  console.log('gin index scan plan:\n' + (await probeGinIndexScan(session)));
  console.log('bigint round-trip:', JSON.stringify(await probeBigintRoundTrip(session)));
  console.log('date round-trip:', JSON.stringify(await probeDateRoundTrip(session)));
  console.log('set_config(is_local) round-trip:', JSON.stringify(await probeLocalSetConfig(session)));
}

async function runPglite() {
  const db = new PGlite({ extensions: { pg_trgm } });
  try {
    await runProbes('PGlite', db);
  } finally {
    await db.close();
  }
}

async function runNeon() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.log('\n--- Neon ---\nskipped: DATABASE_URL not set');
    return;
  }
  const pool = new Pool({ connectionString });
  const client = await pool.connect();
  try {
    await runProbes('Neon (pooled, single checked-out client)', client);
  } finally {
    client.release();
    await pool.end();
  }
}

async function main() {
  await runPglite();
  await runNeon();
}

main();
