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
import { html } from '../../public/js/core/html.js';
// Dynamic import: see test/components/header.test.js for why.
const { render, bind, canEmbed, WIDGETS_SRC, WIDGETS_ID } = await import('../../public/js/components/sourceEmbed.js');

/** @type {import('../../src/http/contracts.js').SourceLinkVM} */
const LIVE = { role: 'primary', url: 'https://x.com/tl_alpha/status/1900000000000000004', status: 'live' };
const PROPS = { text: 'สวัสดี hello', author: { handle: 'tl_alpha', displayName: null }, source: LIVE, sourceLanguage: 'th' };

test('sourceEmbed: X\'s documented markup -- blockquote.twitter-tweet with data-dnt, the text (Thai in lang="th"), author and canonical link (labelled, not dated: Task 10b shows no post time)', () => {
  const markup = String(render(PROPS));
  assert.match(markup, /<blockquote class="twitter-tweet c-embed" data-dnt="true" data-cards="hidden" data-conversation="none">/);
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
  observers.length = 0;
  return { head, byId };
}

/** Every `IntersectionObserver` made since the last `fakeBrowser()`, with what it watches. */
/** @type {{ callback: Function, options: any, targets: any[], disconnected: boolean }[]} */
const observers = [];
globalThis.IntersectionObserver = /** @type {any} */ (class {
  /** @param {Function} callback @param {any} options */
  constructor(callback, options) {
    this.record = { callback, options, targets: /** @type {any[]} */ ([]), disconnected: false };
    observers.push(this.record);
  }
  /** @param {any} target */
  observe(target) { this.record.targets.push(target); }
  disconnect() { this.record.disconnected = true; }
});

/** Reports `isIntersecting` for every watched target of every live observer. @param {boolean} isIntersecting */
function intersect(isIntersecting) {
  for (const o of observers.filter((r) => !r.disconnected)) o.callback(o.targets.map((target) => ({ target, isIntersecting })));
}

test('sourceEmbed.bind: adds widgets.js once (external, async) however many times it runs; dark mode sets data-theme="dark"', () => {
  const { head } = fakeBrowser({ dark: true });
  const root = new MiniElement('div');
  mount(/** @type {any} */ (root), render(PROPS));
  bind(/** @type {any} */ (root));
  bind(/** @type {any} */ (root));
  intersect(true);
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
  intersect(true);
  assert.equal(root.querySelector('blockquote')?.getAttribute('data-theme'), null);

  const second = fakeBrowser({ dark: false });
  const gone = new MiniElement('div');
  mount(/** @type {any} */ (gone), render({ ...PROPS, source: { ...LIVE, status: 'deleted' } }));
  bind(/** @type {any} */ (gone));
  assert.equal(second.head.querySelectorAll('script').length, 0);
  assert.equal(head.querySelectorAll('script').length, 1);
});

test('sourceEmbed.css (fix round 1, M6): the fallback text keeps line breaks like "show original" (pre-wrap)', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../../src/styles/components/sourceEmbed.css', import.meta.url), 'utf8');
  assert.match(/\.c-embed__text\s*\{([^}]*)\}/.exec(css)?.[1] ?? '', /white-space:\s*pre-wrap/);
});

test('sourceEmbed (Task 10c l, q; 10d extra): X\'s embed (cards hidden, no parent post, no data-width: it fills the box) inside a box with an "original tweet" h2, a crop wrapper and a hidden "show full tweet" switch', () => {
  const markup = String(render(PROPS));
  assert.match(markup, /<section class="c-embed-box">\s*<h2 class="c-embed-box__label">original tweet<\/h2>/);
  assert.match(markup, /<div class="c-embed-box__clip"><div class="c-embed-box__inner">\s*<blockquote class="twitter-tweet c-embed"/);
  assert.match(markup, /<button class="c-embed-box__more" type="button" aria-expanded="false" title="show full tweet" aria-label="show full tweet"[^>]*data-label-less="show less"[^>]*hidden>/);
  assert.match(markup, /data-cards="hidden" data-conversation="none">/);
  assert.ok(!markup.includes('data-width'), 'X sizes the embed to its container, up to 550px (docs.x.com embedded-posts FAQ)');
  const gone = String(render({ ...PROPS, source: { ...PROPS.source, status: 'deleted' } }));
  assert.match(gone, /c-embed-box__clip[\s\S]*c-embed--gone/, 'the fallback for a gone post is cropped the same way');
});

test('sourceEmbed.bind (Task 10c f): a forced dark page (data-theme on <html>) themes the embed dark even on a light device', () => {
  const { head } = fakeBrowser({ dark: false });
  /** @type {any} */ (globalThis.document).documentElement = { getAttribute: (/** @type {string} */ k) => (k === 'data-theme' ? 'dark' : null) };
  const root = new MiniElement('div');
  mount(/** @type {any} */ (root), render(PROPS));
  bind(/** @type {any} */ (root));
  assert.equal(root.querySelector('blockquote')?.getAttribute('data-theme'), 'dark');
  assert.ok(head);
});

test('sourceEmbed (Task 10d extra): the box is the column\'s width up to X\'s 550px maximum, centred', async () => {
  const { readFileSync } = await import('node:fs');
  const tokens = readFileSync('src/styles/tokens.css', 'utf8');
  assert.match(tokens, /--embed-width:\s*min\(100%,\s*550px\);/);
  const css = readFileSync('src/styles/components/sourceEmbed.css', 'utf8');
  const block = /\.c-embed-box\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
  assert.match(block, /width:\s*var\(--embed-width\)/);
  assert.match(block, /margin-inline:\s*auto/);
});

test('Task 11: widgets.js is added once, when the first embed intersects (200px early), and the observer then disconnects', () => {
  const { head } = fakeBrowser({ dark: false });
  const root = new MiniElement('div');
  mount(/** @type {any} */ (root), html`${render(PROPS)}${render(PROPS)}`);
  bind(/** @type {any} */ (root));
  assert.equal(observers.length, 1);
  assert.equal(observers[0].options.rootMargin, '200px');
  assert.equal(observers[0].targets.length, 2, 'every embed is watched');
  assert.equal(head.querySelectorAll('script').length, 0, 'nothing from X before an embed nears the viewport');
  assert.equal(head.querySelectorAll('meta').length, 0);
  intersect(false);
  assert.equal(head.querySelectorAll('script').length, 0, 'an entry that isn\'t intersecting loads nothing');
  observers[0].callback([{ target: observers[0].targets[1], isIntersecting: true }]);
  assert.equal(head.querySelectorAll('script').length, 1);
  assert.equal(head.querySelectorAll('meta[name="twitter:widgets:csp"]').length, 1);
  assert.equal(observers[0].disconnected, true);
  bind(/** @type {any} */ (root));
  assert.equal(observers.length, 1, 'once widgets.js is on the page, no new observer');
  assert.equal(head.querySelectorAll('script').length, 1);
});
