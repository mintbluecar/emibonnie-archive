// @ts-check
/**
 * DOM helpers used by page and component code. No framework: direct DOM
 * calls only, kept to this one small module so the escaping rule (only
 * `SafeHtml` ever reaches `innerHTML`) and event delegation are each done
 * in exactly one place.
 */
import { SafeHtml } from './html.js';

/**
 * Replaces `el`'s content with already-escaped markup. Throws if `safeHtml`
 * didn't come from `html`\`…\` or `raw()`, so a plain string can never
 * reach `innerHTML` by accident.
 * @param {{ innerHTML: string }} el
 * @param {SafeHtml} safeHtml
 * @returns {void}
 */
export function mount(el, safeHtml) {
  if (!(safeHtml instanceof SafeHtml)) {
    throw new TypeError('mount() expects SafeHtml, from html`…` or raw()');
  }
  el.innerHTML = safeHtml.toString();
}

/**
 * `mount()`, plus marking `root` ready for an e2e test to wait on
 * (`#app[data-ready]`) before inspecting the page -- every page's first
 * paint, whichever of success, 404 or a load error it ends up being,
 * calls this (instead of plain `mount()`) exactly once, so the marker
 * lives in this one shared place rather than in every page (review
 * round 2, C1). Never used for a page's later, partial re-renders
 * (e.g. item.js's body-only reload) -- those stay plain `mount()`.
 * @param {Element} root
 * @param {SafeHtml} safeHtml
 * @returns {void}
 */
export function mountPage(root, safeHtml) {
  mount(root, safeHtml);
  root.setAttribute('data-ready', '');
}

/**
 * A delegated event listener: `fn(event, target)` runs when `event` fires
 * on, or bubbles from, a descendant of `el` matching `selector`.
 * @param {{ addEventListener: (event: string, fn: (e: any) => void) => void, contains: (node: any) => boolean }} el
 * @param {string} selector
 * @param {string} event
 * @param {(e: any, target: any) => void} fn
 * @returns {void}
 */
export function on(el, selector, event, fn) {
  el.addEventListener(event, (e) => {
    const start = e.target;
    const target = start && typeof start.closest === 'function' ? start.closest(selector) : null;
    if (target && el.contains(target)) fn(e, target);
  });
}

/** A plain 6-digit hex colour (`#rrggbb`), the only shape `data-c` may carry. */
const COLOUR_PATTERN = /^#[0-9a-f]{6}$/i;

/** @param {string} hex @returns {number[]} */
function hexToRgb(hex) {
  const n = hex.replace('#', '');
  return [n.slice(0, 2), n.slice(2, 4), n.slice(4, 6)].map((part) => parseInt(part, 16));
}

/**
 * Quantises each channel to a whole 0-255 integer before hex-encoding --
 * the same 8-bit-per-channel rounding a browser applies when it actually
 * paints a colour (review round 2, fix round 3), so anything measured
 * against this function's output (`mixSrgb()`, below) reflects the real
 * rendered value, not an unrounded intermediate one.
 * @param {number[]} rgb @returns {string}
 */
function rgbToHex(rgb) {
  return `#${rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * `color-mix(in srgb, hex1 <frac1*100>%, hex2)`: direct channel
 * interpolation in gamma-encoded sRGB (0-255 per channel), matching
 * what that CSS function does -- not a linear-light mix.
 * @param {string} hex1 @param {string} hex2 @param {number} frac1 0-1, hex1's share
 * @returns {string}
 */
function mixSrgb(hex1, hex2, frac1) {
  const a = hexToRgb(hex1);
  const b = hexToRgb(hex2);
  return rgbToHex(a.map((v, i) => v * frac1 + b[i] * (1 - frac1)));
}

/** WCAG relative luminance. @param {string} hex @returns {number} */
function relativeLuminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The WCAG contrast ratio between two colours (1-21). @param {string} hexA @param {string} hexB @returns {number} */
export function contrastRatio(hexA, hexB) {
  const a = relativeLuminance(hexA);
  const b = relativeLuminance(hexB);
  const [lighter, darker] = a > b ? [a, b] : [b, a];
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * The real target, above WCAG AA's bare 4.5:1 (review round 2, fix round
 * 3): browsers quantise every colour to 8-bit (0-255) channels, and axe
 * measures that rendered value, not this module's maths -- a mix this
 * function judged exactly 4.50:1 (several example/real-site colours
 * landed there) can round to something a hair under 4.5:1 once actually
 * painted, and fail for real. Targeting 4.6:1 leaves enough margin that
 * 8-bit rounding can never tip a passing mix back under AA.
 */
const AA_TEXT_CONTRAST = 4.6;

/**
 * The smallest mix of `hex` toward `ink` (stepped by 1%) that reaches
 * `AA_TEXT_CONTRAST` against every colour in `bgHexes`, mixing the same
 * way CSS's `color-mix(in srgb, …)` does -- each candidate is quantised
 * to 8-bit channels (`mixSrgb()`'s `rgbToHex()`, the same whole-integer
 * 0-255 per channel a browser renders) *before* `contrastRatio()` ever
 * measures it, not after. Returns `hex` unchanged if it already passes
 * -- review round 2, fix round 2, item 1: a single flat 60% mix (the
 * previous fix) fails AA for some real person colours (e.g. #ff8a3d
 * only reaches 4.14:1 against --color-bg at a 60% mix) while
 * over-darkening others that needed far less; this instead finds the
 * least mixing each person's own colour actually needs, against
 * whatever it actually sits on.
 * @param {string} hex @param {string[]} bgHexes @param {string} ink
 * @returns {string}
 */
export function textShade(hex, bgHexes, ink) {
  const passes = (/** @type {string} */ candidate) => bgHexes.every((bg) => contrastRatio(candidate, bg) >= AA_TEXT_CONTRAST);
  if (passes(hex)) return hex;
  for (let pct = 99; pct >= 0; pct -= 1) {
    const mixed = mixSrgb(hex, ink, pct / 100); // already 8-bit-quantised, below
    if (passes(mixed)) return mixed;
  }
  return ink;
}

/**
 * The background(s) a `data-c` element's own coloured text actually sits
 * on, so `textShade()` checks against the real thing rather than a
 * flat approximation:
 *   - a bubble's name (`.c-bubbles__name`) sits on its `.c-bubbles__bub`'s
 *     own tint, `color-mix(in srgb, --c 12%, --color-card)` (bubbles.css)
 *   - a chip's `--on` text sits on its own on-tint,
 *     `color-mix(in srgb, --c 14%, --color-bg)` (chips.css)
 *   - a person header's name (`.c-person-header__name`) sits on the
 *     header card's own gradient, from `color-mix(in srgb, --c 12%,
 *     --color-card)` to 3% (personHeader.css, Task 9b), so both ends count
 *   - anything else: `--color-bg` and `--color-card`
 * Exported for its unit test.
 * @param {Element} node @param {string} colour @param {string} bg @param {string} card
 * @returns {string[]}
 */
export function textBackgroundsFor(node, colour, bg, card) {
  const is = (/** @type {string} */ selector) => typeof node.matches === 'function' && node.matches(selector);
  if (is('.c-bubbles__msg')) return [mixSrgb(colour, card, 0.12)];
  if (is('.c-chips__chip')) return [mixSrgb(colour, bg, 0.14)];
  if (is('.c-person-header')) return [mixSrgb(colour, card, 0.12), mixSrgb(colour, card, 0.03)];
  return [bg, card];
}

/** @returns {void} */
function installSchemeListener() {
  if (schemeListenerInstalled || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
  schemeListenerInstalled = true;
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyColours(document.body));
}

/** Set once `installSchemeListener()` has attached its (one, module-lifetime) listener. */
let schemeListenerInstalled = false;

/**
 * Sets one `[data-c]` node's `--c`, and (real browsers only -- `theme`
 * is `null` for a non-browser test environment with no
 * `document`/`getComputedStyle`) its `--c-text`.
 * @param {Element} node @param {string} colour @param {{ ink: string, bg: string, card: string }|null} theme
 * @returns {void}
 */
function applyOneColour(node, colour, theme) {
  const styled = /** @type {HTMLElement} */ (node);
  styled.style.setProperty('--c', colour);
  if (!theme) return;
  styled.style.setProperty('--c-text', textShade(colour, textBackgroundsFor(node, colour, theme.bg, theme.card), theme.ink));
}

/**
 * `--color-bg`/`--color-card`/`--color-ink`, read from computed styles
 * once -- `null` outside a real browser (no `document`/`getComputedStyle`,
 * e.g. a unit test), so callers skip the `--c-text` work entirely then.
 * @returns {{ ink: string, bg: string, card: string }|null}
 */
function currentTheme() {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return null;
  const rootStyle = getComputedStyle(document.documentElement);
  return {
    ink: rootStyle.getPropertyValue('--color-ink').trim(),
    bg: rootStyle.getPropertyValue('--color-bg').trim(),
    card: rootStyle.getPropertyValue('--color-card').trim(),
  };
}

/**
 * Applies every `[data-c]` descendant's colour as its own `--c` custom
 * property, but only when that `data-c` value is a plain `#rrggbb` hex
 * colour -- it ultimately traces back to a person's stored colour, not
 * this component's own markup, so it's validated here, the one place
 * every colour-carrying component's `bind()` goes through, before it
 * ever reaches a CSS custom property. CSP-safe: no inline `style`
 * attribute is ever written server-side, only `setProperty()` here.
 *
 * Also sets `--c-text`: a per-person text colour (`textShade()`, above)
 * guaranteed to reach AA against whatever that element's own text
 * actually sits on (`currentTheme()`/`applyOneColour()`, above).
 * Installs a `prefers-color-scheme` listener (once, module lifetime)
 * that re-runs this over the whole document, since a scheme change
 * flips the backgrounds and ink `--c-text` was computed against.
 * @param {Element} el
 * @returns {void}
 */
export function applyColours(el) {
  const theme = currentTheme();
  for (const node of el.querySelectorAll('[data-c]')) {
    const colour = node.getAttribute('data-c');
    if (colour && COLOUR_PATTERN.test(colour)) applyOneColour(node, colour, theme);
  }
  installSchemeListener();
}
