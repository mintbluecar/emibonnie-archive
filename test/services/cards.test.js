// @ts-check
/**
 * `kindNamed`: the one guarded kind lookup every service and route shares.
 * A kind name travels through request paths (`/api/item/:kind/...`), so it
 * must never resolve to an `Object.prototype` property such as
 * `constructor` or `toString`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { kindNamed } from '../../src/services/cards.js';
import { kindsRegistry } from '../../src/kinds/_registry.js';

test('kindNamed is null for a prototype property name, even though it is "in" every object', () => {
  const deps = { kinds: kindsRegistry };
  assert.equal(kindNamed(deps, 'constructor'), null);
  assert.equal(kindNamed(deps, 'toString'), null);
  assert.equal(kindNamed(deps, '__proto__'), null);
});

test('kindNamed resolves a real kind name, from the registry or deps.kinds', () => {
  const [name, kind] = Object.entries(kindsRegistry)[0];
  assert.equal(kindNamed({ kinds: kindsRegistry }, name), kind);
  assert.equal(kindNamed({ kinds: { only: kind } }, 'only'), kind);
  assert.equal(kindNamed({ kinds: { only: kind } }, name === 'only' ? 'other' : name), null);
});
