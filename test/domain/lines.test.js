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
    { kind: 'speech', marker: '🦁', markers: ['🦁'], text: 'hi' },
    { kind: 'speech', marker: '🐱', markers: ['🐱'], text: 'hey' },
  ]);
});

test('splitLines: a joint marker (2+ single-emoji graphemes run together) is one speech line with both markers', () => {
  assert.deepEqual(splitLines('👦🏻: a\n👩🏻: b\n👩🏻👦🏻: c'), [
    { kind: 'speech', marker: '👦🏻', markers: ['👦🏻'], text: 'a' },
    { kind: 'speech', marker: '👩🏻', markers: ['👩🏻'], text: 'b' },
    { kind: 'speech', marker: '👩🏻👦🏻', markers: ['👩🏻', '👦🏻'], text: 'c' },
  ]);
});

test('splitLines: a ZWJ sequence (family emoji) is a single marker, not split into a joint one', () => {
  assert.deepEqual(splitLines('👩‍👦: x'), [{ kind: 'speech', marker: '👩‍👦', markers: ['👩‍👦'], text: 'x' }]);
});

test('splitLines: a flag (regional indicator pair) is a single marker', () => {
  assert.deepEqual(splitLines('🇹🇭: x'), [{ kind: 'speech', marker: '🇹🇭', markers: ['🇹🇭'], text: 'x' }]);
});

test("splitLines: a short text label (\"P'Nam:\") is unchanged (never treated as joint)", () => {
  assert.deepEqual(splitLines("P'Nam: x"), [{ kind: 'plain', text: "P'Nam: x" }]);
});

test('splitLines: a joint-looking prefix with no colon is plain', () => {
  assert.deepEqual(splitLines('👩🏻👦🏻 text with no colon'), [{ kind: 'plain', text: '👩🏻👦🏻 text with no colon' }]);
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

test('findMarkers: counts a joint line\'s component markers, never the joint string, including the joint appearance in each component\'s count', () => {
  const lines = splitLines('👦🏻: a\n👩🏻: b\n👩🏻👦🏻: c');
  assert.deepEqual(findMarkers(lines), [
    { marker: '👦🏻', count: 2 },
    { marker: '👩🏻', count: 2 },
  ]);
});
