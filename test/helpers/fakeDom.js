// @ts-check
/**
 * A minimal DOM-ish fake for testing a component's `bind()`, which only
 * ever needs `querySelectorAll('[attr]')` plus `getAttribute` and
 * `style.setProperty` on what it finds (same hand-rolled-fake approach as
 * test/core/dom.test.js's `FakeElement`, scoped to what `bind()` touches).
 */

export class FakeEl {
  /** @param {Record<string,string>} [attrs] @param {FakeEl[]} [children] */
  constructor(attrs = {}, children = []) {
    this.attrs = attrs;
    this.children = children;
    /** @type {Record<string,string>} */
    this.styleProps = {};
    this.style = { setProperty: (/** @type {string} */ name, /** @type {string} */ value) => { this.styleProps[name] = value; } };
  }

  /** @param {string} name @returns {string|null} */
  getAttribute(name) {
    return Object.hasOwn(this.attrs, name) ? this.attrs[name] : null;
  }

  /**
   * Supports only the `[attr]` attribute-presence selector shape, which
   * is all every `bind()` in this codebase ever queries for.
   * @param {string} selector
   * @returns {FakeEl[]}
   */
  querySelectorAll(selector) {
    const match = /^\[([a-zA-Z0-9-]+)\]$/.exec(selector);
    if (!match) throw new Error(`FakeEl.querySelectorAll: unsupported selector ${selector}`);
    const attr = match[1];
    /** @type {FakeEl[]} */
    const found = [];
    const walk = (/** @type {FakeEl} */ node) => {
      for (const child of node.children) {
        if (Object.hasOwn(child.attrs, attr)) found.push(child);
        walk(child);
      }
    };
    walk(this);
    return found;
  }
}
