// @ts-check
/**
 * `mount`/`on` are plain DOM calls with no framework, so they're tested
 * against small hand-rolled fakes rather than pulling in a DOM library:
 * real elements have `innerHTML`, `addEventListener`, `closest` and
 * `contains`, and that's all these two functions touch.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mount, on, applyColours, textShade, contrastRatio } from '../../public/js/core/dom.js';
import { html, raw } from '../../public/js/core/html.js';
import { FakeEl } from '../helpers/fakeDom.js';

/** A hex colour's RGB channels, for a simple "how far did textShade move it" distance in tests below. @param {string} hex @returns {number[]} */
function channels(hex) {
  const n = hex.replace('#', '');
  return [n.slice(0, 2), n.slice(2, 4), n.slice(4, 6)].map((part) => parseInt(part, 16));
}

/** @param {string} a @param {string} b @returns {number} */
function hexDistance(a, b) {
  const [ca, cb] = [channels(a), channels(b)];
  return Math.sqrt(ca.reduce((sum, v, i) => sum + (v - cb[i]) ** 2, 0));
}

class FakeElement {
  /** @param {string} tag @param {{ className?: string, children?: FakeElement[] }} [opts] */
  constructor(tag, opts = {}) {
    this.tagName = tag;
    this.className = opts.className ?? '';
    this.children = opts.children ?? [];
    /** @type {FakeElement|null} */
    this.parent = null;
    for (const child of this.children) child.parent = this;
    /** @type {Record<string, ((e: any) => void)[]>} */
    this.listeners = {};
    this.innerHTML = '';
  }
  /** @param {string} event @param {(e: any) => void} fn */
  addEventListener(event, fn) {
    (this.listeners[event] ??= []).push(fn);
  }
  /** @param {string} event @param {FakeElement} target */
  dispatch(event, target) {
    for (const fn of this.listeners[event] ?? []) fn({ type: event, target });
  }
  /** @param {FakeElement} node */
  contains(node) {
    for (let n = node; n; n = n.parent) if (n === this) return true;
    return false;
  }
  /** @param {string} selector */
  closest(selector) {
    for (let n = this; n; n = n.parent) if (n.className === selector.slice(1)) return n;
    return null;
  }
}

test('mount: sets innerHTML from SafeHtml markup', () => {
  const el = new FakeElement('div');
  mount(el, html`<b>${'<x>'}</b>`);
  assert.equal(el.innerHTML, '<b>&lt;x&gt;</b>');
});

test('mount: refuses a plain string (not SafeHtml)', () => {
  const el = new FakeElement('div');
  // @ts-expect-error -- deliberately wrong type, to prove mount() rejects it at runtime too
  assert.throws(() => mount(el, '<b>unsafe</b>'), TypeError);
});

test('mount: accepts raw()', () => {
  const el = new FakeElement('div');
  mount(el, raw('<i>already safe</i>'));
  assert.equal(el.innerHTML, '<i>already safe</i>');
});

test('on: delegates to a matching descendant, ignores clicks elsewhere', () => {
  const button = new FakeElement('button', { className: 'go' });
  const other = new FakeElement('span');
  const root = new FakeElement('div', { children: [button, other] });
  let calls = 0;
  on(root, '.go', 'click', () => {
    calls += 1;
  });
  root.dispatch('click', other);
  assert.equal(calls, 0);
  root.dispatch('click', button);
  assert.equal(calls, 1);
});

test('on: the handler receives the event and the matched element', () => {
  const button = new FakeElement('button', { className: 'go' });
  const root = new FakeElement('div', { children: [button] });
  /** @type {any[]} */
  const seen = [];
  on(root, '.go', 'click', (e, target) => seen.push([e.type, target]));
  root.dispatch('click', button);
  assert.deepEqual(seen, [['click', button]]);
});

test('applyColours: a valid #rrggbb data-c is applied as --c', () => {
  const coloured = new FakeEl({ 'data-c': '#ff8a3d' });
  const root = new FakeEl({}, [coloured]);
  applyColours(root);
  assert.equal(coloured.styleProps['--c'], '#ff8a3d');
});

test('applyColours: an invalid data-c (not a plain #rrggbb hex colour) is never applied', () => {
  const coloured = new FakeEl({ 'data-c': 'red; background:url(x)' });
  const root = new FakeEl({}, [coloured]);
  applyColours(root);
  assert.equal(coloured.styleProps['--c'], undefined);
});

test('applyColours: case-insensitive, but a short or non-hex value is rejected', () => {
  const upper = new FakeEl({ 'data-c': '#FF8A3D' });
  const short = new FakeEl({ 'data-c': '#fff' });
  const root = new FakeEl({}, [upper, short]);
  applyColours(root);
  assert.equal(upper.styleProps['--c'], '#FF8A3D');
  assert.equal(short.styleProps['--c'], undefined);
});

// `textShade` (review round 2, fix round 2, item 1): the light-mode tokens below
// (src/styles/tokens.css) are the engine's own --color-bg/--color-card/--color-ink.
const LIGHT_BG = '#f6efe3';
const LIGHT_CARD = '#fffdf8';
const LIGHT_INK = '#2b2233';

test('textShade: a colour that already reaches 4.5:1 is returned unchanged', () => {
  assert.equal(textShade('#000000', ['#ffffff'], '#000000'), '#000000');
});

test('textShade: a saturated orange (#ff8a3d) reaches >=4.5:1 against both light backgrounds once shaded', () => {
  const shaded = textShade('#ff8a3d', [LIGHT_BG, LIGHT_CARD], LIGHT_INK);
  assert.notEqual(shaded, '#ff8a3d', 'the raw colour does not already pass');
  assert.ok(contrastRatio(shaded, LIGHT_BG) >= 4.5, `${shaded} vs ${LIGHT_BG}: ${contrastRatio(shaded, LIGHT_BG)}`);
  assert.ok(contrastRatio(shaded, LIGHT_CARD) >= 4.5, `${shaded} vs ${LIGHT_CARD}: ${contrastRatio(shaded, LIGHT_CARD)}`);
});

test('textShade: luna (#6a5cd6) needs less mixing toward ink than sol (#c47a12), against the same light backgrounds', () => {
  const luna = textShade('#6a5cd6', [LIGHT_BG, LIGHT_CARD], LIGHT_INK);
  const sol = textShade('#c47a12', [LIGHT_BG, LIGHT_CARD], LIGHT_INK);
  assert.ok(
    hexDistance(luna, '#6a5cd6') < hexDistance(sol, '#c47a12'),
    `luna moved ${hexDistance(luna, '#6a5cd6')}, sol moved ${hexDistance(sol, '#c47a12')}`,
  );
});
