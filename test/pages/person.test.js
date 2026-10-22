// @ts-check
/**
 * DOM-free tests of `composePerson` (pure: `PersonView` -> `SafeHtml`),
 * on snapshots of the real `/api/person/:ig` response (generated from
 * `personView()` against the seeded example site, same as
 * `test/pages/event.test.js` does for `composeEvent`). `person.json`:
 * solsunny's real page (events grouped by event, two standalone posts
 * folding into one "posts" group). `person-groups.json`: the same shape
 * but with tl_alpha's items spliced in under a fabricated person
 * envelope, so one fixture also exercises a "shared story" group (the
 * carried Task 5 review item: "Person groups include a shared-story
 * group label and a posts group, for posts they authored").
 */
import '../helpers/siteFixture.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
// Dynamic import: see test/components/header.test.js for why.
const { composePerson, bind } = await import('../../public/js/pages/person.js');
const { MiniElement, fakeDocument } = await import('../helpers/miniDom.js');
const { mount } = await import('../../public/js/core/dom.js');

const PERSON = JSON.parse(readFileSync(new URL('../snapshots/person.json', import.meta.url), 'utf8'));
const PERSON_GROUPS = JSON.parse(readFileSync(new URL('../snapshots/person-groups.json', import.meta.url), 'utf8'));

test('composePerson: the person header, in their colour, and the counts line', () => {
  const markup = String(composePerson(PERSON));
  assert.match(markup, /c-person-header/);
  assert.match(markup, /data-c="#c47a12"/);
  assert.match(markup, /<h1 class="c-person-header__name">sol<\/h1>/);
  assert.match(markup, /in 6 translations · 3 events · 0 shared stories/);
});

test('composePerson: a search icon scoped to this person, as an SVG (not an emoji)', () => {
  const markup = String(composePerson(PERSON));
  assert.match(markup, /href="\/search\?people=1"/);
  assert.match(markup, /aria-label="search for this person"/);
  assert.ok(!markup.includes('🔍'));
});

test('composePerson: the segmented control, with "with…" (person only)', () => {
  const markup = String(composePerson(PERSON));
  assert.match(markup, /by event/);
  assert.match(markup, /all, newest/);
  assert.match(markup, /with…/);
});

test('composePerson: grouped by event, each event name its own group label', () => {
  const markup = String(composePerson(PERSON));
  assert.match(markup, /SOLLUNA HAPPY DAY · 19 Oct 2026/);
  assert.match(markup, /SOLLUNA AT STARFEST · 18 Oct 2026/);
  assert.match(markup, /sol &amp; luna ig live · 1 Mar 2026/);
});

test('composePerson: two standalone posts (no event) fold into one "posts" group', () => {
  const markup = String(composePerson(PERSON));
  const postsHeadings = markup.match(/<h2 class="c-hub-group__label">posts<\/h2>/g) ?? [];
  assert.equal(postsHeadings.length, 1, 'one "posts" heading, not one per post');
  assert.match(markup, /href="\/t\/1900000000000000009"/);
  assert.match(markup, /href="\/t\/1900000000000000008"/);
});

test('composePerson: a shared-story item groups under "shared story · <day>", distinct from "posts" and from an event', () => {
  const markup = String(composePerson(PERSON_GROUPS));
  assert.match(markup, /<h2 class="c-hub-group__label">shared story · 2 Mar 2026<\/h2>/);
  assert.match(markup, /<h2 class="c-hub-group__label">posts<\/h2>/);
  assert.match(markup, /SOLLUNA AT STARFEST · 18 Oct 2026/);
});

test('composePerson: includes the page shell\'s compact header and tab bar', () => {
  const markup = String(composePerson(PERSON));
  assert.match(markup, /c-header--compact/);
  assert.match(markup, /c-tabbar/);
  assert.match(markup, /c-footer__links/);
});

test('bind: switching to "all, newest" re-renders flat, without a group label', () => {
  const root = new MiniElement('div');
  mount(root, composePerson(PERSON));
  globalThis.document = fakeDocument();
  bind(root, PERSON);
  const allChip = /** @type {any} */ (root.querySelector('.c-hub__seg .c-chips__chip[data-value="all"]'));
  allChip.click();
  const content = /** @type {any} */ (root.querySelector('.c-hub__content'));
  assert.equal(content.querySelectorAll('.c-hub-group__label').length, 0, 'flat view has no group labels');
  assert.ok(content.querySelector('a[href="/t/1900000000000000009"]'), 'the entries are still there, just ungrouped');
  assert.equal(allChip.getAttribute('aria-pressed'), 'true');
  delete (/** @type {any} */ (globalThis)).document;
});
