// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isSpeechLine, splitLines, findMarkers } from '../../src/domain/lines.js';
import { IDS, loadRaw } from '../helpers/fixtures.js';

/** @param {string} id */
function fxText(id) {
  return loadRaw(id).fx.status.text;
}

test('LONG: markers are exactly {🦁 🌧️ 🐶 🐱 🗣️}', () => {
  const lines = splitLines(fxText(IDS.LONG));
  const markers = new Set(findMarkers(lines).map((m) => m.marker));
  assert.deepEqual(markers, new Set(['🦁', '🌧️', '🐶', '🐱', '🗣️']));
});

test('LONG: has 2 footnotes', () => {
  const lines = splitLines(fxText(IDS.LONG));
  assert.equal(lines.filter((line) => line.kind === 'footnote').length, 2);
});

test('EVENT_B: the line with no marker is plain', () => {
  const lines = splitLines(fxText(IDS.EVENT_B));
  assert.deepEqual(lines[0], { kind: 'plain', text: 'SOLLUNA HAPPY DAY' });
});

test("'E: hi' is speech", () => {
  assert.equal(isSpeechLine('E: hi'), true);
});

test("':' at the start of a line forces plain, even with a marker-shaped prefix", () => {
  assert.equal(isSpeechLine(': a note from the translator'), false);
});

test('a label longer than 3 characters does not count as a marker', () => {
  assert.equal(isSpeechLine("translation: can't stop thinking about you"), false);
});

test('splitLines: line count equals the number of non-blank lines', () => {
  const text = fxText(IDS.LONG);
  const nonBlank = text.split('\n').filter((line) => line.trim().length > 0);
  assert.equal(splitLines(text).length, nonBlank.length);
});

test('splitLines: blank lines are skipped entirely', () => {
  assert.deepEqual(splitLines('🦁: hi\n\n🐱: hey'), [
    { kind: 'speech', marker: '🦁', text: 'hi' },
    { kind: 'speech', marker: '🐱', text: 'hey' },
  ]);
});

test('splitLines: a leading * plus a space is a footnote', () => {
  assert.deepEqual(splitLines('* a note'), [{ kind: 'footnote', mark: '*', text: 'a note' }]);
  assert.deepEqual(splitLines('** another note'), [{ kind: 'footnote', mark: '**', text: 'another note' }]);
});

test('findMarkers: tallies occurrences in order of first appearance', () => {
  const lines = splitLines('🦁: a\n🐱: b\n🦁: c');
  assert.deepEqual(findMarkers(lines), [
    { marker: '🦁', count: 2 },
    { marker: '🐱', count: 1 },
  ]);
});
