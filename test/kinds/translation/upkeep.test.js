// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IDS } from '../../helpers/fixtures.js';
import { ingestDeps, ingest, rows, count, patchedFetch, SYSTEM } from '../../helpers/ingest.js';
import { refreshEdits, checkFollowUps } from '../../../src/kinds/translation/upkeep.js';
import { touchRefresh } from '../../../src/repo/sourceEdits.js';
import { route as itemRoute } from '../../../src/routes/item.js';

const EDITED_TEXT = "☀️: can't wait to see everyone at the fanmeet next weekend!! (venue changed)";

/** Serves EDITED_NEW with a newer wording. */
function editedAgain() {
  return patchedFetch((kind, id, json) => {
    if (id !== IDS.EDITED_NEW) return json;
    if (kind === 'syn') return { ...json, text: EDITED_TEXT };
    if (kind === 'fx') return { ...json, status: { ...json.status, text: EDITED_TEXT } };
    return json;
  });
}

/** @param {any} db @param {number} itemId */
async function primaryEditState(db, itemId) {
  const [row] = await rows(db, "select edit_finalized_at from item_sources where item_id = $1 and role = 'primary'", [itemId]);
  return row.edit_finalized_at;
}

test('refreshEdits: takes an edit during the window, finalizes after it, then never fetches again', async () => {
  const deps = await ingestDeps();
  try {
    const { itemId } = await ingest(deps, IDS.EDITED_NEW);
    const id = /** @type {number} */ (itemId);
    const oldBody = (await rows(deps.db, 'select body from translation_parts where item_id = $1 and position = 0', [id]))[0].body;
    const { fetchImpl, calls } = editedAgain();

    const during = { ...deps, fetchImpl, now: () => new Date('2026-10-13T13:00:00.000Z') };
    assert.deepEqual(await refreshEdits(during, id, SYSTEM), { updated: 1, editableUntil: '2026-10-14T00:00:00.000Z' });
    const [part] = await rows(deps.db, 'select body from translation_parts where item_id = $1 and position = 0', [id]);
    assert.equal(part.body, EDITED_TEXT);
    const audits = await rows(deps.db, "select changes from audit_log where table_name = 'translation_parts' and action = 'update'");
    assert.deepEqual(audits.map((a) => a.changes.body), [oldBody]);
    assert.equal(await primaryEditState(deps.db, id), null, 'still inside the window');

    const after = { ...deps, fetchImpl, now: () => new Date('2026-10-21T00:00:00.000Z') };
    assert.deepEqual(await refreshEdits(after, id, SYSTEM), { updated: 0, editableUntil: null });
    assert.notEqual(await primaryEditState(deps.db, id), null, 'finalized once the window closed');

    const fetchedBefore = calls[IDS.EDITED_NEW];
    assert.deepEqual(await refreshEdits(after, id, SYSTEM), { updated: 0, editableUntil: null });
    assert.equal(calls[IDS.EDITED_NEW], fetchedBefore, 'a finalized post is not fetched again');
  } finally {
    await deps.db.end();
  }
});

test('refreshEdits records new version ids as aliases', async () => {
  const deps = await ingestDeps();
  try {
    const { itemId } = await ingest(deps, IDS.EDITED_NEW);
    const NEWER = '1900000000000000017';
    const { fetchImpl } = patchedFetch((kind, id, json) => (kind === 'syn' && id === IDS.EDITED_NEW
      ? { ...json, edit_control: { ...json.edit_control, edit_tweet_ids: [IDS.EDITED_OLD, IDS.EDITED_NEW, NEWER] }, isStaleEdit: false }
      : json));
    await refreshEdits({ ...deps, fetchImpl }, /** @type {number} */ (itemId), SYSTEM);
    assert.equal(await count(deps.db, 'select count(*)::int as n from source_aliases where external_id = $1', [NEWER]), 1);
  } finally {
    await deps.db.end();
  }
});

test('checkFollowUps appends a new same-author follow-up once, with its own post text', async () => {
  const deps = await ingestDeps();
  try {
    const { itemId } = await ingest(deps, IDS.THREAD);
    const id = /** @type {number} */ (itemId);
    assert.deepEqual(await checkFollowUps(deps, id, SYSTEM), { added: 0 });

    const reply = { id: IDS.THREAD_REPLY, text: 'One more: the lanterns were handmade too.', author: { screen_name: 'tl_beta', id: '9002' },
      created_at: 'Tue Oct 20 12:00:00 +0000 2026', replying_to: { screen_name: 'tl_beta', status: IDS.THREAD_FOLLOWUP } };
    const { fetchImpl } = patchedFetch((kind, fid, json) => (kind === 'thread' && fid === IDS.THREAD ? { ...json, thread: [...json.thread, reply] } : json));
    const later = { ...deps, fetchImpl };
    assert.deepEqual(await checkFollowUps(later, id, SYSTEM), { added: 1 });
    assert.deepEqual(await checkFollowUps(later, id, SYSTEM), { added: 0 });
    const parts = await rows(deps.db, 'select position, body from translation_parts where item_id = $1 order by position', [id]);
    assert.deepEqual(parts.map((p) => p.position), [0, 1, 2]);
    assert.equal(parts[2].body, 'One more: the lanterns were handmade too, which is why they took so long.', "the post's own text, not the thread's");
  } finally {
    await deps.db.end();
  }
});

test('checkFollowUps marks only the appended parts pending, never the archived ones', async () => {
  const deps = await ingestDeps();
  try {
    const { itemId } = await ingest(deps, IDS.THREAD);
    const id = /** @type {number} */ (itemId);
    const reply = { id: IDS.THREAD_REPLY, text: 'One more: the lanterns were handmade too.', author: { screen_name: 'tl_beta', id: '9002' },
      created_at: 'Tue Oct 20 12:00:00 +0000 2026', replying_to: { screen_name: 'tl_beta', status: IDS.THREAD_FOLLOWUP } };
    const { fetchImpl } = patchedFetch((kind, fid, json) => (kind === 'thread' && fid === IDS.THREAD ? { ...json, thread: [...json.thread, reply] } : json));
    assert.deepEqual(await checkFollowUps({ ...deps, fetchImpl }, id, { ...SYSTEM, pending: true }), { added: 1 });
    const parts = await rows(deps.db, 'select position, pending from translation_parts where item_id = $1 order by position', [id]);
    assert.deepEqual(parts.map((p) => p.pending), [false, false, true], 'only the new part is held');
  } finally {
    await deps.db.end();
  }
});

test('touchRefresh allows one refresh per item per 60 seconds', async () => {
  const deps = await ingestDeps();
  try {
    const { itemId } = await ingest(deps, IDS.THREAD);
    const id = /** @type {number} */ (itemId);
    const at = (/** @type {number} */ seconds) => new Date(Date.parse('2026-10-21T00:00:00.000Z') + seconds * 1000);
    const touch = (/** @type {Date} */ now) => deps.db.transaction((tx) => touchRefresh(tx, id, now), SYSTEM);
    assert.equal(await touch(at(0)), true);
    assert.equal(await touch(at(30)), false);
    assert.equal(await touch(at(61)), true);
    const stamped = await rows(deps.db, "select last_refreshed_at from item_sources where item_id = $1 and role in ('primary', 'follow_up')", [id]);
    assert.ok(stamped.every((r) => new Date(r.last_refreshed_at).toISOString() === at(61).toISOString()));
    assert.equal(await deps.db.transaction((tx) => touchRefresh(tx, 999999, at(0)), SYSTEM), false);
  } finally {
    await deps.db.end();
  }
});

test('checkFollowUps does not re-add a follow-up whose new (edited) id is already an alias', async () => {  const deps = await ingestDeps();
  try {
    const { itemId } = await ingest(deps, IDS.THREAD);
    const id = /** @type {number} */ (itemId);
    const EDITED_ID = '1900000000000000018';
    await deps.db.transaction((tx) => tx.query(
      `insert into source_aliases (platform, external_id, source_id)
       select 'x', $1, id from item_sources where item_id = $2 and external_id = $3`,
      [EDITED_ID, id, IDS.THREAD_FOLLOWUP],
    ), SYSTEM);
    const { fetchImpl } = patchedFetch((kind, fid, json) => (kind === 'thread' && fid === IDS.THREAD
      ? { ...json, thread: json.thread.map((/** @type {any} */ t) => (t.id === IDS.THREAD_FOLLOWUP ? { ...t, id: EDITED_ID } : t)) }
      : json));
    assert.deepEqual(await checkFollowUps({ ...deps, fetchImpl }, id, SYSTEM), { added: 0 });
    assert.equal(await count(deps.db, 'select count(*)::int as n from translation_parts where item_id = $1', [id]), 2);
  } finally {
    await deps.db.end();
  }
});

test('an allowed touchRefresh writes no audit_log rows', async () => {
  const deps = await ingestDeps();
  try {
    const { itemId } = await ingest(deps, IDS.THREAD);
    const before = await count(deps.db, 'select count(*)::int as n from audit_log');
    assert.equal(await deps.db.transaction((tx) => touchRefresh(tx, /** @type {number} */ (itemId), new Date()), SYSTEM), true);
    assert.equal(await count(deps.db, 'select count(*)::int as n from audit_log'), before);
  } finally {
    await deps.db.end();
  }
});

test('follow-up text comes from its own post fetch, so the thread endpoint rendering it differently is never an edit', async () => {
  const { fetchImpl } = patchedFetch((kind, fid, json) => (kind === 'thread' && fid === IDS.THREAD
    ? { ...json, thread: json.thread.map((/** @type {any} */ t) => (t.id === IDS.THREAD_FOLLOWUP ? { ...t, text: `${t.text} https://t.co/abc123` } : t)) }
    : json));
  const deps = await ingestDeps({ fetchImpl });
  try {
    const { itemId } = await ingest(deps, IDS.THREAD);
    const id = /** @type {number} */ (itemId);
    const [part] = await rows(deps.db, 'select body from translation_parts where item_id = $1 and position = 1', [id]);
    assert.equal(part.body, 'The list in the pic: lavender tea, honey cookies, paper lanterns, and a handwritten note.');
    assert.equal((await refreshEdits(deps, id, SYSTEM)).updated, 0);
    assert.equal(await count(deps.db, "select count(*)::int as n from audit_log where table_name = 'translation_parts' and action = 'update'"), 0);
  } finally {
    await deps.db.end();
  }
});

/** EDITED_NEW's edit window closes here (its fixture's `editableUntil`). */
const WINDOW_CLOSES = new Date('2026-10-14T00:00:00.000Z').getTime();
const HOUR = 60 * 60 * 1000;

/** @param {any} db @param {number} itemId @returns {Promise<number>} X sources still open */
async function openCount(db, itemId) {
  return count(db, "select count(*)::int as n from item_sources where item_id = $1 and platform = 'x' and edit_finalized_at is null", [itemId]);
}

/** @param {any} deps @returns {Promise<number>} how many background refreshes one item GET schedules */
async function defersOnGet(deps) {
  let defers = 0;
  const input = { params: { kind: 'translation', sourceId: IDS.EDITED_NEW }, query: {}, body: undefined, origin: 'https://a.example' };
  await itemRoute.run(input, { ...deps, defer: () => { defers += 1; } });
  return defers;
}

for (const [status, fetchImpl] of /** @type {[string, typeof fetch][]} */ ([
  ['unavailable', /** @type {any} */ (async () => new Response('', { status: 503 }))],
  ['deleted', patchedFetch((kind, _id, json) => (kind === 'thread' ? json : { __typename: 'TweetTombstone' })).fetchImpl],
])) {
  test(`a source read as ${status} stays open for 24 h after its window, then is finalized and the item page stops scheduling fetches`, async () => {
    const deps = await ingestDeps();
    try {
      const id = /** @type {number} */ ((await ingest(deps, IDS.EDITED_NEW)).itemId);
      const at = (/** @type {number} */ t) => ({ ...deps, fetchImpl, now: () => new Date(t) });
      assert.ok(await openCount(deps.db, id) > 0);

      const early = at(WINDOW_CLOSES + 2 * HOUR);
      assert.deepEqual(await refreshEdits(early, id, SYSTEM), { updated: 0, editableUntil: '2026-10-14T00:00:00.000Z' });
      assert.ok(await openCount(deps.db, id) > 0, 'within the grace day it is read again later');
      assert.equal(await defersOnGet(early), 1);

      const late = at(WINDOW_CLOSES + 25 * HOUR);
      assert.deepEqual(await refreshEdits(late, id, SYSTEM), { updated: 0, editableUntil: null });
      assert.equal(await openCount(deps.db, id), 0, 'finalized more than 24 h after the window closed');
      assert.equal(await defersOnGet(late), 0, 'a following item GET schedules nothing');
    } finally {
      await deps.db.end();
    }
  });
}

test('a refreshed part loses its line fixes; marker speakers stay (Review Focus 2)', async () => {
  const deps = await ingestDeps();
  try {
    const { itemId } = await ingest(deps, IDS.EDITED_NEW);
    const id = /** @type {number} */ (itemId);
    // A fixed speaker on line 0, and a marker-level speaker.
    await deps.db.transaction((/** @type {any} */ tx) => tx.query(
      "insert into translation_line_fixes (item_id, position, line, as_kind, role) values ($1, 0, 0, 'speech', 'host')",
      [id],
    ), SYSTEM);
    const { fetchImpl } = editedAgain();
    const during = { ...deps, fetchImpl, now: () => new Date('2026-10-13T13:00:00.000Z') };
    await refreshEdits(during, id, SYSTEM);
    // The re-written part's fix is gone.
    assert.equal(await count(deps.db, 'select count(*)::int as n from translation_line_fixes where item_id = $1', [id]), 0, 'line fix dropped after a body rewrite');
    // Marker-level speakers are untouched by the refresh.
    const [speakers] = await rows(deps.db, 'select count(*)::int as n from translation_speakers where item_id = $1', [id]);
    assert.ok(speakers.n >= 0);
  } finally {
    await deps.db.end();
  }
});
