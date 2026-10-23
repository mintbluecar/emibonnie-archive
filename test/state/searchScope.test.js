// @ts-check
/**
 * `public/js/state/searchScope.js` (Task 10d): a scoped page's preset
 * filter, and how its search rides on the page's own URL.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EMPTY_STATE } from '../../public/js/state/searchState.js';
import {
  hasScope, withScope, withoutScope, presetState, stateFromQuery, queryOf, showsList, canClear, cleared,
} from '../../public/js/state/searchScope.js';

/** @type {import('../../public/js/state/searchScope.js').Scope} */
const EVENT = { field: 'event', value: 'starfest', label: 'starfest' };
/** @type {import('../../public/js/state/searchScope.js').Scope} */
const PERSON = { field: 'people', value: 2, label: '🌙 luna' };
/** @type {import('../../public/js/state/searchScope.js').Scope} */
const ACCOUNT = { field: 'account', value: 'tl_beta', label: '@tl_beta' };

/** @param {string} qs @param {any} scope */
const roundTrip = (qs, scope) => queryOf(stateFromQuery(new URLSearchParams(qs), scope), scope).toString();

test('presetState / hasScope / withoutScope: each kind of page filter', () => {
  assert.equal(presetState(EVENT).event, 'starfest');
  assert.deepEqual(presetState(PERSON).people, [2]);
  assert.equal(presetState(ACCOUNT).account, 'tl_beta');
  for (const scope of [EVENT, PERSON, ACCOUNT]) {
    assert.ok(hasScope(presetState(scope), scope));
    assert.ok(!hasScope(withoutScope(presetState(scope), scope), scope));
    assert.deepEqual(withoutScope(presetState(scope), scope), EMPTY_STATE);
  }
  assert.deepEqual(presetState(null), EMPTY_STATE, 'home has no page filter');
  assert.deepEqual(withScope({ ...EMPTY_STATE, people: [1] }, PERSON).people, [2, 1]);
  assert.deepEqual(withoutScope({ ...EMPTY_STATE, people: [2, 1] }, PERSON).people, [1], 'only the page\'s own person goes');
});

test('the URL: the page filter is implied by the path, so a bare path or ?q= keeps it; removing it writes scope=all', () => {
  assert.equal(stateFromQuery(new URLSearchParams(''), EVENT).event, 'starfest');
  assert.equal(stateFromQuery(new URLSearchParams('q=hug'), EVENT).event, 'starfest');
  assert.equal(queryOf({ ...presetState(EVENT), q: 'hug' }, EVENT).toString(), 'q=hug', 'the URL reads ?q=… on the page\'s own path');
  assert.equal(queryOf(presetState(EVENT), EVENT).toString(), '', 'the starting state is the bare path');
  const removed = withoutScope({ ...presetState(PERSON), q: 'hug' }, PERSON);
  assert.equal(queryOf(removed, PERSON).toString(), 'q=hug&scope=all');
  assert.deepEqual(stateFromQuery(new URLSearchParams('q=hug&scope=all'), PERSON).people, [], 'a reload keeps it removed');
});

test('the URL round-trips: added filters, a removed scope, another event chosen in the sheet', () => {
  for (const qs of ['', 'q=hug', 'people=1&peopleMode=all', 'q=hug&scope=all', 'types=live&scope=all']) assert.equal(roundTrip(qs, PERSON), qs, qs);
  assert.equal(roundTrip('event=other&scope=all', EVENT), 'event=other&scope=all');
  assert.equal(stateFromQuery(new URLSearchParams('event=other'), EVENT).event, 'other', 'a hand-edited link naming another event wins');
  assert.equal(roundTrip('q=hug&people=1', null), 'q=hug&people=1', 'home: just the state');
});

test('showsList: the page list shows until something beyond the page filter is typed or set', () => {
  assert.equal(showsList(presetState(EVENT), EVENT), true);
  assert.equal(showsList({ ...presetState(EVENT), q: 'hi' }, EVENT), false);
  assert.equal(showsList({ ...presetState(EVENT), types: ['live'] }, EVENT), false, 'filters work with an empty box');
  assert.equal(showsList(EMPTY_STATE, null), true);
  assert.equal(showsList({ ...EMPTY_STATE, people: [1] }, null), false);
});

test('canClear / cleared: "clear all" goes back to the page filter, keeping what is typed', () => {
  assert.equal(canClear(presetState(ACCOUNT), ACCOUNT), false, 'nothing beyond the page filter');
  assert.equal(canClear({ ...presetState(ACCOUNT), types: ['live'] }, ACCOUNT), true);
  assert.equal(canClear({ ...EMPTY_STATE, q: 'x' }, ACCOUNT), true, 'the page filter was removed');
  assert.deepEqual(cleared({ ...EMPTY_STATE, q: 'x', types: ['live'] }, ACCOUNT), { ...presetState(ACCOUNT), q: 'x' });
  assert.deepEqual(cleared({ ...EMPTY_STATE, people: [1] }, null), EMPTY_STATE);
});
