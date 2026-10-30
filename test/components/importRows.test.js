// @ts-check
/** Plan 3 Task 9: the import table and its actions. */
import '../helpers/siteFixture.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MiniElement } from '../helpers/miniDom.js';
import { mount } from '../../public/js/core/dom.js';
import { copyRe } from '../helpers/copyMarkup.js';
import { withGlobals } from '../helpers/globals.js';
const { render, bind } = await import('../../public/js/components/importRows.js');
const { t } = await import('../../public/js/core/site.js');

/** @param {Partial<any>} [overrides] */
function state(overrides = {}) {
  return {
    jobId: 7,
    job: { id: 7, source: 'notion', status: 'done', createdAt: '2026-10-28T00:00:00.000Z' },
    counts: { fetched: 2, needs_speakers: 1, check: 1, attached: 0, published: 3, skipped: 1, failed: 1 },
    rows: [], hasMore: false, state: '', q: '', error: '',
    ...overrides,
  };
}

/** @param {Partial<any>} [overrides] */
function row(overrides = {}) {
  return {
    id: 11, state: 'fetched', translator: { handle: 'tl_alpha' }, event: { name: 'LOVE TO THE MOON' },
    preview: null, itemId: 5, error: null, sourceUrl: 'https://x.com/i/status/111', externalId: '111',
    text: 'a translated line', entryUrl: '/t/111', editUrl: '/edit/translation/111',
    ...overrides,
  };
}

test('the header names the job and the chips count every state', () => {
  const markup = String(render(state()));
  assert.match(markup, /import job 7/);
  assert.match(markup, /notion export/);
  for (const label of ['ready', 'needs speakers', 'check', 'published', 'skipped', 'failed']) {
    assert.match(markup, new RegExp(label));
  }
});

test('a row renders its state, translator, text, event and legal actions', () => {
  const published = String(render(state({ rows: [row({ state: 'published' })] })));
  assert.match(published, /a translated line/);
  assert.match(published, /@tl_alpha/);
  assert.match(published, /href="\/t\/111"/);
  assert.ok(!published.includes('data-action="skip"'), 'a published row cannot be skipped');

  const failed = String(render(state({ rows: [row({ state: 'failed', entryUrl: null, editUrl: null })] })));
  assert.match(failed, /data-action="retry"/);
  assert.match(failed, /data-action="skip"/);
  assert.ok(!failed.includes('data-action="archive"'));

  const check = String(render(state({ rows: [row({ state: 'check' })] })));
  assert.match(check, /data-action="archive"/);
  assert.match(check, /data-action="skip"/);
});

test('every icon-only row action has a title and an accessible name', () => {
  const markup = String(render(state({ rows: [row({ state: 'check' }), row({ id: 12, state: 'failed', entryUrl: null, editUrl: null })] })));
  const icons = [...markup.matchAll(/<button[^>]*class="c-import__icon"[^>]*>/g)].map((m) => m[0]);
  assert.ok(icons.length >= 3);
  for (const tag of icons) {
    assert.match(tag, /title="[^"]+"/, tag);
    assert.match(tag, /aria-label="[^"]+"/, tag);
  }
});

test('the filter chips and the search call back with the new filter', async () => {
  await withGlobals({ fetch: /** @type {any} */ (async () => Response.json({})) }, async () => {
    const st = state({ rows: [row()] });
    const root = new MiniElement('div');
    mount(root, render(st));
    /** @type {string[]} */
    const calls = [];
    bind(/** @type {any} */ (root), { state: st, reload: async () => { calls.push(`${st.state}|${st.q}`); } });

    /** @type {any} */ (root.querySelector('[data-state="failed"]')).click();
    assert.equal(st.state, 'failed');
    const form = /** @type {any} */ (root.querySelector('.c-import__search'));
    /** @type {any} */ (root.querySelector('.c-import__input')).value = 'hello';
    form.dispatchEvent({ type: 'submit', target: form, preventDefault: () => {} });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(calls, ['failed|', 'failed|hello']);
  });
});

test('skipping posts the row action and reloads', async () => {
  const st = state({ rows: [row({ state: 'check' })] });
  /** @type {any[]} */
  const calls = [];
  await withGlobals({
    fetch: /** @type {any} */ (async (url) => { calls.push(url); return Response.json({ skipped: true }); }),
  }, async () => {
    const root = new MiniElement('div');
    mount(root, render(st));
    let reloads = 0;
    bind(/** @type {any} */ (root), { state: st, reload: async () => { reloads += 1; } });
    /** @type {any} */ (root.querySelector('[data-action="skip"]')).click();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(calls, ['/api/owner/imports/7/rows/11/skip']);
    assert.equal(reloads, 1);
    assert.ok(String(render(st)).includes(t('import.state.check')));
    void copyRe;
  });
});
