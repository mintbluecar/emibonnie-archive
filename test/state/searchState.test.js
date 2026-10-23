// @ts-check
/**
 * `public/js/state/searchState.js` is pure (no DOM, no network): the URL
 * is the single source of truth for a scoped search (task-5-brief.md), so
 * every one of these is a plain data round trip.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  EMPTY_STATE, parseState, toQuery, toApiParams, filterCount, withFilter, withoutFilter, sanitizeTypes, isBlank,
} from '../../public/js/state/searchState.js';

/** @type {import('../../src/http/contracts.js').FilterOptions} */
const OPTIONS = {
  people: [
    { id: 1, name: 'sol', emoji: '☀️', colour: '#c47a12', igHandle: 'solsunny' },
    { id: 2, name: 'luna', emoji: '🌙', colour: '#6a5cd6', igHandle: 'lunamoon' },
  ],
  categories: [{ id: 5, name: 'live' }, { id: 6, name: 'show / interview' }],
  events: [{ slug: 'solluna-happy-day-2026-10-19', name: 'SOLLUNA HAPPY DAY' }],
  clients: [{ id: 9, name: 'Big Media Co' }],
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

test('toQuery: list fields (people, types) are repeated params, not comma-joined (review round 1, M3)', () => {
  const qs = toQuery({ ...EMPTY_STATE, people: [1, 2], types: ['live', 'shared story'] });
  assert.equal(qs.toString(), 'people=1&people=2&types=live&types=shared+story');
});

test('parseState: reads repeated list params back with getAll', () => {
  const params = new URLSearchParams('people=1&people=2&types=live&types=shared+story');
  const state = parseState(params);
  assert.deepEqual(state.people, [1, 2]);
  assert.deepEqual(state.types, ['live', 'shared story']);
});

test('parseState: drops an invalid from/to date rather than carrying garbage (review round 1, I2)', () => {
  const state = parseState(new URLSearchParams('from=not-a-date&to=2026-13-40'));
  assert.equal(state.from, undefined);
  assert.equal(state.to, undefined);
  const valid = parseState(new URLSearchParams('from=2026-01-01&to=2026-12-31'));
  assert.equal(valid.from, '2026-01-01');
  assert.equal(valid.to, '2026-12-31');
});

test('sanitizeTypes: drops a types entry that is neither a known category name nor a placement chip (review round 1, M3)', () => {
  const state = { ...EMPTY_STATE, types: ['live', 'made-up-category', 'shared story'] };
  const sanitized = sanitizeTypes(state, OPTIONS);
  assert.deepEqual(sanitized.types, ['live', 'shared story']);
});

test('sanitizeTypes: an unknown type is neither counted by filterCount nor considered blank', () => {
  const state = { ...EMPTY_STATE, types: ['made-up-category'] };
  const sanitized = sanitizeTypes(state, OPTIONS);
  assert.equal(filterCount(sanitized), 0);
  assert.equal(isBlank(sanitized), true);
});
