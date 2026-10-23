// @ts-check
/**
 * The X embed's crop (Task 10c, q; markup in sourceEmbed.js's `box()`):
 * the box is cut at `--embed-max-height` with a fade, and its expand
 * switch shows only while the content is taller than that. X resizes its
 * iframe after loading, so a `ResizeObserver` on the uncapped inner box
 * re-checks whenever the content's height changes. The switch toggles
 * `c-embed-box--open` (no cap), `aria-expanded`, and its own label;
 * focus stays on it.
 */

/** @param {Element} boxEl @returns {void} */
function update(boxEl) {
  const clip = /** @type {HTMLElement|null} */ (boxEl.querySelector('.c-embed-box__clip'));
  const inner = /** @type {HTMLElement|null} */ (boxEl.querySelector('.c-embed-box__inner'));
  const button = /** @type {HTMLElement|null} */ (boxEl.querySelector('.c-embed-box__more'));
  if (!clip || !inner || !button) return;
  const cap = parseFloat(getComputedStyle(boxEl).getPropertyValue('--embed-max-height')) || Infinity;
  const tall = inner.getBoundingClientRect().height > cap + 1;
  boxEl.classList.toggle('c-embed-box--tall', tall);
  button.hidden = !tall;
}

/** @param {Element} boxEl @param {HTMLElement} button @returns {void} */
function toggle(boxEl, button) {
  const open = boxEl.classList.toggle('c-embed-box--open');
  const label = button.getAttribute(open ? 'data-label-less' : 'data-label-more') ?? '';
  button.setAttribute('aria-expanded', open ? 'true' : 'false');
  button.setAttribute('title', label);
  button.setAttribute('aria-label', label);
}

/**
 * @param {Element} root
 * @returns {void}
 */
export function bind(root) {
  for (const boxEl of root.querySelectorAll('.c-embed-box')) {
    const button = /** @type {HTMLElement|null} */ (boxEl.querySelector('.c-embed-box__more'));
    const inner = boxEl.querySelector('.c-embed-box__inner');
    if (!button || !inner || typeof getComputedStyle !== 'function') continue;
    button.addEventListener('click', () => toggle(boxEl, button));
    update(boxEl);
    if (typeof ResizeObserver === 'function') new ResizeObserver(() => update(boxEl)).observe(inner);
  }
}
