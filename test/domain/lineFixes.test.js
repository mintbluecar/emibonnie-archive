// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { partLines, unmappedMarkers, validateFixes } from '../../src/domain/lineFixes.js';
import { BadRequest } from '../../src/domain/errors.js';

const PARTS = ['🐶: hello\nplain bit', '🐱: world'];

test('partLines: a plain fix on a speech line shows the raw line', () => {
  const lines = partLines(PARTS, [{ part: 0, line: 0, as: 'plain' }]);
  assert.equal(lines[0].kind, 'plain');
  assert.equal(lines[0].text, '🐶: hello');
  assert.equal(lines[0].fixed, undefined);
});

test('partLines: a speech fix on a plain line', () => {
  const lines = partLines(PARTS, [{ part: 0, line: 1, as: 'speech', speaker: { person: 7 } }]);
  assert.equal(lines[1].kind, 'plain', 'a plain fix does not make a line speech unless told');
  // Now a speech fix on that plain line:
  const speech = partLines(PARTS, [{ part: 0, line: 1, as: 'speech', speaker: { role: 'host' } }]);
  assert.equal(speech[1].kind, 'plain', 'a speech fix on a plain line keeps it plain but attaches a speaker');
  assert.deepEqual(speech[1].fixed, { role: 'host' });
});

test('partLines: a speech fix overriding a marker mapping for one line only', () => {
  const lines = partLines(PARTS, [{ part: 0, line: 0, as: 'speech', speaker: { person: 9 } }]);
  assert.equal(lines[0].kind, 'speech');
  assert.equal(lines[0].marker, '🐶');
  assert.deepEqual(lines[0].fixed, { person: 9 });
  // The other line is untouched.
  assert.equal(lines[1].fixed, undefined);
});

test('partLines: an out-of-range fix is ignored', () => {
  const lines = partLines(PARTS, [{ part: 5, line: 0, as: 'plain' }]);
  assert.equal(lines[0].fixed, undefined);
  assert.equal(lines[0].kind, 'speech');
});

test('unmappedMarkers skips fixed lines', () => {
  const map = { '🐱': { role: 'host' } };
  // Without fixes, 🐶 is unmapped.
  assert.deepEqual(unmappedMarkers(PARTS, [], map), [{ marker: '🐶', count: 1 }]);
  // Fixing the 🐶 line removes it from the unmapped set.
  assert.deepEqual(unmappedMarkers(PARTS, [{ part: 0, line: 0, as: 'speech', speaker: { person: 1 } }], map), []);
});

test('validateFixes refusals', () => {
  assert.throws(() => validateFixes(PARTS, [{ part: 5, line: 0, as: 'plain' }]), BadRequest);
  assert.throws(() => validateFixes(PARTS, [{ part: 0, line: 9, as: 'plain' }]), BadRequest);
  assert.throws(() => validateFixes(PARTS, [
    { part: 0, line: 0, as: 'plain' }, { part: 0, line: 0, as: 'plain' },
  ]), BadRequest);
  assert.throws(() => validateFixes(PARTS, [{ part: 0, line: 0, as: 'speech', speaker: null }]), BadRequest);
  // Valid fixes pass.
  validateFixes(PARTS, [{ part: 0, line: 0, as: 'speech', speaker: { role: 'host' } }, { part: 1, line: 0, as: 'plain' }]);
});
