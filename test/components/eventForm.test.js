// @ts-check
/**
 * Event editing Task 9: the edit event page's shared field set
 * (`public/js/components/eventForm.js`): title, date, keywords and
 * hashtags, the address, and the live people and platform. `bind` keeps
 * the caller's `store.fields` up to date and repaints its own parts.
 */
import '../helpers/siteFixture.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copyRe, pattern } from '../helpers/copyMarkup.js';
// Dynamic import: see test/components/header.test.js for why.
const { render, bind } = await import('../../public/js/components/eventForm.js');
const { MiniElement } = await import('../helpers/miniDom.js');
const { t } = await import('../../public/js/core/site.js');

const OPTIONS = {
  people: [{ id: 1, displayName: 'sol' }, { id: 2, displayName: 'luna' }],
  platforms: [{ code: 'tiktok', name: 'tiktok' }, { code: 'ig', name: 'ig' }],
};

/** @param {Partial<any>} [fields] @param {Partial<any>} [address] @returns {any} */
function store(fields = {}, address = {}) {
  return {
    fields: {
      name: 'Juniper TikTok Live', occurredOn: '2025-12-04', keywords: ['LIVE'], hashtags: ['JuniperTiktok'],
      livePeopleIds: [1], livePlatformCode: 'tiktok', addressTag: 'JuniperTiktok', ...fields,
    },
    options: OPTIONS,
    address: { locked: false, slug: '2025-12-04/junipertiktok', ...address },
    hints: {},
  };
}

/** An element's text: its own `textContent` once set, else its children's. @param {any} el @returns {string} */
function textOf(el) {
  if (!el) return '';
  if (typeof el.textContent === 'string') return el.textContent;
  return (el.children ?? []).map(textOf).join('');
}

/** @param {any} s */
function mounted(s) {
  const el = new MiniElement('div');
  el.innerHTML = String(render(s));
  bind(/** @type {any} */ (el), s);
  return el;
}

test('render: title, date, the tags as removable chips, and the add box', () => {
  const markup = String(render(store()));
  assert.match(markup, /value="Juniper TikTok Live"/);
  assert.match(markup, /type="date"[^>]*value="2025-12-04"|value="2025-12-04"[^>]*type="date"/);
  assert.match(markup, new RegExp(`aria-label="${pattern(t('adminEventEdit.tagRemove', { label: 'LIVE' }))}"`));
  assert.match(markup, new RegExp(`aria-label="${pattern(t('adminEventEdit.tagRemove', { label: '#JuniperTiktok' }))}"`));
  assert.match(markup, /data-event-tag-input/);
});

test('render: the address offers each hashtag and the title, and shows the result', () => {
  const markup = String(render(store()));
  assert.match(markup, /<option value="JuniperTiktok" selected>#JuniperTiktok<\/option>/);
  assert.match(markup, new RegExp(`<option value="">${pattern(t('adminEventEdit.addressTitle'))}</option>`));
  assert.match(markup, /\/e\/2025-12-04\/junipertiktok/);
  assert.doesNotMatch(markup, /data-event-address[^>]*disabled/);
});

test('render: a locked address is disabled, with a note naming the address it keeps', () => {
  const markup = String(render(store({}, { locked: true, slug: '2025-12-01/old-tag' })));
  assert.match(markup, /<select[^>]*data-event-address[^>]*disabled/);
  assert.match(markup, copyRe(t('adminEventEdit.addressLocked', { path: '/e/2025-12-01/old-tag' })));
});

test('render: live people as removable chips, the others to add, and the platform', () => {
  const markup = String(render(store()));
  assert.match(markup, new RegExp(`aria-label="${pattern(t('adminEventEdit.personRemove', { name: 'sol' }))}"`));
  assert.match(markup, /<option value="2">luna<\/option>/);
  assert.doesNotMatch(markup, /<option value="1">sol<\/option>/, 'sol is already live');
  assert.match(markup, /<option value="tiktok" selected>tiktok<\/option>/);
  const none = String(render(store({ livePlatformCode: null })));
  assert.match(none, new RegExp(`<option value="" selected>${pattern(t('adminEventEdit.platformNone'))}</option>`));
});

test('bind: adding "#Moon" makes a hashtag chip and an address choice', () => {
  const s = store();
  const el = mounted(s);
  const input = /** @type {any} */ (el.querySelector('[data-event-tag-input]'));
  input.value = '#Moon';
  /** @type {any} */ (el.querySelector('[data-action="tag-add"]')).click();
  assert.deepEqual(s.fields.hashtags, ['JuniperTiktok', 'Moon']);
  assert.equal(input.value, '');
  assert.ok(el.querySelector('option[value="Moon"]'), 'the address select now offers it');
});

test('bind: removing the address hashtag falls back to the title, and the preview follows', () => {
  const s = store();
  const el = mounted(s);
  /** @type {any} */ (el.querySelector('[data-action="tag-remove"][data-kind="hashtag"]')).click();
  assert.deepEqual(s.fields.hashtags, []);
  assert.equal(s.fields.addressTag, '');
  assert.match(textOf(el.querySelector('[data-event-address-preview]')), /juniper-tiktok-live/);
});

test('bind: typing a title and date updates the fields and the preview', () => {
  const s = store({ addressTag: '' });
  const el = mounted(s);
  const name = /** @type {any} */ (el.querySelector('[data-event-name]'));
  name.value = 'New Name';
  el.dispatchEvent({ type: 'input', target: name });
  const date = /** @type {any} */ (el.querySelector('[data-event-date]'));
  date.value = '2026-01-02';
  el.dispatchEvent({ type: 'input', target: date });
  assert.equal(s.fields.name, 'New Name');
  assert.equal(s.fields.occurredOn, '2026-01-02');
  assert.match(textOf(el.querySelector('[data-event-address-preview]')), /\/e\/2026-01-02\/new-name/);
});

test('bind: people and platform', () => {
  const s = store();
  const el = mounted(s);
  const add = /** @type {any} */ (el.querySelector('[data-event-person-add]'));
  add.value = '2';
  el.dispatchEvent({ type: 'change', target: add });
  assert.deepEqual(s.fields.livePeopleIds, [1, 2]);
  /** @type {any} */ (el.querySelector('[data-action="person-remove"][data-person="1"]')).click();
  assert.deepEqual(s.fields.livePeopleIds, [2]);
  const platform = /** @type {any} */ (el.querySelector('[data-event-platform]'));
  platform.value = '';
  el.dispatchEvent({ type: 'change', target: platform });
  assert.equal(s.fields.livePlatformCode, null);
});
