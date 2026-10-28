// @ts-check
/**
 * Task 13: step 1 of the add flow. The form itself is a browser concern
 * (`e2e/add.spec.js`); what these pin is that every `IngestResult` status
 * reaches a screen with its own copy and an onward link -- no outcome is
 * a dead end, and none of them silently shows the paste form again.
 */
import '../helpers/siteFixture.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copyRe, pattern } from '../helpers/copyMarkup.js';
// Dynamic import: see header.test.js for why.
const { render } = await import('../../public/js/components/addLink.js');
const { t } = await import('../../public/js/core/site.js');

/** Every screen a pasted link can land on. */
const STATUSES = ['duplicate', 'removed', 'opted_out', 'deleted', 'unavailable', 'attached', 'pending'];

/**
 * @param {string} status
 * @param {{ pending?: boolean }} [extra]
 * @returns {{ status: string, sourceId: string, itemId: number, pending?: boolean }}
 */
function result(status, extra = {}) {
  return { status, sourceId: '1900000000000000001', itemId: 7, ...extra };
}

test('addLink: the paste form names who the entry is being added as', () => {
  const markup = String(render({ addingAs: '@tl_alpha' }));
  assert.match(markup, copyRe(t('add.addingAs', { who: '@tl_alpha' })));
  assert.match(markup, /<input[^>]*class="c-add__url"[^>]*>/);
  assert.match(markup, new RegExp(`>${pattern(t('add.next'))}<`));
});

test('addLink: a Google user is named without an @', () => {
  const markup = String(render({ addingAs: 'Nice Fan' }));
  assert.match(markup, copyRe(t('add.addingAs', { who: 'Nice Fan' })));
});

test('addLink: every status has its own copy key and at least one onward link', () => {
  for (const status of STATUSES) {
    const markup = String(render({ addingAs: 'tl_alpha', result: result(status) }));
    assert.match(markup, copyRe(t(`add.status.${status}`)), status);
    assert.match(markup, /<a [^>]*href="[^"]+"/, `${status} must link onward`);
    assert.ok(!markup.includes('class="c-add__url"'), `${status} is not the paste form`);
  }
});

test('addLink: an attached follow-up that is held for review says so', () => {
  const markup = String(render({ addingAs: 'tl_alpha', result: result('attached', { pending: true }) }));
  assert.match(markup, copyRe(t('add.status.pending')));
});

test('addLink: a duplicate links straight to the archived entry', () => {
  const markup = String(render({ addingAs: '@tl_alpha', result: result('duplicate'), itemHref: '/t/1900000000000000001' }));
  assert.match(markup, /href="\/t\/1900000000000000001"/);
});

test('addLink: a failed paste keeps the typed link and shows the error', () => {
  const markup = String(render({ addingAs: 'tl_alpha', url: 'https://x.com/i/status/1', error: 'bad_link' }));
  assert.match(markup, /value="https:\/\/x\.com\/i\/status\/1"/);
  assert.match(markup, copyRe(t('add.error')));
  assert.match(markup, /role="alert"/);
});
