// @ts-check
/**
 * Task 12: the me page's signed-in and signed-out views. The DOM wiring
 * is exercised by `e2e/me.spec.js`; these tests pin the parts a browser
 * check can only assert indirectly -- every icon-only control has both a
 * `title` and an `aria-label`, and each entry's edit link points at the
 * entry's own edit page.
 */
import '../helpers/siteFixture.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copyRe } from '../helpers/copyMarkup.js';
const { composeSignedIn, composeSignedOut } = await import('../../public/js/pages/me.js');
const { t } = await import('../../public/js/core/site.js');

/** @returns {import('../../src/http/contracts.js').Preview & { reviewState: string }} */
function result(overrides = {}) {
  return {
    kind: 'translation', sourceId: '1900000000000000001', url: '/t/1900000000000000001',
    lines: [{ kind: 'speech', emoji: '🦁', name: 'host', colour: '#b5651d', text: 'hi', cont: false }],
    people: [], accountHandle: 'tl_alpha', accountUrl: 'https://x.com/tl_alpha', hasVideo: false, followsOnFrom: null, thumb: null,
    occurredOn: '2026-10-14', placement: 'post', reviewState: 'published',
    ...overrides,
  };
}

const X_USER = { via: 'x', handle: 'sample_translator', displayName: null, isOwner: false, isTranslator: false, needsName: false };

/** Every `class="…c-me__icon…"` opening tag in `markup`. @param {string} markup */
const iconTags = (markup) => [...markup.matchAll(/<[^>]*class="[^"]*c-me__icon[^"]*"[^>]*>/g)].map((m) => m[0]);

test('me: signed out shows the sign-in screen, with its failed notice when asked', () => {
  const markup = String(composeSignedOut({ returnTo: '/me', failed: true }));
  assert.match(markup, copyRe(t('signIn.withX')));
  assert.match(markup, /role="alert"/);
  assert.match(markup, copyRe(t('signIn.failed')));
});

test('me: every icon button has both a title and an aria-label', () => {
  const markup = String(composeSignedIn({
    user: X_USER,
    added: [result(), result({ sourceId: '2', url: '/t/2', reviewState: 'pending' })],
    hasMore: true,
  }));
  const tags = iconTags(markup);
  assert.ok(tags.length >= 3, `expected sign out, sign out everywhere and an edit control: ${tags.join('\n')}`);
  for (const tag of tags) assert.match(tag, /title="[^"]+"/, tag);
  for (const tag of tags) assert.match(tag, /aria-label="[^"]+"/, tag);
});

test('me: each entry links to its own edit page with a labelled icon', () => {
  const markup = String(composeSignedIn({ user: X_USER, added: [result()], hasMore: false }));
  assert.match(markup, /href="\/edit\/translation\/1900000000000000001"/);
  const editTag = iconTags(markup).find((tag) => tag.includes('/edit/'));
  assert.ok(editTag, 'an edit link');
  assert.match(editTag ?? '', new RegExp(`title="${t('me.edit')}"`));
  assert.match(editTag ?? '', new RegExp(`aria-label="${t('me.edit')}"`));
});

test('me: a held or rejected entry is labelled, a published one is not', () => {
  const markup = String(composeSignedIn({
    user: X_USER,
    added: [result({ reviewState: 'pending' }), result({ sourceId: '2', url: '/t/2', reviewState: 'rejected' }), result({ sourceId: '3', url: '/t/3' })],
    hasMore: false,
  }));
  assert.match(markup, copyRe(t('me.pending')));
  assert.match(markup, copyRe(t('me.rejected')));
});

test('me: Google users who still need a name get the name form instead of the list', () => {
  const markup = String(composeSignedIn({
    user: { via: 'google', handle: null, displayName: null, isOwner: false, isTranslator: false, needsName: true },
    added: [],
    hasMore: false,
  }));
  assert.match(markup, /c-name-form/);
});

test('me: the empty list says so, and delete my account is present', () => {
  const markup = String(composeSignedIn({ user: X_USER, added: [], hasMore: false }));
  assert.match(markup, copyRe(t('me.empty')));
  assert.match(markup, copyRe(t('me.deleteAccount')));
});
