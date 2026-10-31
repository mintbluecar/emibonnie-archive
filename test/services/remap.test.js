// @ts-check
/**
 * Task 10c (b): `npm run remap` -- re-points a marker on an archived item
 * (PGlite), updating its people as intake would, audited as 'system'.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IDS } from '../helpers/fixtures.js';
import { ingestDeps, ingestLong, rows, SYSTEM } from '../helpers/ingest.js';
import { createPeople } from '../../src/services/intakeRefs.js';
import { getPersonByHandle } from '../../src/repo/people.js';
import { runRemap, remapRefs } from '../../scripts/remap.js';
import { swapPeople, textMarkerFor } from '../../src/kinds/translation/remap.js';
import { BadRequest } from '../../src/domain/errors.js';

const RAIN = { igHandle: 'rain_x', displayName: 'Rain', emoji: '🌧️', colour: '#6b8cae' };

/** @param {any} db @param {number} itemId */
async function speakers(db, itemId) {
  const found = await rows(db, 'select marker, person_id, role from translation_speakers where item_id = $1 order by marker', [itemId]);
  return Object.fromEntries(found.map((r) => [r.marker, r.person_id ?? r.role]));
}

/** @param {any} db @param {number} itemId */
async function people(db, itemId) {
  return (await rows(db, 'select lower(p.display_name) as name, ip.role from item_people ip join people p on p.id = ip.person_id where ip.item_id = $1 order by 1, 2', [itemId]))
    .map((r) => `${r.name}/${r.role}`);
}

test('remap: a role marker becomes a known person -- speakers and item people change, audited as system, the text untouched', async () => {
  const deps = await ingestDeps();
  try {
    const long = await ingestLong(deps);
    const itemId = /** @type {number} */ (long.itemId);
    await createPeople(deps, [RAIN], SYSTEM);
    const bodyBefore = await rows(deps.db, 'select body from translation_parts where item_id = $1', [itemId]);
    const peopleBefore = await people(deps.db, itemId);
    assert.ok(!peopleBefore.some((p) => p.startsWith('rain/')));
    const [{ last }] = await rows(deps.db, 'select coalesce(max(id), 0) as last from audit_log');
    /** @type {string[]} */
    const lines = [];
    await runRemap({ args: [IDS.LONG, '🌧️=person:rain_x'], deps, log: (l) => lines.push(l) });
    const rain = /** @type {any} */ (await getPersonByHandle(deps.db, 'rain_x'));
    assert.equal((await speakers(deps.db, itemId))['🌧️'], rain.id);
    assert.deepEqual(await people(deps.db, itemId), [...peopleBefore, 'rain/present'].sort());
    assert.deepEqual(await rows(deps.db, 'select body from translation_parts where item_id = $1', [itemId]), bodyBefore);
    const audit = await rows(deps.db, "select table_name, action, actor from audit_log where id > $1 order by id", [last]);
    assert.deepEqual([...new Set(audit.map((r) => r.table_name))].sort(), ['item_people', 'translation_speakers'], 'only speakers and people were written');
    assert.ok(audit.every((r) => r.actor === 'system'), JSON.stringify(audit));
    assert.match(lines[0], /^remapped item \d+ \(1900000000000000001\): 🌧️=person:rain_x$/u);

    await runRemap({ args: [IDS.LONG, '🌧️=role:fan'], deps, log: () => {} });
    assert.equal((await speakers(deps.db, itemId))['🌧️'], 'fan');
    assert.deepEqual(await people(deps.db, itemId), peopleBefore, 'back to a role: the person it added is gone again, nobody else moved');
  } finally {
    await deps.db.end();
  }
});

test('remap refuses: a marker not in the text, an unknown person or role, an unarchived id, a hidden item, no pairs', async () => {
  const deps = await ingestDeps();
  try {
    const long = await ingestLong(deps);
    const run = (/** @type {string[]} */ args) => runRemap({ args, deps, log: () => {} });
    await assert.rejects(run([IDS.LONG, '🐸=role:fan']), (err) => err instanceof BadRequest && /not a marker in this item's text: 🐸/u.test(err.message));
    await assert.rejects(run([IDS.LONG, '🌧️=person:nobody_here']), (err) => err instanceof BadRequest && /unknown person for 🌧️: @nobody_here/u.test(err.message));
    await assert.rejects(run([IDS.LONG, '🌧️=role:mc']), (err) => err instanceof BadRequest && /unknown role/u.test(err.message));
    await assert.rejects(run(['1900000000000000098', '🌧️=role:fan']), (err) => err instanceof BadRequest && /no archived translation item for 1900000000000000098/u.test(err.message));
    await assert.rejects(run([IDS.LONG]), /usage: npm run remap/u);
    await assert.rejects(run([IDS.LONG, '🌧️=fan']), /want <marker>=person:<igHandle> or <marker>=role:<role>/u);
    await deps.db.transaction((tx) => tx.query("update items set deleted_at = now(), deleted_reason = 'hidden_by_owner' where id = $1", [long.itemId]), SYSTEM);
    await assert.rejects(run([IDS.LONG, '🌧️=role:fan']), (err) => err instanceof BadRequest && /hidden or removed/u.test(err.message));
  } finally {
    await deps.db.end();
  }
});

test('remapRefs: person and role pairs, a leading @ dropped, the bare ":" marker kept', () => {
  assert.deepEqual(remapRefs(['🌧️=person:@rain_x', ':=role:fan']), { '🌧️': { person: 'rain_x' }, ':': { role: 'fan' } });
});

// `remapTargetOf` moved to `scripts/cli.js` (as `dbTargetOf`, shared by
// every CLI script's `runCli`) -- see test/scripts/cli.test.js.

test('swapPeople: drops only what the old speakers gave, adds what the new ones give, keeps the rest in order', () => {
  const current = [{ personId: 1, role: 'present' }, { personId: 2, role: 'present' }, { personId: 9, role: 'present' }];
  const before = [{ personId: 1, role: 'present' }, { personId: 2, role: 'present' }];
  const after = [{ personId: 2, role: 'present' }, { personId: 3, role: 'present' }];
  assert.deepEqual(swapPeople(/** @type {any} */ (current), /** @type {any} */ (before), /** @type {any} */ (after)), [
    { personId: 2, role: 'present' }, { personId: 9, role: 'present' }, { personId: 3, role: 'present' },
  ]);
});

test('review M4: a marker typed without (or with) the variation selector matches the text\'s spelling, with a note; pending items are allowed', async () => {
  const deps = await ingestDeps();
  try {
    const long = await ingestLong(deps);
    await deps.db.transaction((tx) => tx.query("update items set review_state = 'pending' where id = $1", [long.itemId]), SYSTEM);
    /** @type {string[]} */
    const lines = [];
    await runRemap({ args: [IDS.LONG, '\u{1F327}=role:host'], deps, log: (l) => lines.push(l) });
    assert.equal(lines[0], 'using 🌧️ (with variation selector)');
    assert.equal((await speakers(deps.db, /** @type {number} */ (long.itemId)))['🌧️'], 'host');
  } finally {
    await deps.db.end();
  }
});

test('textMarkerFor: exact first, then the one marker differing only by U+FE0F; several is refused, none is null', () => {
  assert.equal(textMarkerFor('🌧️', ['🌧️']), '🌧️');
  assert.equal(textMarkerFor('\u{1F327}', ['🌧️', '🐶']), '🌧️');
  assert.equal(textMarkerFor('❤️', ['❤']), '❤');
  assert.equal(textMarkerFor('🐸', ['🌧️']), null);
  assert.throws(() => textMarkerFor('\u2764\uFE0F\uFE0F', ['\u2764', '\u2764\uFE0F']), /more than one marker/);
});
