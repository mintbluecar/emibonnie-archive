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
import { mount } from '../core/dom.js';
import { getJson, ApiError } from '../core/api.js';
import { site, t } from '../core/site.js';
import * as chips from '../components/chips.js';
import * as emptyState from '../components/emptyState.js';
import * as pageShell from '../components/pageShell.js';
import * as mediaBox from '../components/mediaBox.js';
import * as refreshButton from '../components/refreshButton.js';
import { KIND_UI } from '../kinds/_registry.js';
import { footerBlock } from './itemFooter.js';

const APP_SELECTOR = 'app';

/** @param {import('../../../src/http/contracts.js').ItemView} data @returns {import('../core/html.js').SafeHtml} */
function pillsRow(data) {
  const items = [...data.tags.hashtags.map((h) => ({ label: `#${h}` })), ...(data.category ? [{ label: data.category }] : [])];
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
 * `(ItemView & { editOpenUntil })` is what `/api/item/:kind/:sourceId`
 * returns -- `itemPage()` in `src/services/itemPage.js`.
 * @param {import('../../../src/http/contracts.js').ItemView & { editOpenUntil: string|null }} data
 * @returns {import('../core/html.js').SafeHtml}
 */
export function composeItem(data) {
  const detailUi = KIND_UI[data.kind]?.detail;
  const content = html`
    <div class="c-item cols">
      <div class="c-item__media">
        ${mediaBox.render({ media: data.media })}
        ${prevNextNav(data)}
      </div>
      <div class="c-item__body">
        ${refreshButton.render({ editOpenUntil: data.editOpenUntil })}
        ${detailUi ? detailUi.render(data, { afterCredits: pillsRow(data) }) : ''}
      </div>
    </div>
    ${footerBlock(data)}
  `;
  return pageShell.render({ compact: true, content });
}

/**
 * Re-fetches and fully re-renders the page -- the simplest way to
 * satisfy "re-renders the bubbles if `updated > 0`" (task-4 brief)
 * without this page tracking which fields a refresh may have changed.
 * @param {Element} root @param {string} kind @param {string} sourceId
 * @returns {Promise<void>}
 */
async function reload(root, kind, sourceId) {
  const data = await getJson(`/api/item/${encodeURIComponent(kind)}/${encodeURIComponent(sourceId)}`);
  mount(root, composeItem(data));
  bind(root, data);
}

/**
 * @param {Element} root
 * @param {import('../../../src/http/contracts.js').ItemView & { editOpenUntil: string|null }} data
 * @returns {void}
 */
export function bind(root, data) {
  const detailUi = KIND_UI[data.kind]?.detail;
  const detailEl = root.querySelector(`.k-${data.kind}-detail`) ?? root;
  detailUi?.bind?.(detailEl);
  chips.bind(root);
  const mediaEl = root.querySelector('.c-item__media') ?? root;
  mediaBox.bind(mediaEl, { media: data.media, kind: data.kind, sourceId: data.sourceId });
  const refreshEl = root.querySelector('.c-refresh') ?? root;
  refreshButton.bind(refreshEl, { kind: data.kind, sourceId: data.sourceId }, () => reload(root, data.kind, data.sourceId));
  bindCopyLink(root, data.url);
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
  mount(root, pageShell.render({ compact: true, content: emptyState.render({ message: t('item.notFound') }) }));
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
    throw err;
  }
  document.title = `${site.name}`;
  mount(root, composeItem(data));
  bind(root, data);
}

if (typeof document !== 'undefined') start();
