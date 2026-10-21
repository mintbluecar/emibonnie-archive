// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defineKind } from '../../src/kinds/defineKind.js';

function spec() {
  return {
    name: 'demo_kind',
    table: 'demos',
    urlPrefix: '/d/',
    matchesUrl: () => null,
    fetchSource: async () => ({}),
    draft: () => ({ common: {}, missing: [] }),
    persist: async () => 1,
    loadDetails: async () => new Map(),
    present: { preview: () => ({}), detail: () => ({}) },
    search: { textClause: () => 'true', matchLines: () => [] },
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

test('followUpOf is optional, but must be a function when given', () => {
  assert.doesNotThrow(() => defineKind({ ...spec(), followUpOf: () => null }));
  assert.throws(() => defineKind(/** @type {any} */ ({ ...spec(), followUpOf: 'nope' })), /followUpOf/);
});

test('rejects a urlPrefix that is not /x/', () => {
  assert.throws(() => defineKind({ ...spec(), urlPrefix: 'd' }), /urlPrefix/);
});
