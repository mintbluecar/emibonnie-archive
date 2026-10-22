// @ts-check
import '../helpers/siteFixture.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { render } from '../../public/js/components/emptyState.js';
// Dynamic import: see test/components/header.test.js for why (emptyState.js itself
// has no site/copy dependency, but this test uses the real t() to resolve a message).
const { t } = await import('../../public/js/core/site.js');

test('emptyState: shows the caller-resolved message, escaped', () => {
  const markup = String(render({ message: t('search.empty') }));
  assert.match(markup, /<p class="c-empty-state__message">no results<\/p>/);
});

test('emptyState: a custom icon overrides the default', () => {
  const markup = String(render({ message: 'nothing yet', icon: '📭' }));
  assert.match(markup, /<span class="c-empty-state__icon" aria-hidden="true">📭<\/span>/);
});
