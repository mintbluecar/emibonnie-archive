// @ts-check
import '../helpers/siteFixture.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { FakeEl } from '../helpers/fakeDom.js';
// Dynamic import: see test/components/header.test.js for why.
const { render, renderCompact, bind } = await import('../../public/js/components/bubbles.js');

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

test('bubbles: an unmapped marker (name: null) shows "unknown speaker" as a visible name, no aria-label (review round 1, M2: consistent with a joint bubble\'s never-mapped component)', () => {
  /** @type {BubbleVM[]} */
  const bubbles = [{ kind: 'speech', emoji: '🌧️', name: null, text: 'mystery', cont: false }];
  const markup = String(render({ bubbles }));
  assert.match(markup, /<div class="c-bubbles__name">unknown speaker<\/div>/);
  assert.ok(!markup.includes('aria-label'));
});

test('bubbles: a joint bubble shows both emoji and names joined with " & ", neutral (no data-c)', () => {
  /** @type {BubbleVM[]} */
  const bubbles = [{ kind: 'joint', parts: [{ emoji: '👦🏻', name: 'host' }, { emoji: '👩🏻', name: 'host' }], text: 'hey!', cont: false }];
  const markup = String(render({ bubbles }));
  assert.ok(!markup.includes('data-c='));
  assert.ok(markup.includes('👦🏻') && markup.includes('👩🏻'));
  assert.match(markup, />host &amp; host</);
});

test('bubbles: a joint bubble\'s never-mapped component joins into the visible name as "unknown speaker", with no per-avatar aria-label (M2: not announced twice)', () => {
  /** @type {BubbleVM[]} */
  const bubbles = [{ kind: 'joint', parts: [{ emoji: '🐸', name: null }, { emoji: '👦🏻', name: 'host' }], text: 'mystery duo', cont: false }];
  const markup = String(render({ bubbles }));
  assert.ok(!markup.includes('aria-label'));
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

test('renderCompact (Task 9b): one paragraph of "emoji text" runs -- each speaker emoji is an img named for the speaker, a continuation has none, notes are left out, text stays escaped', () => {
  /** @type {BubbleVM[]} */
  const bubbles = [
    { kind: 'speech', emoji: '💜', name: 'luna', colour: '#6a5cd6', text: 'hi <b>', cont: false },
    { kind: 'speech', emoji: '💜', name: 'luna', colour: '#6a5cd6', text: 'again', cont: true },
    { kind: 'joint', parts: [{ emoji: '🧡', name: 'sol' }, { emoji: '💜', name: null }], text: 'both', cont: false },
    { kind: 'plain', text: 'context' },
    { kind: 'note', mark: '*', text: 'a footnote' },
  ];
  const markup = String(renderCompact({ bubbles }));
  assert.equal(markup.match(/<p class="c-bubbles-compact"/g)?.length, 1);
  assert.match(markup, /<span class="c-bubbles-compact__who c-emoji" role="img" aria-label="luna">💜<\/span> hi &lt;b&gt;/);
  assert.equal(markup.match(/aria-label="luna"/g)?.length, 1, 'the continuation line adds no second emoji');
  assert.match(markup, /aria-label="sol &amp; unknown speaker">🧡💜<\/span> both/);
  assert.match(markup, /context/);
  assert.ok(!markup.includes('a footnote'));
  assert.ok(!markup.includes('c-bubbles__bub'), 'no full bubbles');
});

test('renderCompact (Task 9b): an unmapped speaker is named "unknown speaker", same as a full bubble', () => {
  const markup = String(renderCompact({ bubbles: [{ kind: 'speech', emoji: '🐰', name: null, colour: null, text: 'x', cont: false }] }));
  assert.match(markup, /aria-label="unknown speaker">🐰/);
});

test('fix round 2: a speaker with no emoji (a bare ":" mapped to a role) gets a blank neutral avatar and its visible role name', () => {
  const markup = String(render({ bubbles: [{ kind: 'speech', emoji: '', name: 'fan', text: 'hello', cont: false }] }));
  assert.match(markup, /<div class="c-bubbles__avatar c-bubbles__avatar--none" aria-hidden="true"><\/div>/);
  assert.match(markup, /<div class="c-bubbles__name">fan<\/div>/);
  assert.ok(!markup.includes('data-c'));
});

test('fix round 2: compact, a speaker with no emoji shows its name as text ("fan:"), or "unknown speaker:" unmapped', () => {
  const mapped = String(renderCompact({ bubbles: [{ kind: 'speech', emoji: '', name: 'fan', text: 'hello', cont: false }] }));
  assert.match(mapped, /<span class="c-bubbles-compact__who c-bubbles-compact__who--name">fan:<\/span> hello/);
  assert.ok(!mapped.includes('role="img"'));
  const unmapped = String(renderCompact({ bubbles: [{ kind: 'speech', emoji: '', name: null, text: 'hello', cont: false }] }));
  assert.match(unmapped, /c-bubbles-compact__who--name">unknown speaker:<\/span>/);
});

test('Task 10c (o): an avatar\'s emoji sits in its own .c-emoji box, centred by the circle\'s grid', () => {
  const markup = String(render({ bubbles: [{ kind: 'speech', emoji: '🦁', name: 'host', text: 'hi', cont: false }] }));
  assert.match(markup, /<div class="c-bubbles__avatar"><span class="c-emoji">🦁<\/span><\/div>/);
  const css = readFileSync('src/styles/components/bubbles.css', 'utf8');
  assert.match(/\.c-bubbles__avatar\s*\{([^}]*)\}/.exec(css)?.[1] ?? '', /display:\s*grid;\s*place-items:\s*center;\s*line-height:\s*1/);
  assert.match(/\.c-emoji\s*\{([^}]*)\}/.exec(css)?.[1] ?? '', /line-height:\s*1;[\s\S]*translateY\(var\(--emoji-nudge-y\)\)/);
});

test('Task 10c (p): every bubble text box wraps a long unbroken string, and the bubble may shrink in its row', () => {
  const css = readFileSync('src/styles/components/bubbles.css', 'utf8');
  for (const cls of ['c-bubbles__bub', 'c-bubbles__crowd', 'c-bubbles__plain', 'c-bubbles__note', 'c-bubbles-compact']) {
    assert.match(new RegExp(`\\.${cls}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '', /overflow-wrap:\s*anywhere/, cls);
  }
  assert.match(/\.c-bubbles__bub\s*\{([^}]*)\}/.exec(css)?.[1] ?? '', /min-width:\s*0/);
});
