// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { html, raw, SafeHtml } from '../../public/js/core/html.js';

test('html escapes values, not raw()', () => {
  const name = '<b>&</b>';
  assert.equal(String(html`<p>${name}${raw('<i>x</i>')}</p>`), '<p>&lt;b&gt;&amp;&lt;/b&gt;<i>x</i></p>');
});

test('html escapes each of & < > " \'', () => {
  assert.equal(String(html`${'&<>"\''}`), '&amp;&lt;&gt;&quot;&#39;');
});

test('html: null and false render as nothing', () => {
  assert.equal(String(html`a${null}b${false}c`), 'abc');
});

test('html: arrays are joined, each part escaped unless SafeHtml', () => {
  assert.equal(String(html`${['<a>', raw('<b/>'), 'c']}`), '&lt;a&gt;<b/>c');
});

test('html: nesting another html`…` call stays unescaped (it is SafeHtml)', () => {
  const inner = html`<span>ok</span>`;
  assert.equal(String(html`<div>${inner}</div>`), '<div><span>ok</span></div>');
});

test('raw() markup is returned verbatim by String()', () => {
  assert.equal(String(raw('<b>x</b>')), '<b>x</b>');
});

test('SafeHtml instances carry their markup', () => {
  assert.ok(html`x` instanceof SafeHtml);
  assert.ok(raw('x') instanceof SafeHtml);
});
