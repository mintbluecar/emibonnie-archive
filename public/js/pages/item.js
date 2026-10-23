// @ts-check
/**
 * The translation (item) page (task-4 brief). `composeItem` is pure
 * (exported for DOM-free tests on an `ItemView` snapshot:
 * src/http/contracts.js); `bind()`/`start()` are the only parts that
 * touch the DOM or the network. Kind-agnostic: the pinned media box
 * (`mediaBox.js`) and the kind's own `detail.render` (credits, cast,
 * bubbles, "show original") come from generic contract fields, so this
 * page never special-cases the translation kind by name.
 */
import { html } from '../core/html.js';
import { mount, mountPage } from '../core/dom.js';
import { getJson, ApiError } from '../core/api.js';
import { site, t } from '../core/site.js';
import { eventHref } from '../core/routes.js';
import * as chips from '../components/chips.js';
import * as emptyState from '../components/emptyState.js';
import * as pageShell from '../components/pageShell.js';
import * as mediaBox from '../components/mediaBox.js';
import * as refreshButton from '../components/refreshButton.js';
import * as headerLinks from '../components/headerLinks.js';
import * as sourceEmbed from '../components/sourceEmbed.js';
import { KIND_UI } from '../kinds/_registry.js';
import { footerBlock } from './itemFooter.js';
import { mountLoadError } from './pageError.js';

const APP_SELECTOR = 'app';

/** @param {import('../../../src/http/contracts.js').ItemView} data @returns {import('../core/html.js').SafeHtml} */
function pillsRow(data) {
  const items = [...data.tags.hashtags.map(chips.hashtagChip), ...(data.category ? [{ label: data.category }] : [])];
  return items.length > 0 ? chips.render({ items }) : html``;
}

/** @param {import('../../../src/http/contracts.js').ItemView} data @returns {import('../core/html.js').SafeHtml} */
function prevNextNav(data) {
  if (!data.prev && !data.next) return html``;
  return html`
    <nav class="c-item__prevnext">
      ${data.prev ? html`<a class="c-item__prev" href="${data.prev.url}">${t('item.prev')}</a>` : ''}
      ${data.next ? html`<a class="c-item__next" href="${data.next.url}">${t('item.next')}</a>` : ''}
    </nav>
  `;
}

/**
 * The event this item belongs to, linked back: on phone, above the
 * media; on web, at the top of the right (body) column -- see
 * `docs/superpowers/specs/mockups/screens-v2.html`'s phone and web
 * translation screens (review round 1, IMPORTANT #1). `.c-item`'s own
 * CSS (`itemPage.css`) repositions this between the two breakpoints via
 * `grid-template-areas`, not by rendering it twice.
 * @param {import('../../../src/http/contracts.js').ItemView} data
 * @returns {import('../core/html.js').SafeHtml}
 */
function backRow(data) {
  if (!data.event) return html``;
  return html`<a class="c-item__back" href="${eventHref(data.event.slug)}">${t('item.backToEvent', { name: data.event.name })}</a>`;
}

/**
 * The part of the page a successful "check for update" replaces: the
 * refresh button plus the kind's own credits/pills/cast/bubbles. Kept
 * separate from `composeItem()`'s media/back row so a reload never
 * touches (and so never restarts) the pinned video (review round 1,
 * IMPORTANT #2).
 * @param {import('../../../src/http/contracts.js').ItemView & { editOpenUntil: string|null }} data
 * @returns {import('../core/html.js').SafeHtml}
 */
function bodyContent(data) {
  const detailUi = KIND_UI[data.kind]?.detail;
  return html`
    ${refreshButton.render({ editOpenUntil: data.editOpenUntil })}
    ${detailUi ? detailUi.render(data, { afterCredits: pillsRow(data) }) : ''}
  `;
}

/**
 * `(ItemView & { editOpenUntil })` is what `/api/item/:kind/:sourceId`
 * returns -- `itemPage()` in `src/services/itemPage.js`.
 * @param {import('../../../src/http/contracts.js').ItemView & { editOpenUntil: string|null }} data
 * @returns {import('../core/html.js').SafeHtml}
 */
export function composeItem(data) {
  const content = html`
    <div class="c-item">
      ${backRow(data)}
      <div class="c-item__media">
        ${mediaBox.render({ media: data.media })}
        ${prevNextNav(data)}
      </div>
      <div class="c-item__body">${bodyContent(data)}</div>
    </div>
    ${footerBlock(data)}
  `;
  return pageShell.render({ active: 'home', compact: true, content });
}

/**
 * Re-binds just `.c-item__body`'s own content (the kind's `detail.bind`,
 * pill colours, and the refresh button's lock resync) -- called both
 * after the initial mount and after every body-only reload. Never
 * touches the media box or registers a new refresh-button click
 * listener (that happens once, in `bind()`).
 * @param {Element} root @param {Element} bodyEl
 * @param {import('../../../src/http/contracts.js').ItemView & { editOpenUntil: string|null }} data
 * @returns {void}
 */
function bindBody(root, bodyEl, data) {
  const detailUi = KIND_UI[data.kind]?.detail;
  const detailEl = bodyEl.querySelector(`.k-${data.kind}-detail`) ?? bodyEl;
  detailUi?.bind?.(detailEl);
  chips.bind(bodyEl);
  refreshButton.syncLock(root, { kind: data.kind, sourceId: data.sourceId });
}

/**
 * Re-fetches and replaces only `.c-item__body` -- satisfies "re-renders
 * the bubbles if `updated > 0`" (task-4 brief) without re-rendering the
 * pinned media (which must not restart) or re-registering any listener
 * bound once on `root` (review round 1, IMPORTANT #2).
 * @param {Element} root @param {{ kind: string, sourceId: string }} target
 * @returns {Promise<void>}
 */
async function reloadBody(root, target) {
  const data = await getJson(`/api/item/${encodeURIComponent(target.kind)}/${encodeURIComponent(target.sourceId)}`);
  const bodyEl = root.querySelector('.c-item__body');
  if (!bodyEl) return;
  mount(bodyEl, bodyContent(data));
  bindBody(root, bodyEl, data);
}

/**
 * Called exactly once, on page load: binds the media box, the refresh
 * button (delegated at `root`, so a later body reload never
 * re-registers its click listener), the copy-link button, and the
 * body's own content, and X's embed when the footer has one (Task 10b).
 * @param {Element} root
 * @param {import('../../../src/http/contracts.js').ItemView & { editOpenUntil: string|null }} data
 * @returns {void}
 */
export function bind(root, data) {
  headerLinks.bind(root);
  const bodyEl = root.querySelector('.c-item__body') ?? root;
  bindBody(root, bodyEl, data);
  const mediaEl = root.querySelector('.c-item__media') ?? root;
  mediaBox.bind(mediaEl, { media: data.media, kind: data.kind, sourceId: data.sourceId });
  const target = { kind: data.kind, sourceId: data.sourceId };
  refreshButton.bind(root, target, () => reloadBody(root, target));
  bindCopyLink(root, data.url);
  sourceEmbed.bind(root);
}

/** @param {Element} root @param {string} path @returns {void} */
function bindCopyLink(root, path) {
  const button = root.querySelector('.c-item__copy-link');
  button?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${path}`);
      button.textContent = t('item.copied');
      setTimeout(() => { button.textContent = t('item.copyLink'); }, 2000);
    } catch {
      // clipboard access denied or unavailable: nothing to recover from client-side
    }
  });
}

/** @param {string} path @returns {{ kind: string, sourceId: string }|null} */
function kindFromPath(path) {
  for (const [kind, ui] of Object.entries(KIND_UI)) {
    if (ui.urlPrefix && path.startsWith(ui.urlPrefix)) return { kind, sourceId: decodeURIComponent(path.slice(ui.urlPrefix.length)) };
  }
  return null;
}

/** @param {Element} root @returns {void} */
function mountNotFound(root) {
  mountPage(root, pageShell.render({ compact: true, content: emptyState.render({ message: t('item.notFound') }) }));
}

/** @returns {Promise<void>} */
export async function start() {
  const root = document.getElementById(APP_SELECTOR);
  const target = root && kindFromPath(window.location.pathname);
  if (!root || !target) return;
  /** @type {import('../../../src/http/contracts.js').ItemView & { editOpenUntil: string|null }} */
  let data;
  try {
    data = await getJson(`/api/item/${encodeURIComponent(target.kind)}/${encodeURIComponent(target.sourceId)}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      mountNotFound(root);
      return;
    }
    mountLoadError(root);
    return;
  }
  document.title = `${site.name}`;
  mountPage(root, composeItem(data));
  bind(root, data);
}

if (typeof document !== 'undefined') start();
