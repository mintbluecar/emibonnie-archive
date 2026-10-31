// @ts-check
/**
 * The full-screen `<dialog>` zoom a carousel's `.c-carousel__img` opens on
 * tap (task-4 brief: "tap opening a full-screen `<dialog>` zoom (Escape or
 * close button, focus returned)"). One dialog per carousel instance,
 * appended once by `bind()`; `open()` re-renders it at whichever image
 * index was tapped.
 */
import { html } from '../core/html.js';
import { mount, on } from '../core/dom.js';
import { t } from '../core/site.js';

/**
 * @param {import('../../../src/http/contracts.js').ImageVM} image
 * @returns {import('../core/html.js').SafeHtml}
 */
function dialogMarkup(image) {
  return html`
    <dialog class="c-zoom" aria-label="${t('item.zoomLabel')}">
      <button type="button" class="btn btn--overlay btn--icon btn--round c-zoom__close" title="${t('item.zoomClose')}" aria-label="${t('item.zoomClose')}">✕</button>
      <img class="c-zoom__img" src="${image.url}" alt="" loading="lazy" decoding="async">
    </dialog>
  `;
}

/**
 * Appends a (closed) zoom dialog as the last child of `container` and
 * wires its close button and Escape key. Returns a function that opens
 * it on a given image, re-rendering its content first.
 * @param {Element} container
 * @returns {(image: import('../../../src/http/contracts.js').ImageVM, opener: Element) => void}
 */
export function mountZoomDialog(container) {
  const host = /** @type {any} */ (document.createElement('div'));
  container.appendChild(host);
  /** @type {Element|null} */
  let lastOpener = null;

  const close = () => {
    const dialog = /** @type {any} */ (host.querySelector('dialog'));
    dialog?.close?.();
    if (lastOpener && 'focus' in lastOpener) /** @type {any} */ (lastOpener).focus();
  };
  on(host, '.c-zoom__close', 'click', close);
  // `cancel` (the dialog's own Escape event) doesn't bubble, so a
  // delegated listener on `host` would never see it (review round 1,
  // MINOR) -- `keydown` does bubble, and already covers Escape here.
  on(host, 'dialog', 'keydown', (e) => { if (e.key === 'Escape') close(); });

  return (image, opener) => {
    mount(host, dialogMarkup(image));
    lastOpener = opener;
    const dialog = /** @type {any} */ (host.querySelector('dialog'));
    dialog?.showModal?.();
    const closeBtn = host.querySelector('.c-zoom__close');
    if (closeBtn && 'focus' in closeBtn) /** @type {any} */ (closeBtn).focus();
  };
}
