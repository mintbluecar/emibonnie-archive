// @ts-check
/**
 * DOM-free tests of `composeEvent` (pure: `EventView` -> `SafeHtml`), on
 * snapshots of the real `/api/event/:slug` response -- generated from
 * `eventView()` against the seeded example site the same way
 * test/services/hubs.test.js does (see that file's "eventView" tests).
 * `event.json`: the whole event, unpaged (`hasMore: false`).
 * `event-paged.json`: the same event with `limit: 1` (`hasMore: true`),
 * for the "more" button branch (Task 3 ruling 3).
 */
import '../helpers/siteFixture.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
// Dynamic import: see test/components/header.test.js for why.
const { composeEvent } = await import('../../public/js/pages/event.js');

const EVENT = JSON.parse(readFileSync(new URL('../snapshots/event.json', import.meta.url), 'utf8'));
const EVENT_PAGED = JSON.parse(readFileSync(new URL('../snapshots/event-paged.json', import.meta.url), 'utf8'));

test('composeEvent: back link, name, and the translation section with its entries', () => {
  const markup = String(composeEvent(EVENT));
  assert.match(markup, /c-event__back/);
  assert.match(markup, /<h1 class="c-event__name">SOLLUNA HAPPY DAY<\/h1>/);
  assert.match(markup, /data-kind="translation"/);
  assert.match(markup, /href="\/t\/1900000000000000002"/);
  assert.match(markup, /href="\/t\/1900000000000000003"/);
});

test('composeEvent: the meta line is built from the real counts and copy', () => {
  const markup = String(composeEvent(EVENT));
  assert.match(markup, /19 Oct 2026 · 2 translations · 2 translators/);
});

test('composeEvent: hashtag pills, and no type/client pill when the event has none', () => {
  const markup = String(composeEvent(EVENT));
  assert.match(markup, /#SLHappyDay2026/);
  assert.match(markup, /#fanclip/);
});

test('composeEvent: a chip per person, plus "all"', () => {
  const markup = String(composeEvent(EVENT));
  assert.match(markup, /c-event__people-filter/);
  assert.match(markup, /data-value="1"[^>]*>☀️ sol/);
  assert.match(markup, /data-value="2"[^>]*>🌙 luna/);
});

test('composeEvent: a translator filter listing the accounts actually on the page', () => {
  const markup = String(composeEvent(EVENT));
  assert.match(markup, /<select class="c-event__account-filter"/);
  assert.match(markup, /<option value="tl_beta">@tl_beta<\/option>/);
  assert.match(markup, /<option value="tl_gamma">@tl_gamma<\/option>/);
});

test('composeEvent: no "more" button when a section has no further page', () => {
  const markup = String(composeEvent(EVENT));
  assert.ok(!markup.includes('c-event-section__more'));
});

test('composeEvent: a "more" button with the right data-kind/data-offset when a section has hasMore', () => {
  const markup = String(composeEvent(EVENT_PAGED));
  assert.match(markup, /data-offset="1"/);
  assert.match(markup, /<button type="button" class="c-event-section__more" data-kind="translation">more<\/button>/);
});

test('composeEvent: the newest-first toggle and the report link', () => {
  const markup = String(composeEvent(EVENT));
  assert.match(markup, /<button type="button" class="c-event__newest-toggle" aria-pressed="false">newest first<\/button>/);
  assert.match(markup, /<a class="c-event__report" href="\/soon">report<\/a>/);
});

test('composeEvent: the search icon links to the event-scoped search', () => {
  const markup = String(composeEvent(EVENT));
  assert.match(markup, /href="\/search\/\?event=solluna-happy-day-2026-10-19"/);
  assert.match(markup, /aria-label="search this event"/);
});
