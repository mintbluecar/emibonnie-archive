// @ts-check
/**
 * Task 12: the Google user's "pick a public name" form. The server owns
 * the validation (`cleanDisplayName`, 400 with a reason); the form only
 * shows that reason in the page's own words.
 */
import '../helpers/siteFixture.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copyRe, pattern } from '../helpers/copyMarkup.js';
// Dynamic import: see header.test.js for why.
const { render, reasonCopy } = await import('../../public/js/components/nameForm.js');
const { t } = await import('../../public/js/core/site.js');

test('nameForm: shows the server reason for looks_like_handle', () => {
  assert.equal(reasonCopy('looks_like_handle'), t('me.name.reason.looks_like_handle'));
  const markup = String(render({ reason: 'looks_like_handle' }));
  assert.match(markup, copyRe(t('me.name.reason.looks_like_handle')));
});

test('nameForm: maps every server reason to copy, with a fallback', () => {
  assert.equal(reasonCopy('empty'), t('me.name.reason.empty'));
  assert.equal(reasonCopy('too_long'), t('me.name.reason.too_long'));
  assert.equal(reasonCopy('something_else'), t('me.name.reason.unknown'));
});

test('nameForm: a labelled text box, the hint, and a save button; never prefilled with a handle', () => {
  const markup = String(render());
  assert.match(markup, /<label class="field__label" for="c-name-form-input">/);
  const input = markup.match(/<input[^>]*id="c-name-form-input"[^>]*>/)?.[0] ?? '';
  assert.ok(input, 'the labelled input');
  assert.match(input, /type="text"/);
  assert.ok(markup.includes('autocomplete="off"'), 'no browser autofill of a real name');
  assert.match(markup, copyRe(t('me.nameHint')));
  assert.match(markup, new RegExp(`>${pattern(t('me.nameSave'))}<`));
});

test('nameForm: keeps the value the user typed after a failed save', () => {
  assert.match(String(render({ value: 'Nice Fan', reason: 'looks_like_handle' })), /value="Nice Fan"/);
});

test('nameForm: the error is announced, and the hint stays associated with the input', () => {
  const markup = String(render({ reason: 'empty' }));
  assert.match(markup, /role="alert"/);
  assert.match(markup, /aria-describedby="c-name-form-hint c-name-form-error"/);
  assert.match(markup, /aria-invalid="true"/);
  assert.ok(!String(render()).includes('aria-invalid'), 'no error, not invalid');
});
