// @ts-check
/**
 * The "check for update" button (task-4 brief): shown only while
 * `editOpenUntil` is in the future. Posts to `/api/item/:kind/:sourceId/refresh`,
 * then re-renders the bubbles when `updated > 0`. `throttled: true` (the
 * server's own 60 s guard) is treated as a normal check -- the lock here
 * is the *browser's* own, separate backoff (owner's ruling 1): 1 min
 * after the 1st press, 5 min after the 2nd, 15 min after the 3rd on,
 * kept per translation in `localStorage` behind try/catch, falling back
 * to an in-memory `Map` when storage isn't available (private browsing,
 * quota, etc). A 409 (the edit window has closed) removes the button.
 */
import { html } from '../core/html.js';
import { on } from '../core/dom.js';
import { t, site } from '../core/site.js';
import { timePair } from '../core/format.js';
import { nextLockMs } from './backoff.js';

/** @typedef {{ count: number, lockedUntil: number }} ThrottleState */

/** In-memory fallback, shared across every button on the page, keyed the same as `localStorage`. */
const memoryStore = new Map();

/** @param {string} kind @param {string} sourceId @returns {string} */
const storageKey = (kind, sourceId) => `fa:refresh:${kind}:${sourceId}`;

/**
 * Reads `localStorage`, behind try/catch; only consults the in-memory
 * fallback when `localStorage` itself is unavailable or throws -- a
 * legitimate "no state yet" read (a present `localStorage` returning
 * `null`) must stay `null`, not shadow-read a stale in-memory value.
 * @param {string} key @returns {ThrottleState|null}
 */
function loadState(key) {
  try {
    if (globalThis.localStorage) {
      const raw = globalThis.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    }
  } catch {
    // falls through to the in-memory store below
  }
  return memoryStore.get(key) ?? null;
}

/** @param {string} key @param {ThrottleState} state @returns {void} */
function saveState(key, state) {
  try {
    if (globalThis.localStorage) { globalThis.localStorage.setItem(key, JSON.stringify(state)); return; }
  } catch {
    // falls through to the in-memory store below
  }
  memoryStore.set(key, state);
}

/**
 * @param {{ editOpenUntil: string|null, now?: Date }} props
 * @returns {import('../core/html.js').SafeHtml}
 */
export function render({ editOpenUntil, now = new Date() }) {
  if (!editOpenUntil || new Date(editOpenUntil).getTime() <= now.getTime()) return html``;
  return html`
    <div class="c-refresh">
      <button type="button" class="c-refresh__btn">
        ${t('item.checkUpdate')} · ${t('item.editableUntil', { time: timePair(editOpenUntil, site.timezone) })}
      </button>
    </div>
  `;
}

/** @param {number} ms @returns {string} `m:ss` */
function formatCountdown(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

/**
 * Disables the button and counts down its lock, re-enabling it once
 * `lockedUntil` passes.
 * @param {HTMLButtonElement} button @param {number} lockedUntil
 * @returns {void}
 */
function startCountdown(button, lockedUntil) {
  const original = button.textContent;
  const tick = () => {
    const remaining = lockedUntil - Date.now();
    if (remaining <= 0) {
      button.disabled = false;
      button.textContent = original;
      return;
    }
    button.disabled = true;
    button.textContent = t('item.tryLater', { time: formatCountdown(remaining) });
    // `unref()` (Node only) keeps a lingering timer from holding a test
    // process open; real browsers simply don't have the method.
    /** @type {any} */ (setTimeout(tick, 1000))?.unref?.();
  };
  tick();
}

/**
 * @param {{ kind: string, sourceId: string }} target
 * @returns {{ key: string, pressCount: number, lockedUntil: number }}
 */
function registerPress(target) {
  const key = storageKey(target.kind, target.sourceId);
  const current = loadState(key);
  const pressCount = (current?.count ?? 0) + 1;
  const lockedUntil = Date.now() + nextLockMs(pressCount);
  saveState(key, { count: pressCount, lockedUntil });
  return { key, pressCount, lockedUntil };
}

/**
 * @param {Element} el the element containing the rendered `.c-refresh`
 * @param {{ kind: string, sourceId: string }} target
 * @param {(result: { updated: number }) => void} onUpdated
 * @returns {void}
 */
export function bind(el, target, onUpdated) {
  const existing = loadState(storageKey(target.kind, target.sourceId));
  const initialButton = /** @type {HTMLButtonElement|null} */ (el.querySelector('.c-refresh__btn'));
  if (existing && existing.lockedUntil > Date.now() && initialButton) startCountdown(initialButton, existing.lockedUntil);

  on(el, '.c-refresh__btn', 'click', async (_e, button) => {
    if (/** @type {HTMLButtonElement} */ (button).disabled) return;
    const { lockedUntil } = registerPress(target);
    startCountdown(/** @type {HTMLButtonElement} */ (button), lockedUntil);
    const response = await fetch(`/api/item/${encodeURIComponent(target.kind)}/${encodeURIComponent(target.sourceId)}/refresh`, { method: 'POST' });
    if (response.status === 409) { el.querySelector('.c-refresh')?.remove(); return; }
    if (!response.ok) return;
    const result = await response.json();
    if (result.updated > 0) onUpdated(result);
  });
}
