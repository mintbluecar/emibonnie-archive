// @ts-check
/**
 * The add/edit form's options: the owner sees every non-deleted event
 * (an unpublished one too, so an entry can be moved into it); everyone
 * else sees visible events only.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { seededDeps } from '../helpers/ingest.js';
import { insertEvent } from '../helpers/seed.js';
import { addOptions } from '../../src/services/addFlow.js';

/** @type {Awaited<ReturnType<typeof seededDeps>>} */
let deps;
before(async () => { deps = await seededDeps(); });
after(async () => { await deps.db.end(); });

test('the owner’s options list an event with no visible entry; a member’s don’t; neither lists a deleted one', async () => {
  const empty = await deps.db.transaction((tx) => insertEvent(tx, { slug: '2036-01-01/empty', occurredOn: '2036-01-01' }), { actor: 'system' });
  const deleted = await deps.db.transaction(async (tx) => {
    const id = await insertEvent(tx, { slug: '2036-01-02/deleted', occurredOn: '2036-01-02' });
    await tx.query('update events set deleted_at = now() where id = $1', [id]);
    return id;
  }, { actor: 'system' });
  const owner = (await addOptions(deps, { owner: true })).events.map((e) => e.id);
  const member = (await addOptions(deps, { owner: false })).events.map((e) => e.id);
  assert.ok(owner.includes(empty));
  assert.ok(!member.includes(empty));
  assert.ok(!owner.includes(deleted) && !member.includes(deleted));
  assert.ok(member.length > 0 && member.every((id) => owner.includes(id)));
});

test('owner, 2026-11-09: with approval on, the owner’s own add publishes at once; anyone else’s waits', async () => {
  const { ingestDeps, ingest } = await import('../helpers/ingest.js');
  const { set } = await import('../../src/repo/settings.js');
  const { IDS } = await import('../helpers/fixtures.js');
  const { signInUser } = await import('../../src/services/session.js');
  const fresh = await ingestDeps();
  try {
    /** @param {string} subject @param {string} handle */
    const userId = async (subject, handle) => (await signInUser({ db: fresh.db, site: fresh.site, now: () => new Date() }, { via: 'x', subject, handle })).user.id;
    const owner = await userId('0', 'owner');
    const member = await userId('9', 'member');
    await fresh.db.transaction((tx) => set(tx, 'approvalRequired', true), { actor: 'system' });
    const byOwner = await ingest(fresh, IDS.EVENT_A, { actor: owner, byOwner: true });
    const byMember = await ingest(fresh, IDS.EVENT_B, { actor: member });
    assert.equal(byOwner.status, 'added');
    assert.equal(byMember.status, 'pending');
  } finally {
    await fresh.db.end();
  }
});
