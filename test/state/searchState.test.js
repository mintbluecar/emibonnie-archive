// @ts-check
/**
 * `public/js/state/searchState.js` is pure (no DOM, no network): the URL
 * is the single source of truth for a scoped search (task-5-brief.md), so
 * every one of these is a plain data round trip.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  EMPTY_STATE, parseState, toQuery, toApiParams, filterCount, withFilter, withoutFilter,
} from '../../public/js/state/searchState.js';

/** @type {import('../../src/http/contracts.js').FilterOptions} */
const OPTIONS = {
  people: [
    { id: 1, name: 'sol', emoji: '☀️', colour: '#c47a12', igHandle: 'solsunny' },
    { id: 2, name: 'luna', emoji: '🌙', colour: '#6a5cd6', igHandle: 'lunamoon' },
  ],
  categories: [{ id: 5, name: 'live' }, { id: 6, name: 'show / interview' }],
  events: [{ slug: 'solluna-happy-day-2026-10-19', name: 'SOLLUNA HAPPY DAY' }],
  accounts: [{ handle: 'tl_beta' }, { handle: 'tl_gamma' }],
};

test('parseState: a round trip through the URL returns the same state', () => {
  /** @type {import('../../public/js/state/searchState.js').State} */
  const state = {
    q: 'hello world', people: [2, 5], peopleMode: 'all', types: ['live', 'shared story', 'posts'],
    event: 'solluna-happy-day-2026-10-19', account: 'tl_beta', client: 9, from: '2026-01-01', to: '2026-12-31',
  };
  const roundTripped = parseState(toQuery(state));
  assert.deepEqual(roundTripped, state);
});

test('parseState: an empty URL parses to EMPTY_STATE', () => {
  assert.deepEqual(parseState(new URLSearchParams()), EMPTY_STATE);
});

test('toQuery: empty values are left out of the query string', () => {
  assert.equal(toQuery(EMPTY_STATE).toString(), '');
  const withOneFilter = { ...EMPTY_STATE, event: 'some-event' };
  assert.equal(toQuery(withOneFilter).toString(), 'event=some-event');
});

test('filterCount: counts active filters, not q', () => {
  assert.equal(filterCount({ ...EMPTY_STATE, q: 'something long', people: [2], types: ['live'] }), 2);
  assert.equal(filterCount(EMPTY_STATE), 0);
  assert.equal(filterCount({ ...EMPTY_STATE, people: [1, 2], account: 'tl_beta' }), 3);
});

test('toApiParams: "shared story" and "posts" map to placements, a plain category name maps to its id', () => {
  const params = toApiParams({ ...EMPTY_STATE, types: ['shared story'] }, OPTIONS);
  assert.equal(params.placements, 'shared_story');

  const postsParams = toApiParams({ ...EMPTY_STATE, types: ['posts'] }, OPTIONS);
  assert.equal(postsParams.placements, 'post');

  const categoryParams = toApiParams({ ...EMPTY_STATE, types: ['live'] }, OPTIONS);
  assert.equal(categoryParams.categories, '5');
  assert.equal(categoryParams.placements, undefined);
});

test('toApiParams: event/account/client map to eventSlug/accountHandle/clientId, q and peopleMode are left out when default', () => {
  const params = toApiParams({ ...EMPTY_STATE, event: 'e', account: 'a', client: 7 });
  assert.deepEqual(params, { eventSlug: 'e', accountHandle: 'a', clientId: '7' });
});

test('toApiParams: people and a non-default peopleMode', () => {
  const params = toApiParams({ ...EMPTY_STATE, people: [1, 2], peopleMode: 'all' });
  assert.deepEqual(params, { people: '1,2', peopleMode: 'all' });
});

test('withFilter/withoutFilter: immutable, add/remove from a list field without duplicating', () => {
  const added = withFilter(EMPTY_STATE, 'people', 2);
  assert.deepEqual(added.people, [2]);
  assert.deepEqual(EMPTY_STATE.people, [], 'the original is untouched');

  const addedAgain = withFilter(added, 'people', 2);
  assert.deepEqual(addedAgain.people, [2], 'adding the same value twice does not duplicate it');

  const removed = withoutFilter(added, 'people', 2);
  assert.deepEqual(removed.people, []);
});

test('withFilter/withoutFilter: a scalar field is set/cleared', () => {
  const withEvent = withFilter(EMPTY_STATE, 'event', 'e');
  assert.equal(withEvent.event, 'e');
  const withoutEvent = withoutFilter(withEvent, 'event');
  assert.equal(withoutEvent.event, undefined);
});
