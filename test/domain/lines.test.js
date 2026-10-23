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

test("fix round 2 (owner decision): a bare ':' then a space and a word is a speech line with the marker ':'", () => {
  assert.deepEqual(splitLines(': hello there'), [{ kind: 'speech', marker: ':', markers: [':'], text: 'hello there' }]);
  assert.deepEqual(splitLines('   : hello there'), [{ kind: 'speech', marker: ':', markers: [':'], text: 'hello there' }], 'after optional whitespace');
  assert.equal(isSpeechLine(': สวัสดี'), true, 'a word in any script');
});

test("fix round 2: a bare ':' with no words after it stays text -- ':)', ': ' alone, ':D'-style emoticons without a space", () => {
  assert.deepEqual(splitLines(':)'), [{ kind: 'plain', text: ':)' }]);
  assert.deepEqual(splitLines(': '), [{ kind: 'plain', text: ':' }]);
  assert.deepEqual(splitLines(':D so happy'), [{ kind: 'plain', text: ':D so happy' }]);
  assert.deepEqual(splitLines(': :)'), [{ kind: 'plain', text: ': :)' }]);
});

test("fix round 2: ':' never joins a joint marker", () => {
  const lines = splitLines('🧡💜: hi\n🧡:: hi\n: 🧡💜: hi\n:🧡💜: hi');
  for (const line of lines) {
    if (line.kind === 'speech' && line.markers.length > 1) assert.ok(!line.markers.includes(':'), JSON.stringify(line));
  }
  assert.deepEqual(lines[0].kind === 'speech' && lines[0].markers, ['🧡', '💜']);
});

test("fix round 2: findMarkers lists ':' like any other marker", () => {
  assert.deepEqual(findMarkers(splitLines(': hi\n💜: really?\n: more')), [{ marker: ':', count: 2 }, { marker: '💜', count: 1 }]);
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

// Review round 1, I1: the whole prefix is read (not a fixed-width window), and a joint marker is capped at 4 components.
test('splitLines: a 4-emoji joint marker keeps every speaker, none dropped', () => {
  assert.deepEqual(splitLines('👩🏻👦🏻👧🏻👶🏻: hi'), [
    { kind: 'speech', marker: '👩🏻👦🏻👧🏻👶🏻', markers: ['👩🏻', '👦🏻', '👧🏻', '👶🏻'], text: 'hi' },
  ]);
});

test('splitLines: a 5-emoji run exceeds the joint cap and stays plain', () => {
  assert.deepEqual(splitLines('👩🏻👦🏻👧🏻👶🏻🧑🏻: hi'), [{ kind: 'plain', text: '👩🏻👦🏻👧🏻👶🏻🧑🏻: hi' }]);
});

test('splitLines: a ZWJ sequence inside a joint marker is kept whole, not split', () => {
  assert.deepEqual(splitLines('👨‍👩‍👧‍👦👦🏻: x'), [
    { kind: 'speech', marker: '👨‍👩‍👧‍👦👦🏻', markers: ['👨‍👩‍👧‍👦', '👦🏻'], text: 'x' },
  ]);
});

test('splitLines: text mixed into a joint-looking prefix stays plain (not matched by a window)', () => {
  assert.deepEqual(splitLines('hello👦🏻👩🏻👧🏻: x'), [{ kind: 'plain', text: 'hello👦🏻👩🏻👧🏻: x' }]);
  assert.deepEqual(splitLines('sooo😭😭😭😭😭😭: lol'), [{ kind: 'plain', text: 'sooo😭😭😭😭😭😭: lol' }]);
});

// Review round 1, M1: keycaps and flags must match exactly (base character, or exactly 2 regional indicators).
test('splitLines: an invalid keycap-shaped grapheme (non-digit base) is plain, solo or joint', () => {
  assert.deepEqual(splitLines('x⃣: x'), [{ kind: 'plain', text: 'x⃣: x' }]);
  assert.deepEqual(splitLines('a⃣b⃣: x'), [{ kind: 'plain', text: 'a⃣b⃣: x' }]);
});

test('splitLines: a lone regional indicator (not a flag pair) is plain', () => {
  assert.deepEqual(splitLines('🇹: x'), [{ kind: 'plain', text: '🇹: x' }]);
});

test('splitLines: a valid keycap sequence is a single marker', () => {
  assert.deepEqual(splitLines('1️⃣: x'), [{ kind: 'speech', marker: '1️⃣', markers: ['1️⃣'], text: 'x' }]);
});

test('splitLines: a ZWJ pride flag sequence is a single marker', () => {
  assert.deepEqual(splitLines('🏳️‍🌈: x'), [{ kind: 'speech', marker: '🏳️‍🌈', markers: ['🏳️‍🌈'], text: 'x' }]);
});

// Review round 1, M1b: a number-only prefix (a clock time, a count) is never a marker.
test('splitLines: a number-only prefix is never a marker', () => {
  assert.deepEqual(splitLines('10:30 pm meet'), [{ kind: 'plain', text: '10:30 pm meet' }]);
  assert.deepEqual(splitLines('2: x'), [{ kind: 'plain', text: '2: x' }]);
  assert.deepEqual(splitLines('[10]: x'), [{ kind: 'plain', text: '[10]: x' }]);
});

test('splitLines: existing letter labels still work ("P\'Nam:" stays plain, as before; "EN:" is still a marker)', () => {
  assert.deepEqual(splitLines('EN: hi'), [{ kind: 'speech', marker: 'EN', markers: ['EN'], text: 'hi' }]);
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

test('findMarkers: a line whose only speech is a joint marker still yields both its components', () => {
  assert.deepEqual(findMarkers(splitLines('🐸🐱: x')), [
    { marker: '🐸', count: 1 },
    { marker: '🐱', count: 1 },
  ]);
});
