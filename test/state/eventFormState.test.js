// @ts-check
/**
 * Event editing Task 9: the edit event page's pure state
 * (`public/js/state/eventFormState.js`) -- the mode from the query, the
 * fields each mode starts from, the combined tags of a merge, and the
 * small edits the form makes to its fields.
 */
import '../helpers/siteFixture.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
// Dynamic import: see test/components/header.test.js for why.
const {
  modeOf, initialFields, defaultKeepId, reseeded, unionTags, withTagAdded, withTagRemoved,
  withPersonAdded, withPersonRemoved, addressChoiceOf, addressPreview, bodyOf, moveSummary,
} = await import('../../public/js/state/eventFormState.js');

/** @param {Partial<any>} [overrides] @returns {any} */
function event(overrides = {}) {
  return {
    id: 3, slug: '2026-10-19/a', name: 'A', occurredOn: '2026-10-19', entryCount: 1, people: [],
    hidden: false, addressLocked: false, keywords: [], hashtags: ['A'], livePeopleIds: [], livePlatformCode: null,
    mergedInto: null, ...overrides,
  };
}

test('modeOf: edit, merge and create from the query', () => {
  assert.deepEqual(modeOf('?id=4'), { mode: 'edit', id: 4 });
  assert.deepEqual(modeOf('?merge=3,7'), { mode: 'merge', ids: [3, 7] });
  assert.deepEqual(modeOf('?from=5&items=1,2'), { mode: 'create', fromId: 5, itemIds: [1, 2] });
});

test('modeOf: anything unparseable is null', () => {
  assert.equal(modeOf('?id=x'), null);
  assert.equal(modeOf(''), null);
  assert.equal(modeOf('?id=0'), null);
  assert.equal(modeOf('?id=1.5'), null);
  assert.equal(modeOf('?merge=3'), null, 'a merge needs two events');
  assert.equal(modeOf('?merge=3,3'), null, 'the same event twice is one event');
  assert.equal(modeOf('?merge=3,x'), null);
  assert.equal(modeOf('?from=5'), null, 'create needs the entries');
  assert.equal(modeOf('?from=5&items='), null);
  assert.equal(modeOf('?id=4&merge=3,7'), null, 'two modes at once');
});

test('initialFields: edit starts from the event itself', () => {
  const e = event({ keywords: ['K'], hashtags: ['H1', 'H2'], slug: '2026-10-19/h2', livePeopleIds: [2], livePlatformCode: 'tiktok' });
  assert.deepEqual(initialFields(modeOf('?id=3'), [e]), {
    name: 'A', occurredOn: '2026-10-19', keywords: ['K'], hashtags: ['H1', 'H2'],
    livePeopleIds: [2], livePlatformCode: 'tiktok', addressTag: 'H2',
  });
});

test('initialFields: merge keeps the largest event and unions the tags, kept event first', () => {
  const small = event({ id: 3, entryCount: 1, name: 'Small', hashtags: ['#A', '#B'], keywords: ['k'] });
  const big = event({ id: 7, entryCount: 4, name: 'Big', occurredOn: '2026-10-20', hashtags: ['#B', '#C'], keywords: ['K', 'other'], livePeopleIds: [9] });
  const fields = initialFields(modeOf('?merge=3,7'), [small, big]);
  assert.equal(fields.name, 'Big');
  assert.equal(fields.occurredOn, '2026-10-20');
  assert.deepEqual(fields.livePeopleIds, [9]);
  assert.deepEqual(fields.hashtags, ['#B', '#C', '#A']);
  assert.deepEqual(fields.keywords, ['K', 'other'], 'k is K again (case-insensitive)');
  assert.equal(defaultKeepId([small, big]), 7);
});

test('defaultKeepId: a visible event over a hidden one with more entries; the most entries when all are hidden', () => {
  const hiddenBig = event({ id: 3, entryCount: 9, hidden: true });
  const visible = event({ id: 7, entryCount: 2 });
  const visibleSmall = event({ id: 9, entryCount: 1 });
  assert.equal(defaultKeepId([hiddenBig, visibleSmall, visible]), 7);
  assert.equal(defaultKeepId([hiddenBig, event({ id: 7, entryCount: 2, hidden: true })]), 3);
});

test('unionTags: de-duplicated, first spelling kept, order of first appearance', () => {
  assert.deepEqual(unionTags([['#A', '#B'], ['#B', '#C']]), ['#A', '#B', '#C']);
  assert.deepEqual(unionTags([['Moon'], ['moon ', 'Sun']]), ['Moon', 'Sun']);
});

test('initialFields: create starts blank, dated by the earliest ticked entry', () => {
  const entries = [
    { itemId: 1, occurredOn: '2026-10-21' }, { itemId: 2, occurredOn: '2026-10-19' }, { itemId: 3, occurredOn: '2026-01-01' },
  ];
  const fields = initialFields(modeOf('?from=5&items=1,2'), [event({ id: 5, hashtags: ['X'] })], /** @type {any} */ (entries));
  assert.deepEqual(fields, {
    name: '', occurredOn: '2026-10-19', keywords: [], hashtags: [], livePeopleIds: [], livePlatformCode: null, addressTag: '',
  });
});

test('reseeded: a new kept event brings its title, date, live and address; the tags stay', () => {
  const fields = { ...initialFields(modeOf('?id=3'), [event()]), keywords: ['kept'], hashtags: ['A', 'Z'] };
  const next = reseeded(fields, event({ id: 7, name: 'Other', occurredOn: '2026-11-01', slug: '2026-11-01/z', livePeopleIds: [4], livePlatformCode: 'ig' }));
  assert.deepEqual(next, {
    name: 'Other', occurredOn: '2026-11-01', keywords: ['kept'], hashtags: ['A', 'Z'],
    livePeopleIds: [4], livePlatformCode: 'ig', addressTag: 'Z',
  });
});

test('withTagAdded: "#x" is a hashtag, anything else a keyword, never twice', () => {
  const base = initialFields(modeOf('?id=3'), [event({ hashtags: [] })]);
  const one = withTagAdded(base, ' #Moon ');
  assert.deepEqual(one.hashtags, ['Moon']);
  const two = withTagAdded(one, 'SUN DAY');
  assert.deepEqual(two.keywords, ['SUN DAY']);
  assert.equal(withTagAdded(two, '#moon'), two, 'already there');
  assert.equal(withTagAdded(two, '  '), two);
  assert.equal(withTagAdded(two, '#'), two);
});

test('withTagRemoved: removing the address hashtag falls back to the title', () => {
  const fields = { ...initialFields(modeOf('?id=3'), [event({ hashtags: ['A', 'B'] })]), addressTag: 'B' };
  const next = withTagRemoved(fields, 'hashtag', 'B');
  assert.deepEqual(next.hashtags, ['A']);
  assert.equal(next.addressTag, '');
  assert.equal(withTagRemoved(fields, 'hashtag', 'A').addressTag, 'B');
});

test('withPersonAdded / withPersonRemoved', () => {
  const base = initialFields(modeOf('?id=3'), [event({ livePeopleIds: [1] })]);
  assert.deepEqual(withPersonAdded(base, 2).livePeopleIds, [1, 2]);
  assert.deepEqual(withPersonAdded(base, 1).livePeopleIds, [1]);
  assert.deepEqual(withPersonRemoved(base, 1).livePeopleIds, []);
});

test('addressChoiceOf: the hashtag the address came from, else the title', () => {
  assert.equal(addressChoiceOf(event({ slug: '2026-10-19/moonfest26', hashtags: ['ANY', 'MOONFEST26'] })), 'MOONFEST26');
  assert.equal(addressChoiceOf(event({ slug: '2026-10-19/moonfest26-2', hashtags: ['MOONFEST26'] })), 'MOONFEST26', 'past a clash suffix');
  assert.equal(addressChoiceOf(event({ slug: '2026-10-19/a-name', name: 'A Name', hashtags: ['Tag'] })), '');
});

test('addressPreview: /e/<date>/<tag>, the title when no hashtag is chosen', () => {
  const fields = { ...initialFields(modeOf('?id=3'), [event()]), name: 'Juniper TikTok Live', occurredOn: '2025-12-04' };
  assert.equal(addressPreview({ ...fields, addressTag: '' }), '/e/2025-12-04/juniper-tiktok-live');
  assert.equal(addressPreview({ ...fields, addressTag: 'JuniperTiktok' }), '/e/2025-12-04/junipertiktok');
});

test('bodyOf: the title stands in for an unchosen address hashtag', () => {
  const fields = { ...initialFields(modeOf('?id=3'), [event()]), name: 'Name', addressTag: '' };
  assert.equal(bodyOf(fields).addressTag, 'Name');
  assert.equal(bodyOf({ ...fields, addressTag: 'A' }).addressTag, 'A');
});

test('moveSummary: the tweets and events the kept one takes in', () => {
  const events = [event({ id: 3, entryCount: 2 }), event({ id: 7, entryCount: 1 }), event({ id: 9, entryCount: 1 })];
  assert.deepEqual(moveSummary(events, 3), { tweets: 2, events: 2 });
  assert.deepEqual(moveSummary(events, 7), { tweets: 3, events: 2 });
});
