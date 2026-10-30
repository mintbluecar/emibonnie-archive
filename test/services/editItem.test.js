// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IDS } from '../helpers/fixtures.js';
import { ingestDeps, ingest, rows, count } from '../helpers/ingest.js';
import { signInUser } from '../../src/services/session.js';
import { canEdit, editItem, revertEdit, resolveForEdit, editableOf } from '../../src/services/editItem.js';
import { Forbidden, BadRequest, Conflict } from '../../src/http/errors.js';

/**
 * Runs `fn` against a fresh database, so no test sees another's items,
 * edits or settings.
 * @param {(ctx: { deps: any, user: (input: Parameters<typeof signInUser>[1]) => Promise<any>,
 *   owner: () => Promise<any> }) => Promise<void>} fn
 */
async function withDeps(fn) {
  const deps = await ingestDeps();
  try {
    /** @param {Parameters<typeof signInUser>[1]} input */
    const user = async (input) => (await signInUser({ db: deps.db, site: deps.site, now: () => new Date() }, input)).user;
    await fn({ deps, user, owner: () => user({ via: 'x', subject: '0', handle: 'owner' }) });
  } finally {
    await deps.db.end();
  }
}

test('canEdit: owner always, translator by credited account, submitter by created_by, else null', async () => {
  await withDeps(async ({ user, owner }) => {
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
});

test('a stranger gets 403', async () => {
  await withDeps(async ({ deps, user }) => {
    const stranger = await user({ via: 'x', subject: '10', handle: 'other' });
    await ingest(deps, IDS.EVENT_A);
    await assert.rejects(
      editItem(deps, { kind: 'translation', sourceId: IDS.EVENT_A, changes: { placement: 'unsorted' }, actor: stranger }),
      Forbidden,
    );
  });
});

test('submitter edits placement and event; event row unchanged', async () => {
  await withDeps(async ({ deps, user }) => {
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
});

test('the credited translator edits speakers and line fixes; the rows and the edit record change', async () => {
  await withDeps(async ({ deps, user }) => {
    await ingest(deps, IDS.EVENT_A);
    const translator = await user({ via: 'x', subject: '9002', handle: 'tl_beta' });
    const target = await resolveForEdit(deps, 'translation', IDS.EVENT_A, translator);
    assert.ok(target, 'the translator can reach the item');
    assert.equal(target.role, 'translator');

    const before = await editableOf(deps.db, target.kind, target.id);
    const marker = /** @type {string} */ (Object.keys(before.speakers)[0]);
    const speakers = { ...before.speakers, [marker]: { role: 'fan' } };
    const lineFixes = [/** @type {any} */ ({ part: 0, line: 0, as: 'plain' })];

    const { editId } = await editItem(deps, { kind: 'translation', sourceId: IDS.EVENT_A, changes: { speakers, lineFixes }, actor: translator });
    assert.equal(typeof editId, 'number');

    const [speaker] = await rows(deps.db, 'select person_id, role from translation_speakers where item_id = $1 and marker = $2', [target.id, marker]);
    assert.deepEqual(speaker, { person_id: null, role: 'fan' }, 'the marker now maps to a role');

    const [fix] = await rows(deps.db, 'select as_kind, person_id, role from translation_line_fixes where item_id = $1 and position = 0 and line = 0', [target.id]);
    assert.deepEqual(fix, { as_kind: 'plain', person_id: null, role: null }, 'the first line is forced plain');

    const [edit] = await rows(deps.db, 'select before, after from item_edits where id = $1', [editId]);
    assert.ok('speakers' in edit.after && 'lineFixes' in edit.after, 'the edit record holds both changes');
    assert.ok(!('text' in edit.after), 'the translator text is never part of an edit');
  });
});

test('a text field in changes is 400', async () => {
  await withDeps(async ({ deps, owner }) => {
    await ingest(deps, IDS.EVENT_A);
    await assert.rejects(
      editItem(deps, { kind: 'translation', sourceId: IDS.EVENT_A, changes: /** @type {any} */ ({ text: 'new text' }), actor: await owner() }),
      BadRequest,
    );
  });
});

test('every edit writes item_edits and audit_log', async () => {
  await withDeps(async ({ deps, owner }) => {
    const o = await owner();
    await ingest(deps, IDS.EVENT_A);
    await editItem(deps, { kind: 'translation', sourceId: IDS.EVENT_A, changes: { placement: 'unsorted' }, actor: o });
    assert.equal(await count(deps.db, "select count(*)::int as n from item_edits where item_id = (select item_id from item_sources where external_id = $1 and role = 'primary')", [IDS.EVENT_A]), 1);
    assert.ok(await count(deps.db, "select count(*)::int as n from audit_log where table_name = 'item_edits'") > 0);
  });
});

test('owner reverts an edit: the item goes back, and reverting twice is 409', async () => {
  await withDeps(async ({ deps, owner }) => {
    const o = await owner();
    await ingest(deps, IDS.EVENT_A);
    const query = "select i.placement, i.event_id from items i join item_sources s on s.item_id = i.id and s.role = 'primary' where s.external_id = $1";
    const [before] = await rows(deps.db, query, [IDS.EVENT_A]);
    assert.equal(before.placement, 'event');

    const { editId } = await editItem(deps, { kind: 'translation', sourceId: IDS.EVENT_A, changes: { placement: 'unsorted' }, actor: o });
    const { editId: revertId } = await revertEdit(deps, { kind: 'translation', sourceId: IDS.EVENT_A, editId, actor: o });
    assert.equal(typeof revertId, 'number');

    const [after] = await rows(deps.db, query, [IDS.EVENT_A]);
    assert.deepEqual(after, before, 'the revert restored the placement and event');

    await assert.rejects(
      revertEdit(deps, { kind: 'translation', sourceId: IDS.EVENT_A, editId, actor: o }),
      Conflict,
    );
  });
});

test('a revert is scoped to the item it addresses; another item is untouched', async () => {
  await withDeps(async ({ deps, owner }) => {
    const o = await owner();
    await ingest(deps, IDS.EVENT_A);
    const photo = await ingest(deps, IDS.PHOTO);
    const { editId } = await editItem(deps, { kind: 'translation', sourceId: IDS.EVENT_A, changes: { placement: 'unsorted' }, actor: o });

    const query = 'select placement, event_id from items where id = $1';
    const [before] = await rows(deps.db, query, [photo.itemId]);
    await assert.rejects(
      revertEdit(deps, { kind: 'translation', sourceId: IDS.PHOTO, editId, actor: o }),
      BadRequest,
      'an edit id from another item is refused',
    );
    const [after] = await rows(deps.db, query, [photo.itemId]);
    assert.deepEqual(after, before, 'the other item is untouched');
  });
});

test('an unknown event id is a 400, not a database error', async () => {
  await withDeps(async ({ deps, owner }) => {
    const o = await owner();
    await ingest(deps, IDS.EVENT_A);
    await assert.rejects(
      editItem(deps, { kind: 'translation', sourceId: IDS.EVENT_A, changes: { placement: 'event', eventId: 999999 }, actor: o }),
      BadRequest,
    );
  });
});

test('an edit deletes the entry\'s own page from the CDN and invalidates the rest (old and new relations)', async () => {
  await withDeps(async ({ deps, owner }) => {
    const added = await ingest(deps, IDS.EVENT_B);
    const [{ slug }] = await rows(deps.db, 'select e.slug from items i join events e on e.id = i.event_id where i.id = $1', [added.itemId]);
    /** @type {string[][]} */
    const deleted = [];
    /** @type {string[][]} */
    const invalidated = [];
    const purging = {
      ...deps, env: { VERCEL: '1' },
      dangerouslyDeleteByTag: async (/** @type {string[]} */ tags) => { deleted.push(tags); },
      invalidateByTag: async (/** @type {string[]} */ tags) => { invalidated.push(tags); },
    };
    await editItem(purging, { kind: 'translation', sourceId: IDS.EVENT_B, changes: { placement: 'unsorted' }, actor: await owner() });
    const own = `item:${added.itemId}`;
    assert.deepEqual(deleted.flat(), [own], 'only the edited entry\'s own tag is hard-deleted');
    const rest = invalidated.flat();
    assert.ok(!rest.includes(own), 'the entry\'s own tag is never merely invalidated');
    for (const tag of ['home', 'search', `event:${slug}`]) assert.ok(rest.includes(tag), `${tag} is invalidated: ${rest.join(',')}`);
  });
});
