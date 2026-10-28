// @ts-check
/**
 * Task 12: the sign-in screen (mockup `translator-signin-v2.html`). X is
 * always the first choice -- it's the only one that can recognise a
 * translator -- and Google the backup; both keep their provider name as
 * text (never an icon alone) and carry the path to come back to.
 */
import '../helpers/siteFixture.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copyRe, escape, pattern } from '../helpers/copyMarkup.js';
// Dynamic import: the site fixture hook must be registered before this
// module's `/site/site.js` import resolves (see header.test.js).
const { render, startHref } = await import('../../public/js/components/signIn.js');
const { t } = await import('../../public/js/core/site.js');

test('signIn: X comes first, then Google, both with their provider name as text', () => {
  const markup = String(render({ returnTo: '/me' }));
  const x = markup.indexOf(`href="${startHref('x', '/me')}"`);
  const google = markup.indexOf(`href="${startHref('google', '/me')}"`);
  assert.ok(x > -1, 'an X sign-in link');
  assert.ok(google > -1, 'a Google sign-in link');
  assert.ok(x < google, 'X is listed before Google');
  assert.ok(markup.slice(x, google).includes(escape(t('signIn.withX'))), 'the X link keeps its provider name');
  assert.ok(markup.slice(google).includes(escape(t('signIn.withGoogle'))), 'the Google link keeps its provider name');
});

test('signIn: both links carry the return path, percent-encoded', () => {
  assert.equal(startHref('x', '/me'), '/api/auth/x/start?return=%2Fme');
  assert.equal(startHref('google', '/add'), '/api/auth/google/start?return=%2Fadd');
  assert.match(String(render({ returnTo: '/add?from=1' })), /return=%2Fadd%3Ffrom%3D1/);
});

test('signIn: logo-less sites still get the wordmark and the FAN-MADE badge; a site logo is shown when present', async () => {
  const markup = String(render({ returnTo: '/me' }));
  assert.match(markup, /fix<\/span>ture archive/);
  assert.match(markup, new RegExp(t('badge.fanMade')));
  assert.ok(!markup.includes('c-signin__logo'), 'the fixture site has no logo');

  const { site } = await import('../../public/js/core/site.js');
  const original = site.logo;
  site.logo = '/site/logo.svg';
  try {
    assert.match(String(render({ returnTo: '/me' })), /class="c-signin__logo" src="\/site\/logo\.svg"/);
  } finally {
    site.logo = original;
  }
});

test('signIn: the "what we keep" note is present', () => {
  const markup = String(render({ returnTo: '/me' }));
  assert.match(markup, copyRe(t('signIn.keepLabel')));
  assert.match(markup, copyRe(t('signIn.keep')));
});

test('signIn: ?signin=failed shows signIn.failed, announced as an alert; a normal visit does not', () => {
  const failed = String(render({ returnTo: '/me', failed: true }));
  assert.match(failed, new RegExp(`role="alert"[^>]*>${pattern(t('signIn.failed'))}`));
  assert.ok(!String(render({ returnTo: '/me' })).includes(escape(t('signIn.failed'))));
});
