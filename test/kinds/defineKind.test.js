// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defineKind } from '../../src/kinds/defineKind.js';

function spec() {
  return {
    name: 'demo_kind',
    table: 'demos',
    urlPrefix: '/d/',
    platform: 'x',
    matchesUrl: () => null,
    fetchSource: async () => ({}),
    draft: () => ({ common: {}, missing: [] }),
    persist: async () => 1,
    loadDetails: async () => new Map(),
    present: { preview: () => ({}), detail: () => ({}) },
    search: { textClause: () => 'true', rank: () => '0', matchLines: () => [] },
  };
}

test('a complete spec gives a frozen kind', () => {
  const kind = defineKind(spec());
  assert.equal(kind.name, 'demo_kind');
  assert.ok(Object.isFrozen(kind));
  assert.ok(Object.isFrozen(kind.present));
  assert.ok(Object.isFrozen(kind.search));
});

test('rejects a spec missing search.textClause', () => {
  const bad = /** @type {any} */ (spec());
  delete bad.search.textClause;
  assert.throws(() => defineKind(bad), /search\.textClause/);
});

test('rejects a spec missing search.rank', () => {
  const bad = /** @type {any} */ (spec());
  delete bad.search.rank;
  assert.throws(() => defineKind(bad), /search\.rank/);
});

test('rejects a spec missing fetchSource', () => {
  const bad = /** @type {any} */ (spec());
  delete bad.fetchSource;
  assert.throws(() => defineKind(bad), /fetchSource/);
});

for (const name of ['Translation', '1kind', 'kind-x', '', '_x']) {
  test(`rejects the name ${JSON.stringify(name)}`, () => {
    assert.throws(() => defineKind({ ...spec(), name }), /name/);
  });
}

test('followUpOf is optional, but must be a function when given, with appendFollowUp beside it', () => {
  const appendFollowUp = async () => {};
  assert.doesNotThrow(() => defineKind({ ...spec(), followUpOf: () => null, appendFollowUp }));
  assert.throws(() => defineKind(/** @type {any} */ ({ ...spec(), followUpOf: 'nope', appendFollowUp })), /followUpOf/);
  assert.throws(() => defineKind({ ...spec(), followUpOf: () => null }), /appendFollowUp/);
});

test('rejects a missing or malformed platform', () => {
  assert.throws(() => defineKind(/** @type {any} */ ({ ...spec(), platform: undefined })), /platform/);
  assert.throws(() => defineKind({ ...spec(), platform: 'X!' }), /platform/);
});

test('rejects a urlPrefix that is not /x/', () => {
  assert.throws(() => defineKind({ ...spec(), urlPrefix: 'd' }), /urlPrefix/);
});

test('rejects a reserved urlPrefix, and /t/ for any kind but translation', () => {
  for (const urlPrefix of ['/e/', '/p/', '/tl/', '/search/', '/api/', '/add/', '/me/', '/t/']) {
    assert.throws(() => defineKind({ ...spec(), urlPrefix }), /urlPrefix .* (is reserved|belongs to the translation kind)/, urlPrefix);
  }
  assert.equal(defineKind({ ...spec(), name: 'translation', urlPrefix: '/t/' }).urlPrefix, '/t/');
  assert.throws(() => defineKind({ ...spec(), name: 'translation', urlPrefix: '/e/' }), /reserved/);
});

test('refresh and checkFollowUps are optional, but must be functions when given', () => {
  const kind = defineKind(spec());
  assert.equal(kind.refresh, undefined);
  assert.equal(kind.checkFollowUps, undefined);
  assert.doesNotThrow(() => defineKind({ ...spec(), refresh: async () => ({ updated: 0, editableUntil: null }), checkFollowUps: async () => ({ added: 0 }) }));
  assert.throws(() => defineKind(/** @type {any} */ ({ ...spec(), refresh: 'nope' })), /refresh must be a function/);
  assert.throws(() => defineKind(/** @type {any} */ ({ ...spec(), checkFollowUps: {} })), /checkFollowUps must be a function/);
});
