// @ts-check
/** Task 10b fix round 1, O3: when the search page may focus its box on load. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shouldAutofocus } from '../../public/js/state/searchFocus.js';
import { EMPTY_STATE, parseState } from '../../public/js/state/searchState.js';

const BLANK = { state: EMPTY_STATE, urlSearch: '' };
const PERSON = { state: parseState(new URLSearchParams('people=1')), urlSearch: '?people=1' };
const QUERY = { state: parseState(new URLSearchParams('q=hello')), urlSearch: '?q=hello' };
const FILTERS_SHEET = { state: EMPTY_STATE, urlSearch: '?filters=1' };

test('coarse pointer (touch): never autofocus, blank page or not', () => {
  for (const input of [BLANK, PERSON, QUERY, FILTERS_SHEET]) assert.equal(shouldAutofocus({ ...input, coarsePointer: true }), false, input.urlSearch);
});

test('fine pointer (desktop): autofocus only on the blank search page', () => {
  assert.equal(shouldAutofocus({ ...BLANK, coarsePointer: false }), true);
  assert.equal(shouldAutofocus({ ...PERSON, coarsePointer: false }), false, 'a person chip link');
  assert.equal(shouldAutofocus({ ...QUERY, coarsePointer: false }), false, 'a query');
  assert.equal(shouldAutofocus({ ...FILTERS_SHEET, coarsePointer: false }), false, 'anything in the URL');
});
