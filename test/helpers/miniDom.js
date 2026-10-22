// @ts-check
/**
 * A minimal, real DOM-ish implementation for testing page-level `bind()`
 * wiring (`public/js/pages/*.js`) end to end -- real `mount()`/`on()`
 * (`public/js/core/dom.js`), real component `render()`/`bind()` output,
 * against elements built either by parsing that real markup (`mount()`
 * sets `innerHTML`, which this parses) or by hand (`MiniElement`'s
 * constructor), the same spirit as `test/helpers/fakeDom.js`'s `FakeEl`
 * and `test/core/dom.test.js`'s `FakeElement`, just enough richer to
 * drive delegated listeners, `closest()`/`querySelector()` and
 * `appendChild()` against the actual generated markup. Not a general
 * browser: no layout, no CSS, no reflow -- only what `public/js/pages/*`
 * and `public/js/components/*` touch.
 */

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const TAG_TOKEN = /<!--[\s\S]*?-->|<\/([a-zA-Z0-9-]+)\s*>|<([a-zA-Z0-9-]+)((?:\s+[^<>]*?)?)\s*(\/)?>|([^<]+)/g;
const ATTR_TOKEN = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*"([^"]*)")?/g;

/** A text node: just enough shape for `appendChild`/`firstChild` moves. */
class MiniText {
  /** @param {string} text */
  constructor(text) {
    this.nodeType = 3;
    this.textContent = text;
    /** @type {MiniElement|null} */
    this.parentNode = null;
  }
}

export class MiniElement {
  /** @param {string} tagName */
  constructor(tagName) {
    this.nodeType = 1;
    this.tagName = tagName.toLowerCase();
    /** @type {Map<string,string>} */
    this.attrs = new Map();
    /** @type {(MiniElement|MiniText)[]} */
    this.children = [];
    /** @type {MiniElement|null} */
    this.parentNode = null;
    /** @type {Map<string, ((e: any) => void)[]>} */
    this.listeners = new Map();
    /** @type {Set<string>} */
    this.classes = new Set();
    this.disabled = false;
    this.hidden = false;
    this.value = '';
    /** @type {Record<string,string>} */
    this.styleProps = {};
    this.style = {
      setProperty: (/** @type {string} */ name, /** @type {string} */ value) => { this.styleProps[name] = value; },
      getPropertyValue: (/** @type {string} */ name) => this.styleProps[name] ?? '',
    };
    // A no-op stand-in for HTMLMediaElement.load(), which public/js/components/videoPlayer.js
    // calls after swapping a <video>'s src attribute.
    this.load = () => {};
  }

  get classList() {
    const self = this;
    return {
      add: (/** @type {string} */ c) => self.classes.add(c),
      remove: (/** @type {string} */ c) => self.classes.delete(c),
      contains: (/** @type {string} */ c) => self.classes.has(c),
      toggle: (/** @type {string} */ c, /** @type {boolean} */ [force]) => {
        const on = force !== undefined ? force : !self.classes.has(c);
        if (on) self.classes.add(c); else self.classes.delete(c);
        return on;
      },
    };
  }

  /** @param {string} name @returns {string|null} */
  getAttribute(name) {
    if (name === 'class') return [...this.classes].join(' ') || null;
    return this.attrs.has(name) ? /** @type {string} */ (this.attrs.get(name)) : null;
  }

  /** @param {string} name @param {string} value */
  setAttribute(name, value) {
    if (name === 'class') { this.classes = new Set(String(value).split(/\s+/).filter(Boolean)); return; }
    this.attrs.set(name, String(value));
  }

  /** @param {string} name */
  removeAttribute(name) {
    this.attrs.delete(name);
  }

  /** @param {MiniElement|MiniText} node */
  appendChild(node) {
    if (node.parentNode) node.parentNode.children = node.parentNode.children.filter((c) => c !== node);
    node.parentNode = this;
    this.children.push(node);
    return node;
  }

  remove() {
    if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((c) => c !== this);
    this.parentNode = null;
  }

  get firstChild() {
    return this.children[0] ?? null;
  }

  set innerHTML(html) {
    this.children = [];
    for (const node of parseFragment(html)) this.appendChild(node);
  }

  /** @param {string} type @param {(e: any) => void} fn */
  addEventListener(type, fn) {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  /** @param {{ type: string, target?: MiniElement }} event */
  dispatchEvent(event) {
    const target = event.target ?? this;
    const full = { ...event, target };
    for (let node = /** @type {MiniElement|null} */ (target); node; node = node.parentNode) {
      for (const fn of node.listeners.get(event.type) ?? []) fn(full);
    }
  }

  /** Convenience: dispatch a bubbling click as if the user activated this element (mouse, or Enter/Space on a real `<button>`). */
  click() {
    this.dispatchEvent({ type: 'click', target: this });
  }

  /** @param {MiniElement} node */
  contains(node) {
    for (let n = /** @type {MiniElement|null} */ (node); n; n = n.parentNode) if (n === this) return true;
    return false;
  }

  /** @param {string} selector @returns {MiniElement|null} */
  closest(selector) {
    const parts = parseSelector(selector);
    for (let n = /** @type {MiniElement|null} */ (this); n; n = n.parentNode) if (matchesChain(n, parts)) return n;
    return null;
  }

  /** @param {string} selector @returns {MiniElement|null} */
  querySelector(selector) {
    return querySelectorAll(this, selector)[0] ?? null;
  }

  /** @param {string} selector @returns {MiniElement[]} */
  querySelectorAll(selector) {
    return querySelectorAll(this, selector);
  }
}

/**
 * @typedef {{ tag: string|null, classes: string[], attrs: { name: string, value: string|null }[] }} SimplePart
 */

/** @param {string} selector @returns {SimplePart[]} one per space-separated (descendant) step */
function parseSelector(selector) {
  return selector.trim().split(/\s+/).map((compound) => {
    const tagMatch = /^[a-zA-Z0-9-]+/.exec(compound);
    /** @type {SimplePart} */
    const part = { tag: tagMatch ? tagMatch[0] : null, classes: [], attrs: [] };
    for (const m of compound.matchAll(/\.([a-zA-Z0-9_-]+)|\[([a-zA-Z0-9_-]+)(?:="([^"]*)")?\]/g)) {
      if (m[1]) part.classes.push(m[1]);
      else part.attrs.push({ name: m[2], value: m[3] ?? null });
    }
    return part;
  });
}

/** @param {MiniElement} el @param {SimplePart} part @returns {boolean} */
function matchesPart(el, part) {
  if (part.tag && el.tagName !== part.tag) return false;
  if (part.classes.some((c) => !el.classes.has(c))) return false;
  return part.attrs.every(({ name, value }) => (value === null ? el.attrs.has(name) : el.getAttribute(name) === value));
}

/** Real `closest()`/`matches()` semantics for a descendant-combinator chain. @param {MiniElement} el @param {SimplePart[]} parts @returns {boolean} */
function matchesChain(el, parts) {
  if (!matchesPart(el, parts[parts.length - 1])) return false;
  if (parts.length === 1) return true;
  for (let n = el.parentNode; n; n = n.parentNode) if (matchesChain(n, parts.slice(0, -1))) return true;
  return false;
}

/** @param {MiniElement} root @param {string} selector @returns {MiniElement[]} */
function querySelectorAll(root, selector) {
  const parts = parseSelector(selector);
  /** @type {MiniElement[]} */
  const found = [];
  const walk = (/** @type {MiniElement} */ node) => {
    for (const child of node.children) {
      if (child.nodeType === 1 && matchesChain(/** @type {MiniElement} */ (child), parts)) found.push(/** @type {MiniElement} */ (child));
      if (child.nodeType === 1) walk(/** @type {MiniElement} */ (child));
    }
  };
  walk(root);
  return found;
}

/** @param {string} attrString @returns {Map<string,string>} */
function parseAttrs(attrString) {
  const attrs = new Map();
  for (const m of attrString.matchAll(ATTR_TOKEN)) attrs.set(m[1], m[2] ?? '');
  return attrs;
}

/**
 * Parses a well-formed HTML fragment (our own `html`-tagged templates
 * always are: no scripts/styles, every tag closed) into a tree of
 * `MiniElement`/text nodes, and returns its top-level nodes.
 * @param {string} htmlText
 * @returns {(MiniElement|MiniText)[]}
 */
function parseFragment(htmlText) {
  /** @type {MiniElement[]} */
  const stack = [];
  /** @type {(MiniElement|MiniText)[]} */
  const top = [];
  const push = (/** @type {MiniElement|MiniText} */ node) => {
    const parent = stack[stack.length - 1];
    if (parent) parent.appendChild(node); else top.push(node);
  };
  for (const m of htmlText.matchAll(TAG_TOKEN)) {
    const [, closeTag, openTag, attrString, selfClose, text] = m;
    if (closeTag) {
      const idx = stack.map((e) => e.tagName).lastIndexOf(closeTag.toLowerCase());
      if (idx !== -1) stack.length = idx;
    } else if (openTag) {
      const el = new MiniElement(openTag);
      for (const [name, value] of parseAttrs(attrString ?? '')) el.setAttribute(name, value);
      push(el);
      if (!selfClose && !VOID_TAGS.has(el.tagName)) stack.push(el);
    } else if (text && text.trim() !== '') {
      push(new MiniText(text));
    }
  }
  return top;
}

/** A fake `document` exposing just `createElement`, for module code that calls it directly. */
export function fakeDocument() {
  return { createElement: (/** @type {string} */ tag) => new MiniElement(tag) };
}
