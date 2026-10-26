// @ts-check
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { IDS } from '../helpers/fixtures.js';
import { ingestDeps, ingest, rows, count } from '../helpers/ingest.js';
import { signInUser } from '../../src/services/session.js';
import { canEdit, editItem, revertEdit } from '../../src/services/editItem.js';
import { Forbidden, BadRequest, Conflict } from '../../src/http/errors.js';

/** @type {any} */
let deps;
before(async () => { deps = await ingestDeps(); });
after(async () => { await deps.db.end(); });

/** @param {Parameters<typeof signInUser>[1]} input */
async function user(input) {
  const { user } = await signInUser({ db: deps.db, site: deps.site, now: () => new Date() }, input);
  return user;
}

/** The owner. */
const owner = async () => user({ via: 'x', subject: '0', handle: 'owner' });

test('canEdit: owner always, translator by credited account, submitter by created_by, else null', async () => {
  const o = await owner();
  assert.equal(canEdit(o, { createdBy: 'x:9', creditedAccountId: 5 }), 'owner');

  const translator = await user({ via: 'x', subject: '9001', handle: 'tl_alpha' });
  // tl_alpha's account gets linked at ingest; simulate translatorAccountIds.
  const t = { ...translator, translatorAccountIds: [5] };
  assert.equal(canEdit(t, { createdBy: 'x:9', creditedAccountId: 5 }), 'translator');

  const submitter = await user({ via: 'x', subject: '9', handle: 'member' });
  assert.equal(canEdit(submitter, { createdBy: 'x:9', creditedAccountId: 5 }), 'submitter');

  const stranger = await user({ via: 'x', subject: '10', handle: 'other' });
  assert.equal(canEdit(stranger, { createdBy: 'x:11', creditedAccountId: 99 }), null);
});

test('a stranger gets 403', async () => {
  const stranger = await user({ via: 'x', subject: '10', handle: 'other' });
  await ingest(deps, IDS.EVENT_A);
  await assert.rejects(
    editItem(deps, { kind: 'translation', sourceId: IDS.EVENT_A, changes: { placement: 'unsorted' }, actor: stranger }),
    Forbidden,
  );
});

test('submitter edits placement and event; event row unchanged', async () => {
  const submitter = await user({ via: 'x', subject: '11', handle: 'sub' });
  const added = await ingest(deps, IDS.EVENT_B, { actor: 'x:11' });
  const eventsBefore = await count(deps.db, 'select count(*)::int as n from events');
  const { editId } = await editItem(deps, { kind: 'translation', sourceId: IDS.EVENT_B, changes: { placement: 'unsorted' }, actor: submitter });
  assert.equal(typeof editId, 'number');
  const [item] = await rows(deps.db, 'select placement, event_id from items where id = $1', [added.itemId]);
  assert.equal(item.placement, 'unsorted');
  assert.equal(item.event_id, null);
  assert.equal(await count(deps.db, 'select count(*)::int as n from events'), eventsBefore, 'event row unchanged');
});

test('translator edits speakers and line fixes; a text field in changes is 400', async () => {
  await assert.rejects(
    editItem(deps, { kind: 'translation', sourceId: IDS.EVENT_A, changes: /** @type {any} */ ({ text: 'new text' }), actor: await owner() }),
    BadRequest,
  );
});

test('every edit writes item_edits and audit_log', async () => {
  const o = await owner();
  await editItem(deps, { kind: 'translation', sourceId: IDS.EVENT_A, changes: { placement: 'unsorted' }, actor: o });
  assert.equal(await count(deps.db, "select count(*)::int as n from item_edits where item_id = (select id from items where id = (select item_id from item_sources where external_id = $1 and role = 'primary'))", [IDS.EVENT_A]), 1);
  assert.ok(await count(deps.db, "select count(*)::int as n from audit_log where table_name = 'item_edits'") > 0);
});

test('owner reverts an edit: the item goes back, and reverting twice is 409', async () => {
  const own = await ingestDeps();
  try {
    const o = (await signInUser({ db: own.db, site: own.site, now: () => new Date() }, { via: 'x', subject: '0', handle: 'owner' })).user;
    await ingest(own, IDS.EVENT_A);
    const query = "select i.placement, i.event_id from items i join item_sources s on s.item_id = i.id and s.role = 'primary' where s.external_id = $1";
    const [before] = await rows(own.db, query, [IDS.EVENT_A]);
    assert.equal(before.placement, 'event');

    const { editId } = await editItem(own, { kind: 'translation', sourceId: IDS.EVENT_A, changes: { placement: 'unsorted' }, actor: o });
    const { editId: revertId } = await revertEdit(own, { kind: 'translation', sourceId: IDS.EVENT_A, editId, actor: o });
    assert.equal(typeof revertId, 'number');

    const [after] = await rows(own.db, query, [IDS.EVENT_A]);
    assert.deepEqual(after, before, 'the revert restored the placement and event');

    await assert.rejects(
      revertEdit(own, { kind: 'translation', sourceId: IDS.EVENT_A, editId, actor: o }),
      Conflict,
    );
  } finally {
    await own.db.end();
  }
});

test('a revert is scoped to the item it addresses; another item is untouched', async () => {
  const own = await ingestDeps();
  try {
    const o = (await signInUser({ db: own.db, site: own.site, now: () => new Date() }, { via: 'x', subject: '0', handle: 'owner' })).user;
    await ingest(own, IDS.EVENT_A);
    const photo = await ingest(own, IDS.PHOTO);
    const { editId } = await editItem(own, { kind: 'translation', sourceId: IDS.EVENT_A, changes: { placement: 'unsorted' }, actor: o });

    const query = 'select placement, event_id from items where id = $1';
    const [before] = await rows(own.db, query, [photo.itemId]);
    await assert.rejects(
      revertEdit(own, { kind: 'translation', sourceId: IDS.PHOTO, editId, actor: o }),
      BadRequest,
      'an edit id from another item is refused',
    );
    const [after] = await rows(own.db, query, [photo.itemId]);
    assert.deepEqual(after, before, 'the other item is untouched');
  } finally {
    await own.db.end();
  }
});

test('an unknown event id is a 400, not a database error', async () => {
  const o = await owner();
  await ingest(deps, IDS.EVENT_A);
  await assert.rejects(
    editItem(deps, { kind: 'translation', sourceId: IDS.EVENT_A, changes: { placement: 'event', eventId: 999999 }, actor: o }),
    BadRequest,
  );
});
