// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { report } from '../../scripts/add.js';

test('add report (fix round 2): a missing bare ":" marker is shown as the speaker.noEmoji copy, "(no emoji)"', () => {
  /** @type {string[]} */
  const lines = [];
  const code = report(/** @type {any} */ ({ status: 'needs_speakers', sourceId: '1', missing: [{ marker: ':', count: 2 }, { marker: '💜', count: 1 }] }), (l) => lines.push(l));
  assert.equal(code, 2);
  assert.deepEqual(lines.slice(1), ['  missing (no emoji) (2 lines)', '  missing 💜 (1 lines)']);
});
