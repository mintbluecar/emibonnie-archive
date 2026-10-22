// @ts-check
/**
 * `mount`/`on` are plain DOM calls with no framework, so they're tested
 * against small hand-rolled fakes rather than pulling in a DOM library:
 * real elements have `innerHTML`, `addEventListener`, `closest` and
 * `contains`, and that's all these two functions touch.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mount, on } from '../../public/js/core/dom.js';
import { html, raw } from '../../public/js/core/html.js';

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
