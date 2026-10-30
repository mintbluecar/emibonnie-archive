// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IDS } from '../../helpers/fixtures.js';
import { ingestDeps, ingest, ingestLong, rows, count, SYSTEM, HOST } from '../../helpers/ingest.js';
import { runAdd } from '../../../scripts/add.js';
import { kindsRegistry } from '../../../src/kinds/_registry.js';
import { createPeople } from '../../../src/services/intakeRefs.js';
import { BadRequest } from '../../../src/domain/errors.js';

const translation = kindsRegistry.translation;

test('speakers carry over between tweets by the same translator', async () => {
  const deps = await ingestDeps();
  try {
    const first = await ingest(deps, IDS.LONG);
    assert.equal(first.status, 'needs_speakers');
    assert.deepEqual(first.missing?.map((/** @type {any} */ m) => m.marker), ['🦁', '🌧️', '🐶', '🐱']);
    assert.equal(await count(deps.db, 'select count(*)::int as n from items'), 0);

    const long = await ingestLong(deps);
    assert.equal(long.status, 'added');
    const speakers = await rows(deps.db, 'select marker from translation_speakers where item_id = $1 order by marker', [long.itemId]);
    assert.deepEqual(speakers.map((r) => r.marker).sort(), ['🌧️', '🐱', '🐶', '🗣️', '🦁'].sort());

    const live = await ingest(deps, IDS.LIVE);
    assert.equal(live.status, 'added', `LIVE should not need 🐱 again: ${JSON.stringify(live.missing)}`);
  } finally {
    await deps.db.end();
  }
});

test('ingest: a component appearing only inside a joint line still ends up in `missing` (review round 1, I2/M4; task 7b, joint speaker lines)', async () => {
  const deps = await ingestDeps();
  try {
    const result = await ingest(deps, IDS.LIVE, { overrides: { text: '👦🏻👩🏻: hi everyone, joint from the start' } });
    assert.equal(result.status, 'needs_speakers');
    assert.deepEqual(result.missing?.map((/** @type {any} */ m) => m.marker).sort(), ['👦🏻', '👩🏻']);
  } finally {
    await deps.db.end();
  }
});

test('createPeople skips a known handle', async () => {
  const deps = await ingestDeps();
  try {
    assert.equal(await createPeople(deps, [HOST], SYSTEM), 1);
    assert.equal(await createPeople(deps, [HOST], SYSTEM), 0);
  } finally {
    await deps.db.end();
  }
});

test('scripts/add.js exits 2 on needs_speakers and lists the missing markers (offline)', async () => {
  const deps = await ingestDeps();
  try {
    /** @type {string[]} */
    const lines = [];
    const code = await runAdd({ args: [`https://x.com/tl_alpha/status/${IDS.LONG}`, '--map', '🌧️=fan'], deps, log: (l) => lines.push(l) });
    assert.equal(code, 2);
    assert.equal(lines[0], `needs_speakers ${IDS.LONG}`);
    assert.deepEqual(lines.slice(1, 4).map((l) => l.trim().split(' ')[1]), ['🦁', '🐶', '🐱']);
    assert.deepEqual(lines.slice(4), ['  new tag #SolLunaStarfest', '  new tag #fancamclip']);
    assert.equal(await count(deps.db, 'select count(*)::int as n from items'), 0);
    const added = await runAdd({ args: [IDS.EVENT_B], deps, log: () => {} });
    assert.equal(added, 0);
  } finally {
    await deps.db.end();
  }
});

test('a text-only tweet with no markers saves as plain with allowUnmapped (Review Focus 1)', async () => {
  const deps = await ingestDeps();
  try {
    // No markers at all: nothing to map, so it saves without any speaker step.
    const added = await ingest(deps, IDS.NO_MARKERS, { allowUnmapped: true });
    assert.equal(added.status, 'added');
    const [item] = await rows(deps.db, 'select placement from items where id = $1', [added.itemId]);
    assert.ok(item.placement);
    // Its page shows plain lines, nothing pinned.
    const details = /** @type {any} */ ((await translation.loadDetails(deps.db, [added.itemId])).get(added.itemId));
    assert.equal(details.subbed, false);
    assert.equal(details.fixes.length, 0);
    assert.equal(await count(deps.db, 'select count(*)::int as n from items'), 1);
  } finally {
    await deps.db.end();
  }
});

test('a text-only tweet with no markers also saves without allowUnmapped (nothing to map)', async () => {
  const deps = await ingestDeps();
  try {
    assert.equal((await ingest(deps, IDS.NO_MARKERS)).status, 'added');
  } finally {
    await deps.db.end();
  }
});

test('unmapped markers are allowed with allowUnmapped and reported in dryRun', async () => {
  const deps = await ingestDeps();
  try {
    const dry = await ingest(deps, IDS.LONG, { dryRun: true, allowUnmapped: true });
    assert.equal(dry.status, 'ready');
    assert.ok(Array.isArray(dry.unmapped));
    assert.ok(dry.unmapped.length > 0, 'LONG has unmapped markers');
    assert.ok(Array.isArray(dry.lines));
    assert.equal(await count(deps.db, 'select count(*)::int as n from items'), 0, 'dryRun writes nothing');
  } finally {
    await deps.db.end();
  }
});

test('subbed skips speakers and sets translations.subbed', async () => {
  const deps = await ingestDeps();
  try {
    const result = await ingest(deps, IDS.SUBBED, { subbed: true });
    assert.equal(result.status, 'added');
    const [row] = await rows(deps.db, 'select subbed from translations where item_id = $1', [result.itemId]);
    assert.equal(row.subbed, true);
    // Subbed skips the speaker mapping: no translation_speakers rows.
    assert.equal(await count(deps.db, 'select count(*)::int as n from translation_speakers where item_id = $1', [result.itemId]), 0);
  } finally {
    await deps.db.end();
  }
});

test('lineFixes are stored and invalid ones refused before any write', async () => {
  const deps = await ingestDeps();
  try {
    const chosen = { '🦁': { role: 'host' }, '🌧️': { role: 'fan' }, '🐶': { role: 'host' }, '🐱': { role: 'fan' } };
    const added = await ingest(deps, IDS.LONG, { chosen, lineFixes: [{ part: 0, line: 2, as: 'plain' }] });
    assert.equal(added.status, 'added');
    const fixes = await rows(deps.db, 'select position, line, as_kind from translation_line_fixes where item_id = $1 order by line', [added.itemId]);
    assert.deepEqual(fixes, [{ position: 0, line: 2, as_kind: 'plain' }]);

    await assert.rejects(ingest(deps, IDS.EVENT_B, { lineFixes: [{ part: 9, line: 0, as: 'plain' }] }), BadRequest);
    assert.equal(await count(deps.db, 'select count(*)::int as n from items'), 1, 'only the first item was written');
  } finally {
    await deps.db.end();
  }
});
