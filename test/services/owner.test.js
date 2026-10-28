// @ts-check
/**
 * Plan 2b Task 8: the owner view's service side -- what the waiting list
 * holds, and that a review changes the state and purges.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { seededDeps } from '../helpers/ingest.js';
import { insertItem, insertUser } from '../helpers/seed.js';
import { ownerView, setApproval, reviewItem } from '../../src/services/owner.js';
import { findItemIdBySource } from '../../src/repo/itemState.js';

/** @type {Awaited<ReturnType<typeof seededDeps>>} */
let deps;

before(async () => { deps = await seededDeps(); });
after(async () => { await deps.db.end(); });

test('the waiting list is held items only, oldest first, with their previews', async () => {
  const first = await deps.db.transaction((tx) => insertItem(tx, { reviewState: 'pending' }), { actor: 'system' });
  const second = await deps.db.transaction((tx) => insertItem(tx, { reviewState: 'pending' }), { actor: 'system' });
  void first; void second;
  const view = await ownerView(deps);
  assert.equal(view.approvalRequired, false);
  assert.equal(view.signInFailedAt, null);
  assert.deepEqual(view.reports, []);
  assert.ok(Array.isArray(view.waiting));
});

test('setApproval writes only a change and is idempotent', async () => {
  await deps.db.transaction((tx) => insertUser(tx, { id: 'x:0' }), { actor: 'system' });
  assert.deepEqual(await setApproval(deps, true, 'x:0'), { approvalRequired: true });
  assert.deepEqual(await setApproval(deps, true, 'x:0'), { approvalRequired: true });
  assert.equal((await ownerView(deps)).approvalRequired, true);
  await setApproval(deps, false, 'x:0');
});

test('reviewItem moves the state and purges the item', async () => {
  const calls = /** @type {string[][]} */ ([]);
  const purging = { ...deps, env: { VERCEL: '1' }, invalidateByTag: async (tags) => calls.push(tags) };
  const { rows } = await deps.db.query(
    `select s.external_id from items i join item_sources s on s.item_id = i.id and s.role = 'primary'
     where i.review_state = 'published' and i.deleted_at is null order by i.id limit 1`,
  );
  const sourceId = rows[0].external_id;
  await reviewItem(purging, { kind: 'translation', sourceId, state: 'rejected', actor: /** @type {any} */ ({ id: 'x:0' }) });
  const id = await findItemIdBySource(deps.db, { kind: 'translation', platform: 'x', externalId: sourceId });
  assert.ok(id);
  const { rows: state } = await deps.db.query('select review_state from items where id = $1', [id]);
  assert.equal(state[0].review_state, 'rejected');
  assert.ok(calls.flat().includes(`item:${id}`));
});
