// @ts-check
/**
 * Review round 1, I6: the header's search box and filter button did
 * nothing on pages other than home (`headerLinks.js` moved home's own
 * wiring into one shared place every page calls).
 */
import '../helpers/siteFixture.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MiniElement } from '../helpers/miniDom.js';
import { mount } from '../../public/js/core/dom.js';
// Dynamic import: see test/components/header.test.js for why.
const { render } = await import('../../public/js/components/header.js');
const { bind } = await import('../../public/js/components/headerLinks.js');

test('bind: focusing the search box sends the visitor to /search', () => {
  const root = new MiniElement('div');
  mount(root, render());
  /** @type {any} */ (globalThis).window = { location: { href: '' } };
  try {
    bind(root);
    const searchBox = /** @type {any} */ (root.querySelector('.c-header__search-box'));
    searchBox.dispatchEvent({ type: 'focus', target: searchBox });
    assert.equal(/** @type {any} */ (globalThis).window.location.href, '/search');
  } finally {
    delete (/** @type {any} */ (globalThis)).window;
  }
});

test('bind: clicking the filter button sends the visitor to /search?filters=1', () => {
  const root = new MiniElement('div');
  mount(root, render());
  /** @type {any} */ (globalThis).window = { location: { href: '' } };
  try {
    bind(root);
    const filterBtn = /** @type {any} */ (root.querySelector('.c-header__filter-btn'));
    filterBtn.dispatchEvent({ type: 'click', target: filterBtn });
    assert.equal(/** @type {any} */ (globalThis).window.location.href, '/search?filters=1');
  } finally {
    delete (/** @type {any} */ (globalThis)).window;
  }
});
