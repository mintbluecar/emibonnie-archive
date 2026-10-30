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
    <section class="card" data-status="${result.status}">
      <p class="c-add-link__status">${sentence}</p>
      ${result.pending ? html`<p class="meta c-add-link__pending">${t('add.status.pending')}</p>` : ''}
      <div class="cluster cluster--3 c-add-link__actions">
        ${itemHref ? html`<a class="btn btn--primary" href="${itemHref}">${t('add.openItem')}</a>` : ''}
        ${result.status === 'pending' ? html`<a class="btn btn--primary" href="${ME_PATH}">${t('me.addedByMe')}</a>` : ''}
        <a class="btn btn--secondary" href="${ADD_PATH}">${t('add.addAnother')}</a>
      </div>
    </section>
  `;
}

/**
 * The link box, its label and, after a failed paste, its error.
 * @param {{ url: string, error: boolean }} props
 * @returns {import('../core/html.js').SafeHtml}
 */
function urlField({ url, error }) {
  return html`
    <div class="field">
      <label class="label" for="c-add-url">${t('add.urlLabel')}</label>
      <input id="c-add-url" name="url" type="url" inputmode="url" autocomplete="off"
        value="${url}" placeholder="${t('add.urlPlaceholder')}" required${error ? html` aria-invalid="true" aria-describedby="c-add-url-error"` : ''}>
      ${error ? html`<p class="field__error" id="c-add-url-error" role="alert">${t('add.error')}</p>` : ''}
    </div>
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
    <section class="card">
      <p class="c-add-link__intro">${t('add.intro')}</p>
      <p class="label c-add-link__as">${t('add.addingAs', { who: addingAs })}</p>
      <form class="stack stack--2" data-add-form>
        ${urlField({ url, error })}
        <button class="btn btn--primary" type="submit"${busy ? ' disabled' : ''}>${busy ? t('add.checking') : t('add.next')}</button>
      </form>
      <p class="meta c-add-link__note">${t('add.note')}</p>
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
    const input = /** @type {HTMLInputElement|null} */ (form.querySelector('#c-add-url'));
    onSubmit(input?.value.trim() ?? '');
  });
}
