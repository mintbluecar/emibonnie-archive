// @ts-check
/**
 * Plan 2b Task 13: the owner's section -- the approval switch, waiting
 * rows, report rows, the user search and the sign-in alert. The actions
 * post and then reload; the reload itself is the page's job.
 */
import '../helpers/siteFixture.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MiniElement } from '../helpers/miniDom.js';
import { mount } from '../../public/js/core/dom.js';
import { copyRe } from '../helpers/copyMarkup.js';
const { render, bind } = await import('../../public/js/components/ownerSection.js');
const { t } = await import('../../public/js/core/site.js');

/** @param {Partial<any>} [overrides] */
function owner(overrides = {}) {
  return {
    approvalRequired: false, signInFailedAt: null, waiting: [], reports: [], users: null, query: '',
    ...overrides,
  };
}

const WAITING = {
  kind: 'translation', sourceId: '1900000000000000018', url: '/t/1900000000000000018',
  lines: [{ kind: 'plain', text: 'held text' }], people: [], hasVideo: false, thumb: null,
  followsOnFrom: null, occurredOn: '2026-10-01', placement: 'unsorted', reviewState: 'pending',
};
const REPORT = {
  id: 4, at: '2026-10-28T00:00:00.000Z', reason: 'wrong credit', status: 'open',
  reporter: { kind: 'handle', handle: 'someone' },
  target: { type: 'item', url: '/t/1900000000000000004', label: 'a line', hidden: false, restorable: false },
};

test('the approval switch reflects its state and is a labelled checkbox', () => {
  const on = String(render(owner({ approvalRequired: true })));
  assert.match(on, /<input class="c-owner__checkbox" type="checkbox" data-action="approval" checked>/);
  assert.match(on, copyRe(t('owner.approval')));
});

test('a waiting row links to the entry and offers approve and reject', () => {
  const markup = String(render(owner({ waiting: [WAITING] })));
  assert.match(markup, /held text/);
  for (const action of ['approve', 'reject']) {
    const tag = markup.match(new RegExp(`<button[^>]*data-action="${action}"[^>]*>`))?.[0] ?? '';
    assert.match(tag, /title="[^"]+"/);
    assert.match(tag, /aria-label="[^"]+"/);
  }
});

test('a report row shows its reason and reporter, and hide/restore swaps by state', () => {
  const open = String(render(owner({ reports: [REPORT] })));
  assert.match(open, /wrong credit/);
  assert.match(open, /@someone/);
  assert.match(open, /data-action="hide-report"/);
  assert.ok(!open.includes('data-action="restore-report"'));

  const hidden = String(render(owner({ reports: [{ ...REPORT, target: { ...REPORT.target, hidden: true, restorable: true } }] })));
  assert.match(hidden, copyRe(t('owner.hidden')));
  assert.match(hidden, /data-action="restore-report"/);
  assert.ok(!hidden.includes('data-action="hide-report"'));
});

test('users: the search box is labelled, matches get block/unblock, blocked is marked', () => {
  const markup = String(render(owner({
    users: [
      { id: 'x:1', handle: 'blockable', displayName: null, blocked: false, isTranslator: false, addedCount: 2 },
      { id: 'x:2', handle: null, displayName: 'named fan', blocked: true, isTranslator: false, addedCount: 0 },
    ],
    query: 'block',
  })));
  assert.match(markup, /<label class="c-owner__label" for="c-owner-users">/);
  assert.match(markup, /data-action="block"/);
  assert.match(markup, /data-action="unblock"/);
  assert.match(markup, copyRe(t('owner.blocked')));
});

test('the sign-in alert shows its time and a labelled dismiss control', () => {
  const markup = String(render(owner({ signInFailedAt: '2026-10-28T09:30:00.000Z' })));
  assert.match(markup, /2026-10-28 09:30/);
  const tag = markup.match(/<button[^>]*data-action="dismiss-alert"[^>]*>/)?.[0] ?? '';
  assert.match(tag, /title="[^"]+"/);
  assert.match(tag, /aria-label="[^"]+"/);
});

test('every icon-only control carries both a title and an accessible name', () => {
  const markup = String(render(owner({
    signInFailedAt: '2026-10-28T09:30:00.000Z', waiting: [WAITING], reports: [REPORT],
    users: [{ id: 'x:1', handle: 'blockable', displayName: null, blocked: false, isTranslator: false, addedCount: 0 }],
  })));
  const icons = [...markup.matchAll(/<button[^>]*class="c-owner__icon"[^>]*>/g)].map((m) => m[0]);
  assert.ok(icons.length >= 6);
  for (const tag of icons) {
    assert.match(tag, /title="[^"]+"/, tag);
    assert.match(tag, /aria-label="[^"]+"/, tag);
  }
});

test('toggling the switch posts the new state and reloads', async () => {
  /** @type {any[]} */
  const calls = [];
  globalThis.fetch = /** @type {any} */ (async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return Response.json({ approvalRequired: true });
  });
  const state = owner();
  const root = new MiniElement('div');
  mount(root, render(state));
  let reloads = 0;
  bind(/** @type {any} */ (root), { owner: state, reload: async () => { reloads += 1; }, rerender: () => {} });
  const box = /** @type {any} */ (root.querySelector('[data-action="approval"]'));
  box.checked = true;
  box.dispatchEvent({ type: 'change', target: box });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(calls, [{ url: '/api/owner/approval', body: { required: true } }]);
  assert.equal(reloads, 1);
});
