// @ts-check
/**
 * Step 1 of the add flow (Plan 2a Task 13): paste a link, or the screen
 * one of ingest's outcomes lands on. Every outcome has its own sentence
 * (`add.status.<status>`) and a way onward -- the owner's rule that no
 * intake outcome is a dead end. `bind()` is the page's: it reads the
 * input and submits, because the page owns the preview and the step.
 */
import { html } from '../core/html.js';
import { on } from '../core/dom.js';
import { t } from '../core/site.js';
import { ADD_PATH, ME_PATH } from '../core/routes.js';

/**
 * The copy for each status. Literal `t()` calls so `npm run build`'s
 * missing-key check sees every one (a computed key would slip past it).
 */
const STATUS_COPY = {
  duplicate: t('add.status.duplicate'),
  removed: t('add.status.removed'),
  opted_out: t('add.status.opted_out'),
  deleted: t('add.status.deleted'),
  unavailable: t('add.status.unavailable'),
  attached: t('add.status.attached'),
  pending: t('add.status.pending'),
  needs_date: t('add.status.needs_date'),
  needs_speakers: t('add.status.needs_speakers'),
};

/**
 * @param {{ result: any, itemHref: string|null }} props
 * @returns {import('../core/html.js').SafeHtml}
 */
function statusScreen({ result, itemHref }) {
  const sentence = Object.hasOwn(STATUS_COPY, result.status)
    ? STATUS_COPY[/** @type {keyof typeof STATUS_COPY} */ (result.status)]
    : t('add.error');
  return html`
    <section class="c-add-link c-add-link--status" data-status="${result.status}">
      <p class="c-add-link__status">${sentence}</p>
      ${result.pending ? html`<p class="c-add-link__pending">${t('add.status.pending')}</p>` : ''}
      <div class="c-add-link__actions">
        ${itemHref ? html`<a class="c-add-link__primary" href="${itemHref}">${t('add.openItem')}</a>` : ''}
        ${result.status === 'pending' ? html`<a class="c-add-link__primary" href="${ME_PATH}">${t('me.addedByMe')}</a>` : ''}
        <a class="c-add-link__secondary" href="${ADD_PATH}">${t('add.addAnother')}</a>
      </div>
    </section>
  `;
}

/**
 * @param {{ addingAs: string, url?: string, busy?: boolean, error?: boolean,
 *   result?: any, itemHref?: string|null }} props
 *   `addingAs`: already formatted ("@handle" or a Google user's name).
 *   `result`: a non-`ready` ingest result; absent for the paste form.
 * @returns {import('../core/html.js').SafeHtml}
 */
export function render({ addingAs, url = '', busy = false, error = false, result = null, itemHref = null }) {
  if (result) return statusScreen({ result, itemHref });
  return html`
    <section class="c-add-link">
      <p class="c-add-link__intro">${t('add.intro')}</p>
      <p class="c-add-link__as">${t('add.addingAs', { who: addingAs })}</p>
      <form class="c-add-link__form" data-add-form>
        <label class="c-add-link__label" for="c-add-url">${t('add.urlLabel')}</label>
        <input class="c-add__url" id="c-add-url" name="url" type="url" inputmode="url" autocomplete="off"
          value="${url}" placeholder="${t('add.urlPlaceholder')}" required>
        <button class="c-add-link__next" type="submit"${busy ? ' disabled' : ''}>${busy ? t('add.checking') : t('add.next')}</button>
        ${error ? html`<p class="c-add-link__error" role="alert">${t('add.error')}</p>` : ''}
      </form>
      <p class="c-add-link__note">${t('add.note')}</p>
    </section>
  `;
}

/**
 * The page's paste handler: reads the URL and hands it over. The page owns
 * the request, the busy state and the step; this only reports the value.
 * @param {Element} el
 * @param {{ onSubmit: (url: string) => void }} ctx
 * @returns {void}
 */
export function bind(el, { onSubmit }) {
  on(el, '[data-add-form]', 'submit', (event, form) => {
    event.preventDefault();
    const input = /** @type {HTMLInputElement|null} */ (form.querySelector('.c-add__url'));
    onSubmit(input?.value.trim() ?? '');
  });
}
