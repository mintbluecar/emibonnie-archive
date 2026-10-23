// @ts-check
/**
 * Task 10b: X's embed of the original post. `render()` is pure markup;
 * `bind()` is driven against the real rendered markup (miniDom) with a
 * fake `document`/`window` exposing just what it touches.
 */
import '../helpers/siteFixture.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MiniElement } from '../helpers/miniDom.js';
import { mount } from '../../public/js/core/dom.js';
// Dynamic import: see test/components/header.test.js for why.
const { render, bind, canEmbed, WIDGETS_SRC, WIDGETS_ID } = await import('../../public/js/components/sourceEmbed.js');

/** @type {import('../../src/http/contracts.js').SourceLinkVM} */
const LIVE = { role: 'primary', url: 'https://x.com/tl_alpha/status/1900000000000000004', status: 'live' };
const PROPS = { text: 'สวัสดี hello', author: { handle: 'tl_alpha', displayName: null }, source: LIVE, sourceLanguage: 'th' };

test('sourceEmbed: X\'s documented markup -- blockquote.twitter-tweet with data-dnt, the text (Thai in lang="th"), author and canonical link (labelled, not dated: Task 10b shows no post time)', () => {
  const markup = String(render(PROPS));
  assert.match(markup, /^\s*<blockquote class="twitter-tweet c-embed" data-dnt="true">/);
  assert.match(markup, /<span lang="th">สวัสดี<\/span>/);
  assert.match(markup, /&mdash; \(@tl_alpha\) <a class="c-embed__link" href="https:\/\/x\.com\/tl_alpha\/status\/1900000000000000004">original tweet<\/a>/);
  assert.ok(!markup.includes('<script'), 'never an inline script');
});

test('sourceEmbed: canEmbed accepts only a canonical https://x.com/<handle>/status/<id>', () => {
  assert.equal(canEmbed(LIVE), true);
  for (const url of ['https://twitter.com/a/status/1', 'http://x.com/a/status/1', 'https://x.com/a/status/1?x=1', 'https://x.com/a/status/1/photo/1', 'javascript:alert(1)']) {
    assert.equal(canEmbed({ ...LIVE, url }), false, url);
  }
  assert.equal(canEmbed(undefined), false);
});

/**
 * @param {{ dark: boolean }} options
 * @returns {{ head: MiniElement, byId: Map<string, MiniElement> }}
 */
function fakeBrowser({ dark }) {
  const head = new MiniElement('head');
  /** @type {Map<string, MiniElement>} */
  const byId = new Map();
  head.appendChild = (/** @type {any} */ node) => { byId.set(node.id, node); return MiniElement.prototype.appendChild.call(head, node); };
  globalThis.document = /** @type {any} */ ({
    head,
    getElementById: (/** @type {string} */ id) => byId.get(id) ?? null,
    createElement: (/** @type {string} */ tag) => new MiniElement(tag),
  });
  globalThis.window = /** @type {any} */ ({ matchMedia: (/** @type {string} */ q) => ({ matches: dark && q === '(prefers-color-scheme: dark)' }) });
  return { head, byId };
}

test('sourceEmbed.bind: adds widgets.js once (external, async) however many times it runs; dark mode sets data-theme="dark"', () => {
  const { head } = fakeBrowser({ dark: true });
  const root = new MiniElement('div');
  mount(/** @type {any} */ (root), render(PROPS));
  bind(/** @type {any} */ (root));
  bind(/** @type {any} */ (root));
  const scripts = head.querySelectorAll('script');
  assert.equal(scripts.length, 1);
  assert.equal(/** @type {any} */ (scripts[0]).src, WIDGETS_SRC);
  assert.equal(/** @type {any} */ (scripts[0]).id, WIDGETS_ID);
  assert.equal(/** @type {any} */ (scripts[0]).async, true);
  assert.equal(root.querySelector('blockquote')?.getAttribute('data-theme'), 'dark');
});

test('sourceEmbed.bind: light mode leaves data-theme unset; a page with no embed (or a gone post) loads nothing from X', () => {
  const { head } = fakeBrowser({ dark: false });
  const root = new MiniElement('div');
  mount(/** @type {any} */ (root), render(PROPS));
  bind(/** @type {any} */ (root));
  assert.equal(root.querySelector('blockquote')?.getAttribute('data-theme'), null);

  const second = fakeBrowser({ dark: false });
  const gone = new MiniElement('div');
  mount(/** @type {any} */ (gone), render({ ...PROPS, source: { ...LIVE, status: 'deleted' } }));
  bind(/** @type {any} */ (gone));
  assert.equal(second.head.querySelectorAll('script').length, 0);
  assert.equal(head.querySelectorAll('script').length, 1);
});
