// @ts-check
/**
 * The public report form (Plan 2b): a short dialog on the item and event
 * pages. It posts the page's target and a reason of up to 2,000
 * characters to `/api/reports`; the server decides whether the target is
 * still visible (a hidden one is a 404, never a hint).
 *
 * One dialog per page. Success announces the thank-you and closes; a
 * failure keeps the dialog open with the reason so nothing typed is lost.
 */
import { html } from '../core/html.js';
import { on } from '../core/dom.js';
import { postJson } from '../core/api.js';
import { t } from '../core/site.js';

/** @typedef {{ type: 'item', kind: string, sourceId: string } | { type: 'event', slug: string }} ReportTarget */

/** Max characters, matching `reports.reason`'s check. */
export const MAX_REASON = 2000;

/** @returns {import('../core/html.js').SafeHtml} */
export function render() {
  return html`
    <dialog class="c-report" aria-labelledby="c-report-title">
      <h2 class="c-report__title" id="c-report-title">${t('report.title')}</h2>
      <form class="c-report__form" novalidate>
        <label class="c-report__label" for="c-report-reason">${t('report.reason')}</label>
        <textarea class="c-report__reason" id="c-report-reason" name="reason" rows="4"
          maxlength="${MAX_REASON}" required></textarea>
        <p class="c-report__status" role="status" data-report-status></p>
        <div class="c-report__actions">
          <button class="c-report__cancel" type="button" data-action="close-report">${t('report.cancel')}</button>
          <button class="c-report__submit" type="submit">${t('report.submit')}</button>
        </div>
      </form>
    </dialog>
  `;
}

/** @param {Element} root @returns {HTMLDialogElement|null} */
function dialogOf(root) {
  return /** @type {HTMLDialogElement|null} */ (root.querySelector('.c-report'));
}

/**
 * Wires the page's `[data-action="report"]` trigger (a button the page
 * renders next to the entry or event) to the dialog, and the form to the
 * API.
 * @param {Element} root
 * @param {ReportTarget} target
 * @returns {void}
 */
export function bind(root, target) {
  on(root, '[data-action="report"]', 'click', () => dialogOf(root)?.showModal());
  on(root, '[data-action="close-report"]', 'click', () => dialogOf(root)?.close());
  on(root, '.c-report__form', 'submit', (event, form) => {
    event.preventDefault();
    void submitReport(form, target, dialogOf(root));
  });
}

/** @param {Element} form @returns {{ field: HTMLTextAreaElement|null, status: Element|null, submit: HTMLButtonElement|null }} */
function partsOf(form) {
  return {
    field: /** @type {HTMLTextAreaElement|null} */ (form.querySelector('.c-report__reason')),
    status: form.querySelector('[data-report-status]'),
    submit: /** @type {HTMLButtonElement|null} */ (form.querySelector('.c-report__submit')),
  };
}

/** @param {Element|null} status @param {string} text */
function show(status, text) {
  if (status) status.textContent = text;
}

/**
 * Sends one report: announces the thank-you and closes after a beat, or
 * keeps the dialog open with the failure so nothing typed is lost.
 * @param {Element} form @param {ReportTarget} target @param {HTMLDialogElement|null} dialog
 * @returns {Promise<void>}
 */
async function submitReport(form, target, dialog) {
  const { field, status, submit } = partsOf(form);
  const reason = field?.value.trim() ?? '';
  if (reason === '') {
    show(status, t('report.tooLong'));
    field?.focus();
    return;
  }
  if (submit) submit.disabled = true;
  try {
    await postJson('/api/reports', { target, reason });
    show(status, t('report.done'));
    if (field) field.value = '';
    setTimeout(() => dialog?.close(), 1200);
  } catch {
    show(status, t('report.failed'));
    if (submit) submit.disabled = false;
    field?.focus();
  }
}
