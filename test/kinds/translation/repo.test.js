// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IDS } from '../../helpers/fixtures.js';
import { ingestDeps, ingest, rows, SYSTEM } from '../../helpers/ingest.js';
import { setLineFixes } from '../../../src/kinds/translation/repo.js';

test('setLineFixes writes only the delta, so unchanged fixes do not churn the audit log', async () => {
  const deps = await ingestDeps();
  try {
    const { itemId } = await ingest(deps, IDS.THREAD);
    const id = /** @type {number} */ (itemId);
    const unchanged = /** @type {any} */ ({ part: 0, line: 0, as: 'plain' });
    const before = /** @type {any} */ ({ part: 0, line: 1, as: 'speech', speaker: { role: 'host' } });
    const after = /** @type {any} */ ({ part: 0, line: 1, as: 'speech', speaker: { role: 'fan' } });

    await deps.db.transaction((/** @type {any} */ tx) => setLineFixes(tx, id, [unchanged, before]), SYSTEM);
    const [{ max }] = await rows(deps.db, 'select coalesce(max(id), 0)::int as max from audit_log');
    await deps.db.transaction((/** @type {any} */ tx) => setLineFixes(tx, id, [unchanged, after]), SYSTEM);

    const written = await rows(
      deps.db,
      "select action, changes from audit_log where table_name = 'translation_line_fixes' and row_key = $1 and id > $2 order by id",
      [String(id), max],
    );
    const deletedLines = written
      .filter((/** @type {any} */ r) => r.action === 'delete')
      .map((/** @type {any} */ r) => Number(r.changes?.line));
    assert.ok(!deletedLines.includes(0), 'the unchanged fix was not deleted');
    assert.ok(deletedLines.includes(1), 'the changed fix was rewritten');
    assert.equal(written.length, 2, 'one delete plus one insert, not a rewrite of both fixes');

    const stored = await rows(deps.db, 'select position, line, as_kind, role from translation_line_fixes where item_id = $1 order by position, line', [id]);
    assert.deepEqual(stored, [
      { position: 0, line: 0, as_kind: 'plain', role: null },
      { position: 0, line: 1, as_kind: 'speech', role: 'fan' },
    ]);
  } finally {
    await deps.db.end();
  }
});
