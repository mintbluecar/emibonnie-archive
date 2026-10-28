// @ts-check
/**
 * Plan 2b Task 12: the public report dialog -- labelled fields, the
 * 2,000-character cap, the page's own target in the POST, a thank-you on
 * success and a failure that keeps what was typed.
 */
import '../helpers/siteFixture.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MiniElement } from '../helpers/miniDom.js';
import { mount } from '../../public/js/core/dom.js';
import { pattern } from '../helpers/copyMarkup.js';
const { render, bind, MAX_REASON } = await import('../../public/js/components/reportForm.js');
const { t } = await import('../../public/js/core/site.js');
const { footerBlock } = await import('../../public/js/pages/itemFooter.js');

const TARGET = { type: /** @type {const} */ ('item'), kind: 'translation', sourceId: '1900000000000000001' };

/** @param {typeof fetch} [fetchImpl] */
function mounted(fetchImpl) {
  if (fetchImpl) globalThis.fetch = fetchImpl;
  const root = new MiniElement('div');
  mount(root, render());
  bind(/** @type {any} */ (root), TARGET);
  return root;
}

/** @param {MiniElement} root @param {string} reason */
async function submit(root, reason) {
  const field = /** @type {any} */ (root.querySelector('.c-report__reason'));
  field.value = reason;
  const form = /** @type {any} */ (root.querySelector('.c-report__form'));
  form.dispatchEvent({ type: 'submit', target: form, preventDefault: () => {} });
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test('the dialog is labelled, caps the reason and has submit and cancel', () => {
  const markup = String(render());
  assert.match(markup, /class="c-report"/);
  assert.match(markup, /aria-labelledby="c-report-title"/);
  assert.match(markup, /<label class="c-report__label" for="c-report-reason">/);
  assert.match(markup, new RegExp(`maxlength="${MAX_REASON}"`));
  assert.equal(MAX_REASON, 2000);
  assert.match(markup, new RegExp(`>${pattern(t('report.submit'))}<`));
  assert.match(markup, /data-action="close-report"/);
});

test('submitting posts the page\'s target and the trimmed reason', async () => {
  /** @type {any[]} */
  const calls = [];
  const root = mounted(/** @type {any} */ (async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return Response.json({ id: 1 });
  }));
  await submit(root, '  wrong credit  ');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/reports');
  assert.deepEqual(calls[0].body, { target: TARGET, reason: 'wrong credit' });
});

test('success announces the thank-you; a failure keeps the dialog and says so', async () => {
  const ok = mounted(/** @type {any} */ (async () => Response.json({ id: 1 })));
  await submit(ok, 'wrong credit');
  assert.equal(ok.querySelector('[data-report-status]')?.textContent, t('report.done'));
  assert.equal(/** @type {any} */ (ok.querySelector('.c-report__reason')).value, '');

  const bad = mounted(/** @type {any} */ (async () => Response.json({ error: 'x' }, { status: 500 })));
  await submit(bad, 'wrong credit');
  assert.equal(bad.querySelector('[data-report-status]')?.textContent, t('report.failed'));
  assert.equal(/** @type {any} */ (bad.querySelector('.c-report__submit')).disabled, false);
});

test('an empty reason is refused without a request', async () => {
  let calls = 0;
  const root = mounted(/** @type {any} */ (async () => { calls += 1; return Response.json({}); }));
  await submit(root, '   ');
  assert.equal(calls, 0);
  assert.equal(root.querySelector('[data-report-status]')?.textContent, t('report.tooLong'));
});

test('the item footer renders a report trigger and the dialog, not a takedown link', () => {
  const markup = String(footerBlock(/** @type {any} */ ({
    kind: 'translation', sourceId: '1900000000000000001', url: '/t/1900000000000000001',
    sources: [], original: 'hi', credits: { account: null, clipBy: null, occurredOn: '2026-10-14' },
    followsOnFrom: null, addedBy: null, canEdit: false, canCheckFollowUps: false,
  })));
  assert.match(markup, /<button[^>]*data-action="report"[^>]*>/);
  assert.match(markup, /class="c-report"/);
  assert.ok(!markup.includes('/takedown'), 'no placeholder page link');
});
