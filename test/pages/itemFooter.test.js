// @ts-check
/**
 * Task 13: the item footer's edit and check-for-follow-ups controls.
 * Both are icon-only, so both must carry a tooltip and an accessible
 * name; a signed-out viewer (or one without permission) gets neither.
 */
import '../helpers/siteFixture.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
const { footerBlock } = await import('../../public/js/pages/itemFooter.js');
const { t } = await import('../../public/js/core/site.js');

/** @returns {any} the fields the footer reads */
function view(overrides = {}) {
  return {
    kind: 'translation', sourceId: '1900000000000000001', url: '/t/1900000000000000001',
    sources: [], original: 'hi', credits: { account: null, clipBy: null, occurredOn: '2026-10-14' },
    followsOnFrom: null, addedBy: null, canEdit: false, canCheckFollowUps: false,
    ...overrides,
  };
}

/** @param {string} markup @returns {string[]} */
function iconTags(markup) {
  return [...markup.matchAll(/<[^>]*class="[^"]*c-item__icon[^"]*"[^>]*>/g)].map((m) => m[0]);
}

test('itemFooter: a signed-out viewer gets no edit or follow-up controls', () => {
  assert.equal(iconTags(String(footerBlock(view()))).length, 0);
});

test('itemFooter: the editor gets a labelled edit link to the entry\'s own edit page', () => {
  const markup = String(footerBlock(view({ canEdit: true })));
  const tag = iconTags(markup).find((t) => t.includes('/edit/'));
  assert.ok(tag, 'an edit control');
  assert.match(tag ?? '', /href="\/edit\/translation\/1900000000000000001"/);
  assert.match(tag ?? '', new RegExp(`title="${t('item.edit')}"`));
  assert.match(tag ?? '', new RegExp(`aria-label="${t('item.edit')}"`));
});

test('itemFooter: the follow-up control is a labelled icon button with a tooltip', () => {
  const markup = String(footerBlock(view({ canCheckFollowUps: true })));
  const tag = iconTags(markup).find((t) => t.includes('data-action="follow-ups"'));
  assert.ok(tag, 'a check-for-follow-ups control');
  assert.match(tag ?? '', new RegExp(`title="${t('item.followUps')}"`));
  assert.match(tag ?? '', new RegExp(`aria-label="${t('item.followUps')}"`));
});
