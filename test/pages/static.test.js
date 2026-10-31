// @ts-check
/**
 * DOM-free tests of `composeStatic` (pure: a `data-page` value ->
 * `SafeHtml`) for the three trust-and-safety pages plus the 404 page:
 * every word is a copy key (`about.*`/`privacy.*`/`takedown.*`/
 * `static.*`). The privacy test lists every point the spec's "Trust,
 * safety and privacy" section (docs/.../2026-10-21-translation-archive-design.md)
 * requires `/privacy` to cover, and checks each one's copy key is
 * actually rendered -- so a future edit that drops one fails here
 * rather than silently shipping.
 */
import '../helpers/siteFixture.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadCopy } from '../../src/site/copy.js';
// Dynamic import: see test/components/header.test.js for why -- also lets
// this grab the exact (fixture) `site` the page itself renders against,
// so the contact-link assertions below can't drift from it.
const { composeStatic } = await import('../../public/js/pages/static.js');
const { site: SITE } = await import('../../public/js/core/site.js');

const COPY = loadCopy('examples/solluna');

test('about: the "what is this" line, credits, FAN-MADE badge, and the unofficial note', () => {
  const markup = String(composeStatic('about'));
  assert.match(markup, /fan-made archive of translated posts and clips/);
  assert.match(markup, /every entry credits the translator who made it/);
  assert.match(markup, /FAN-MADE/);
  assert.match(markup, /unofficial, not affiliated/);
});

/**
 * Every point docs/superpowers/specs/2026-10-21-translation-archive-design.md's
 * "Trust, safety and privacy" section requires `/privacy` to cover, each
 * mapped to the copy key that carries it.
 */
const REQUIRED_PRIVACY_POINTS = [
  ['who runs it (the fan contact)', 'privacy.whoRuns'],
  ["what's collected and why", 'privacy.whatCollected'],
  ['third parties (Vercel, Neon, GitHub, X video)', 'privacy.thirdParties'],
  ['retention', 'privacy.retention'],
  ['public vs private', 'privacy.publicPrivate'],
  ['translator remove/opt-out', 'privacy.translatorOptOut'],
  ['account deletion and erasure', 'privacy.accountDeletion'],
  ['no sale and no ads', 'privacy.noSaleNoAds'],
  ['contact', 'privacy.contactLinkLabel'],
];

/** `html`\`…\`\` escapes `'`/`"` to entities, so compare against the same escaping rather than the raw copy string. @param {string} text @returns {string} */
const htmlEscaped = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

test('privacy: covers every point the spec\'s "Trust, safety and privacy" section requires', () => {
  const markup = String(composeStatic('privacy'));
  for (const [point, key] of REQUIRED_PRIVACY_POINTS) {
    assert.ok(COPY[key], `copy is missing ${key}`);
    assert.ok(markup.includes(htmlEscaped(COPY[key])), `privacy page doesn't render ${key} (${point})`);
  }
});

test('privacy: the contact link uses site.contactUrl, not a hardcoded address', () => {
  const markup = String(composeStatic('privacy'));
  assert.match(markup, new RegExp(`href="${SITE.contactUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
});

test('takedown: who can ask, what to send, and "hide first, review second"', () => {
  const markup = String(composeStatic('takedown'));
  assert.match(markup, /who can ask/);
  assert.match(markup, /what to send/);
  assert.match(markup, /hidden first, and reviewed second/);
  assert.match(markup, new RegExp(`href="${SITE.contactUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
});

test('404 (data-page="notFound"): a generic not-found message and a link home', () => {
  const markup = String(composeStatic('notFound'));
  assert.match(markup, /page not found/);
  assert.match(markup, /<a href="\/">/);
});

test('an unknown data-page value falls back to the not-found content (defensive)', () => {
  const markup = String(composeStatic('something-unexpected'));
  assert.match(markup, /page not found/);
});

test('every page includes the page shell\'s compact header, tab bar and footer links', () => {
  for (const page of ['about', 'privacy', 'takedown', 'notFound']) {
    const markup = String(composeStatic(page));
    assert.match(markup, /<header class="c-header" data-compact>/, page);
    assert.match(markup, /c-tabbar/, page);
    assert.match(markup, /c-footer__links/, page);
  }
});

test('privacy (Task 10b): the X embed notice and its link to X\'s privacy policy show only when embedSources is on', () => {
  const off = String(composeStatic('privacy'));
  assert.ok(!off.includes('data-embed-notice'), 'off by default: no notice');
  assert.ok(!off.includes(htmlEscaped(COPY['privacy.embedNotice'])));
  /** @type {any} */ (SITE).embedSources = true;
  try {
    const on = String(composeStatic('privacy'));
    assert.ok(on.includes(htmlEscaped(COPY['privacy.embedNotice'])), on);
    assert.match(on, /<a href="https:\/\/x\.com\/en\/privacy" rel="noopener">X(&#39;|&#x27;|')s privacy policy<\/a>/);
    assert.ok(on.indexOf('data-embed-notice') > on.indexOf(htmlEscaped(COPY['privacy.thirdParties'])), 'sits with the third parties');
  } finally {
    delete (/** @type {any} */ (SITE)).embedSources;
  }
});

test('privacy (Task 10b fix I1): with embedSources on, the no-sale line no longer claims "no trackers" -- it names X\'s embed instead', () => {
  const off = String(composeStatic('privacy'));
  assert.ok(off.includes(htmlEscaped(COPY['privacy.noSaleNoAds'])));
  assert.ok(!off.includes(htmlEscaped(COPY['privacy.noSaleNoAdsEmbed'])));
  /** @type {any} */ (SITE).embedSources = true;
  try {
    const on = String(composeStatic('privacy'));
    assert.ok(on.includes(htmlEscaped(COPY['privacy.noSaleNoAdsEmbed'])), on);
    assert.ok(!on.includes(htmlEscaped(COPY['privacy.noSaleNoAds'])));
    assert.match(COPY['privacy.noSaleNoAdsEmbed'], /apart from X's embed/);
  } finally {
    delete (/** @type {any} */ (SITE)).embedSources;
  }
});
