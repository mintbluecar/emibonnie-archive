// @ts-check
/**
 * Plan 2b Task 11: the translator section of the me page -- welcome,
 * my translations, remove/restore and the opt-out box.
 */
import '../helpers/siteFixture.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MiniElement } from '../helpers/miniDom.js';
import { mount } from '../../public/js/core/dom.js';
import { copyRe } from '../helpers/copyMarkup.js';
const { render, bind, keyOf } = await import('../../public/js/components/meTranslations.js');
const { t, tCount } = await import('../../public/js/core/site.js');

/** @param {Partial<any>} [overrides] */
function state(overrides = {}) {
  return {
    handle: 'tl_alpha',
    items: [],
    hasMore: false,
    totals: { translations: 12, events: 3, sharedStories: 1 },
    selected: new Set(),
    optedOut: false,
    welcome: false,
    error: '',
    ...overrides,
  };
}

/** @param {Partial<any>} [overrides] */
function item(overrides = {}) {
  return {
    kind: 'translation', sourceId: '1900000000000000001', url: '/t/1900000000000000001',
    lines: [{ kind: 'plain', text: 'a line' }], people: [], hasVideo: false, thumb: null,
    followsOnFrom: null, occurredOn: '2026-10-01', placement: 'unsorted',
    reviewState: 'published', removedByYou: false, hidden: false,
    ...overrides,
  };
}

test('the welcome shows the handle, the badge, the totals and a way onward', () => {
  const markup = String(render(state({ welcome: true })));
  assert.match(markup, copyRe(t('me.welcome.hi', { handle: 'tl_alpha' })));
  assert.match(markup, copyRe(t('me.welcome.badge')));
  assert.match(markup, copyRe(t('me.welcome.totals', { translations: 12, events: 3, sharedStories: 1 })));
  assert.match(markup, /data-action="welcome-see"/);
  assert.match(markup, /href="\/add"/);
});

test('the welcome is gone once it has been marked', () => {
  assert.ok(!String(render(state())).includes(t('me.welcome.badge')));
});

test('a removed row is faded with a restore control; a hidden one has none', () => {
  const removed = String(render(state({ items: [item({ removedByYou: true })] })));
  assert.match(removed, /<li class="c-me__entry" data-faded>/);
  assert.match(removed, copyRe(t('me.translations.removedByYou')));
  assert.match(removed, /data-action="restore"/);
  assert.ok(!removed.includes('type="checkbox"'), 'a removed row is not selectable');

  const hidden = String(render(state({ items: [item({ hidden: true })] })));
  assert.match(hidden, copyRe(t('me.translations.hidden')));
  assert.ok(!hidden.includes('data-action="restore"'));
});

test('a rejected row is labelled and not selectable', () => {
  const markup = String(render(state({ items: [item({ reviewState: 'rejected' })] })));
  assert.match(markup, copyRe(t('me.rejected')));
  assert.ok(!markup.includes('type="checkbox"'));
});

test('the opt-out box names the total, warns, and its button is the danger full-width confirm', () => {
  const markup = String(render(state()));
  assert.match(markup, copyRe(t('me.optOut.title')));
  assert.match(markup, copyRe(tCount('me.optOut.body', 12)));
  assert.match(markup, copyRe(t('me.optOut.confirm')));
  const confirm = markup.match(/<button[^>]*data-action="opt-out"[^>]*>/)?.[0] ?? '';
  assert.match(confirm, /class="btn btn--danger btn--block"/);
});

test('a list with more pages offers a translator-specific "more" action', () => {
  const markup = String(render(state({ hasMore: true, items: [item()] })));
  assert.match(markup, /data-action="more-translations"/);
});

test('opted out: the box offers "opt back in" instead of the confirm', () => {
  const markup = String(render(state({ optedOut: true })));
  assert.match(markup, copyRe(t('me.optOut.done')));
  assert.match(markup, copyRe(t('me.optOut.back')));
  assert.ok(!markup.includes('data-action="opt-out"'));
});

test('selecting entries counts them and enables remove', () => {
  globalThis.fetch = /** @type {any} */ (async () => Response.json({}));
  const st = state({ items: [item(), item({ sourceId: '1900000000000000002' })] });
  const root = new MiniElement('div');
  mount(root, render(st));
  let reloads = 0;
  bind(/** @type {any} */ (root), { state: st, reload: async () => { reloads += 1; } });

  const boxes = /** @type {any[]} */ ([.../** @type {any} */ (root).querySelectorAll('[data-action="select"]')]);
  assert.equal(boxes.length, 2);
  boxes[0].checked = true;
  boxes[0].dispatchEvent({ type: 'change', target: boxes[0] });
  boxes[1].checked = true;
  boxes[1].dispatchEvent({ type: 'change', target: boxes[1] });
  assert.equal(st.selected.size, 2);
  assert.deepEqual([...st.selected], [keyOf(item()), keyOf(item({ sourceId: '1900000000000000002' }))]);
  assert.match(String(root.querySelector('[data-count]')?.textContent), /2 selected/);
  assert.equal(/** @type {any} */ (root.querySelector('[data-action="remove"]')).disabled, false);
  void reloads;
});
