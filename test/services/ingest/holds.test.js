// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IDS } from '../../helpers/fixtures.js';
import { ingestDeps, ingest, rows, SYSTEM } from '../../helpers/ingest.js';
import { set as setSetting } from '../../../src/repo/settings.js';

test('a pasted follow-up is held pending when approvalRequired is on', async () => {
  const deps = await ingestDeps();
  try {
    const thread = await ingest(deps, IDS.THREAD);
    assert.equal(thread.status, 'added');
    await deps.db.transaction((tx) => setSetting(tx, 'approvalRequired', true), SYSTEM);
    const attached = await ingest(deps, IDS.THREAD_REPLY);
    assert.equal(attached.status, 'attached');
    assert.equal(attached.pending, true, 'the attached follow-up part is held pending');
    const [part] = await rows(deps.db, 'select pending from translation_parts where item_id = $1 and position = 2', [thread.itemId]);
    assert.equal(part.pending, true);
  } finally {
    await deps.db.end();
  }
});

// --- Plan 3 Task 2: holdForReview -----------------------------------------

test('holdForReview makes a new item pending even with approval off', async () => {
  const deps = await ingestDeps();
  try {
    const result = await ingest(deps, IDS.NO_MARKERS, { allowUnmapped: true, holdForReview: true });
    assert.equal(result.status, 'pending');
    const [source] = await rows(deps.db, "select item_id from item_sources where role = 'primary' and external_id = $1", [IDS.NO_MARKERS]);
    const itemId = source.item_id;
    const [item] = await rows(deps.db, 'select review_state from items where id = $1', [itemId]);
    assert.equal(item.review_state, 'pending');
  } finally {
    await deps.db.end();
  }
});

test('holdForReview holds a pasted follow-up part when approval is off', async () => {
  const deps = await ingestDeps();
  try {
    const thread = await ingest(deps, IDS.THREAD);
    assert.equal(thread.status, 'added');
    const attached = await ingest(deps, IDS.THREAD_REPLY, { holdForReview: true });
    assert.equal(attached.status, 'attached');
    assert.equal(attached.pending, true, 'the new part waits for the owner');
    const [part] = await rows(deps.db, 'select pending from translation_parts where item_id = $1 order by position desc limit 1', [thread.itemId]);
    assert.equal(part.pending, true);
  } finally {
    await deps.db.end();
  }
});

test('without the flag, approval off still publishes immediately', async () => {
  const deps = await ingestDeps();
  try {
    const result = await ingest(deps, IDS.NO_MARKERS, { allowUnmapped: true });
    assert.equal(result.status, 'added');
    const [source] = await rows(deps.db, "select item_id from item_sources where role = 'primary' and external_id = $1", [IDS.NO_MARKERS]);
    const itemId = source.item_id;
    const [item] = await rows(deps.db, 'select review_state from items where id = $1', [itemId]);
    assert.equal(item.review_state, 'published');
  } finally {
    await deps.db.end();
  }
});
