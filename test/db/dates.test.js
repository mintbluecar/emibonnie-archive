// @ts-check
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { freshDb } from '../helpers/db.js';
import { insertEvent } from '../helpers/seed.js';

/** @type {Awaited<ReturnType<typeof freshDb>>} */
let db;
before(async () => { db = await freshDb(); });
after(async () => { await db.end(); });

test("select occurred_on returns the string '2026-02-13'", async () => {
  await db.transaction((tx) => insertEvent(tx, { occurredOn: '2026-02-13' }), { actor: 'system' });
  const { rows } = await db.query('select occurred_on from events');
  assert.equal(rows[0].occurred_on, '2026-02-13');
});

test("a timestamptz at time zone 'Asia/Bangkok', cast to date, is '2026-02-13'", async () => {
  const { rows } = await db.query("select ('2026-02-12T17:30:00Z'::timestamptz at time zone 'Asia/Bangkok')::date as d");
  assert.equal(rows[0].d, '2026-02-13');
});

test('date arrays come back as YYYY-MM-DD strings too', async () => {
  const { rows } = await db.query("select array['2026-02-13'::date, '2026-02-14'::date] as ds");
  assert.deepEqual(rows[0].ds, ['2026-02-13', '2026-02-14']);
});

test('bigint (and bigint[]) come back as JS numbers on both drivers', async () => {
  const { rows } = await db.query('select 7::bigint as b, array[1::bigint, 2::bigint] as bs, count(*) as c from users');
  assert.equal(rows[0].b, 7);
  assert.deepEqual(rows[0].bs, [1, 2]);
  assert.equal(typeof rows[0].c, 'number');
});

test('a bigint beyond Number.MAX_SAFE_INTEGER stays an exact string rather than losing precision', async () => {
  const { rows } = await db.query('select 9007199254740993::bigint as b');
  assert.equal(rows[0].b, '9007199254740993');
});

test('identity ids from returning are numbers', async () => {
  const id = await db.transaction((tx) => insertEvent(tx, { slug: 'second' }), { actor: 'system' });
  assert.equal(typeof id, 'number');
});
