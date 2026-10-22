// @ts-check
import '../helpers/siteFixture.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FakeEl } from '../helpers/fakeDom.js';
// Dynamic import: see test/components/header.test.js for why.
const { render, bind } = await import('../../public/js/components/bubbles.js');

/** @typedef {import('../../src/http/contracts.js').BubbleVM} BubbleVM */

test('bubbles: a <script> text in a bubble renders escaped', () => {
  /** @type {BubbleVM[]} */
  const bubbles = [{ kind: 'speech', emoji: '🦊', name: 'sol', colour: '#ff8a3d', text: '<script>alert(1)</script>', cont: false }];
  const markup = String(render({ bubbles }));
  assert.ok(!markup.includes('<script>alert(1)</script>'));
  assert.match(markup, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('bubbles: a continuation bubble has no avatar or visible name', () => {
  /** @type {BubbleVM[]} */
  const bubbles = [
    { kind: 'speech', emoji: '🦊', name: 'sol', colour: '#ff8a3d', text: 'first', cont: false },
    { kind: 'speech', emoji: '🦊', name: 'sol', colour: '#ff8a3d', text: 'second', cont: true },
  ];
  const markup = String(render({ bubbles }));
  const contMsg = markup.split('c-bubbles__msg--cont')[1];
  assert.ok(contMsg, 'a continuation bubble was rendered');
  assert.ok(!contMsg.includes('c-bubbles__name'));
  assert.match(markup, /c-bubbles__avatar--blank/);
});

test('bubbles: an unmapped marker (name: null) gets an aria-label, not a visible name', () => {
  /** @type {BubbleVM[]} */
  const bubbles = [{ kind: 'speech', emoji: '🌧️', name: null, text: 'mystery', cont: false }];
  const markup = String(render({ bubbles }));
  assert.ok(!markup.includes('c-bubbles__name'));
  assert.match(markup, /aria-label="unknown speaker"/);
});

test('bubbles: a joint bubble shows both emoji and names joined with " & ", neutral (no data-c)', () => {
  /** @type {BubbleVM[]} */
  const bubbles = [{ kind: 'joint', parts: [{ emoji: '👦🏻', name: 'host' }, { emoji: '👩🏻', name: 'host' }], text: 'hey!', cont: false }];
  const markup = String(render({ bubbles }));
  assert.ok(!markup.includes('data-c='));
  assert.ok(markup.includes('👦🏻') && markup.includes('👩🏻'));
  assert.match(markup, />host &amp; host</);
});

test('bubbles: a joint bubble\'s never-mapped component gets an aria-label, same text as a solo unmapped marker', () => {
  /** @type {BubbleVM[]} */
  const bubbles = [{ kind: 'joint', parts: [{ emoji: '🐸', name: null }, { emoji: '👦🏻', name: 'host' }], text: 'mystery duo', cont: false }];
  const markup = String(render({ bubbles }));
  assert.match(markup, /aria-label="unknown speaker"/);
  assert.match(markup, />unknown speaker &amp; host</);
});

test('bubbles: a joint bubble\'s text and names are escaped, like any other bubble', () => {
  /** @type {BubbleVM[]} */
  const bubbles = [{ kind: 'joint', parts: [{ emoji: '👦🏻', name: '<b>host</b>' }, { emoji: '👩🏻', name: 'host' }], text: '<script>alert(1)</script>', cont: false }];
  const markup = String(render({ bubbles }));
  assert.ok(!markup.includes('<script>alert(1)</script>'));
  assert.ok(!markup.includes('<b>host</b>'));
  assert.match(markup, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(markup, /&lt;b&gt;host&lt;\/b&gt;/);
});

test('bubbles: a joint continuation bubble has no avatars or visible name', () => {
  /** @type {BubbleVM[]} */
  const bubbles = [
    { kind: 'joint', parts: [{ emoji: '👦🏻', name: 'host' }, { emoji: '👩🏻', name: 'host' }], text: 'first', cont: false },
    { kind: 'joint', parts: [{ emoji: '👦🏻', name: 'host' }, { emoji: '👩🏻', name: 'host' }], text: 'second', cont: true },
  ];
  const markup = String(render({ bubbles }));
  const contMsg = markup.split('c-bubbles__msg--cont')[1];
  assert.ok(contMsg, 'a continuation joint bubble was rendered');
  assert.ok(!contMsg.includes('c-bubbles__name'));
});

test('bubbles: no inline style or script attribute on a joint bubble (CSP)', () => {
  /** @type {BubbleVM[]} */
  const bubbles = [{ kind: 'joint', parts: [{ emoji: '👦🏻', name: 'host' }, { emoji: '👩🏻', name: 'host' }], text: 'hey!', cont: false }];
  const markup = String(render({ bubbles }));
  assert.ok(!markup.includes('style='));
  assert.ok(!markup.includes('onclick'));
});

test('bubbles: a crowd note renders', () => {
  /** @type {BubbleVM[]} */
  const bubbles = [{ kind: 'crowd', text: 'Ahhh~' }];
  const markup = String(render({ bubbles }));
  assert.match(markup, /<p class="c-bubbles__crowd">Ahhh~<\/p>/);
});

test('bubbles: notes collect into one .notes block at the end, wherever they sit in the list', () => {
  /** @type {BubbleVM[]} */
  const bubbles = [
    { kind: 'note', mark: '*', text: 'first note' },
    { kind: 'plain', text: 'a plain line' },
    { kind: 'note', mark: '**', text: 'second note' },
  ];
  const markup = String(render({ bubbles }));
  const notesIndex = markup.indexOf('c-bubbles__notes');
  const plainIndex = markup.indexOf('a plain line');
  assert.ok(notesIndex !== -1 && plainIndex !== -1);
  assert.ok(notesIndex > plainIndex, 'notes render after other bubbles even though one came first in the list');
  assert.match(markup, /\* first note/);
  assert.match(markup, /\*\* second note/);
});

test('bubbles: a Thai-script run gets lang="th" (site.sourceLanguage)', () => {
  /** @type {BubbleVM[]} */
  const bubbles = [{ kind: 'plain', text: 'hello ครบ world' }];
  const markup = String(render({ bubbles }));
  assert.match(markup, /<span lang="th">ครบ<\/span>/);
  assert.ok(markup.includes('hello '));
  assert.ok(markup.includes(' world'));
});

test('bind: applies each data-c colour as the --c custom property', () => {
  const coloured = new FakeEl({ 'data-c': '#ff8a3d' });
  const root = new FakeEl({}, [coloured]);
  bind(root);
  assert.equal(coloured.styleProps['--c'], '#ff8a3d');
});

test('bind: an invalid data-c is never applied, via the shared applyColours() validation', () => {
  const coloured = new FakeEl({ 'data-c': 'red; background:url(x)' });
  const root = new FakeEl({}, [coloured]);
  bind(root);
  assert.equal(coloured.styleProps['--c'], undefined);
});
