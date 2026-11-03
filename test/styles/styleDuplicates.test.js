// @ts-check
/**
 * `scripts/styleDuplicates.js`, run by `npm run check`: a component rule
 * whose body (3+ declarations, same media context) repeats another
 * component's or a primitive's fails, unless a `/* not shared: <reason> *\/`
 * comment directly before it says the match is a coincidence.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findDuplicates, formatDuplicate, readStyleSources } from '../../scripts/styleDuplicates.js';

/** @param {string} path @param {string} text @param {boolean} [primitive] */
const src = (path, text, primitive = false) => ({ path, text, primitive });

test('same declarations in any order and spacing -> one finding, props sorted', () => {
  const found = findDuplicates([
    src('a.css', '.a{display:grid;gap:1px;color:red}'),
    src('b.css', '.b{color:red;  gap: 1px;display:grid}'),
  ]);
  assert.equal(found.length, 1);
  assert.deepEqual(found[0].props, ['color', 'display', 'gap']);
  assert.deepEqual([found[0].a, found[0].b], [{ path: 'b.css', selector: '.b' }, { path: 'a.css', selector: '.a' }]);
});

test('a value that differs, or !important on one side only -> none', () => {
  assert.equal(findDuplicates([
    src('a.css', '.a{display:grid;gap:1px;color:red}'),
    src('b.css', '.b{display:grid;gap:2px;color:red}'),
    src('c.css', '.c{display:grid;gap:1px;color:red !important}'),
  ]).length, 0);
});

test('same body inside a media query on one side only -> none', () => {
  assert.equal(findDuplicates([
    src('a.css', '.a{display:grid;gap:1px;color:red}'),
    src('b.css', '@media (min-width: 860px){.b{display:grid;gap:1px;color:red}}'),
  ]).length, 0);
});

test('same body inside the same media query on both sides -> one', () => {
  assert.equal(findDuplicates([
    src('a.css', '@media (min-width: 860px){.a{display:grid;gap:1px;color:red}}'),
    src('b.css', '@media (min-width:  860px){.b{display:grid;gap:1px;color:red}}'),
  ]).length, 1);
});

test('a 2-declaration match -> none', () => {
  assert.equal(findDuplicates([
    src('a.css', '.a{display:grid;gap:1px}'),
    src('b.css', '.b{display:grid;gap:1px}'),
  ]).length, 0);
});

test('two primitives matching each other -> none', () => {
  assert.equal(findDuplicates([
    src('p.css', '.p{display:grid;gap:1px;color:red}', true),
    src('q.css', '.q{display:grid;gap:1px;color:red}', true),
  ]).length, 0);
});

test('a component matching a primitive -> one, naming the component first', () => {
  const found = findDuplicates([
    src('p.css', '.p{display:grid;gap:1px;color:red}', true),
    src('c.css', '.c{display:grid;gap:1px;color:red}'),
  ]);
  assert.equal(found.length, 1);
  assert.deepEqual(found[0].a, { path: 'c.css', selector: '.c' });
  assert.deepEqual(found[0].b, { path: 'p.css', selector: '.p' });
});

test('a "not shared" comment with a reason directly before the rule -> none', () => {
  assert.equal(findDuplicates([
    src('a.css', '.a{display:grid;gap:1px;color:red}'),
    src('b.css', '/* not shared: wordmark sizes differ by design */\n.b{display:grid;gap:1px;color:red}'),
  ]).length, 0);
});

test('a "not shared" comment with no reason -> one', () => {
  assert.equal(findDuplicates([
    src('a.css', '.a{display:grid;gap:1px;color:red}'),
    src('b.css', '/* not shared: */\n.b{display:grid;gap:1px;color:red}'),
  ]).length, 1);
});

test('a "not shared" comment on a primitive does not excuse a component copy', () => {
  const found = findDuplicates([
    src('p.css', '/* not shared: coincidence */\n.p{display:grid;gap:1px;color:red}', true),
    src('c.css', '.c{display:grid;gap:1px;color:red}'),
  ]);
  assert.equal(found.length, 1);
  assert.deepEqual(found[0].a, { path: 'c.css', selector: '.c' });
  assert.deepEqual(found[0].b, { path: 'p.css', selector: '.p' });
});

test('a 3-way group of components with one marked still reports the other two', () => {
  const found = findDuplicates([
    src('a.css', '/* not shared: wordmark sizes differ by design */\n.a{display:grid;gap:1px;color:red}'),
    src('b.css', '.b{display:grid;gap:1px;color:red}'),
    src('c.css', '.c{display:grid;gap:1px;color:red}'),
  ]);
  assert.equal(found.length, 1);
  assert.deepEqual(found[0].a, { path: 'c.css', selector: '.c' });
  assert.deepEqual(found[0].b, { path: 'b.css', selector: '.b' });
});

test('formatDuplicate gives the exact message', () => {
  const message = formatDuplicate({
    a: { path: 'src/styles/components/b.css', selector: '.b' },
    b: { path: 'src/styles/components/a.css', selector: '.a' },
    props: ['color', 'display', 'gap'],
  });
  assert.equal(message, 'src/styles/components/b.css .b repeats src/styles/components/a.css .a (color, display, gap). '
    + 'Use the existing class, or move the rule into src/styles/primitives/ and use it from both. See STYLING.md "Rules card".');
});

test('the real tree has no duplicate rules', () => {
  const found = findDuplicates(readStyleSources());
  assert.deepEqual(found.map(formatDuplicate), []);
});
