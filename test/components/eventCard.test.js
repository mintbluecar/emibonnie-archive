// @ts-check
import '../helpers/siteFixture.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
// Dynamic import: see test/components/header.test.js for why.
const { render } = await import('../../public/js/components/eventCard.js');

test('eventCard: links to the event, shows the date and the total count across kinds', () => {
  /** @type {import('../../src/http/contracts.js').HomeEvent} */
  const event = { slug: 'starfest-night', name: 'SOLLUNA AT STARFEST', occurredOn: '2026-10-14', hashtag: 'SolLunaStarfest', counts: { translation: 12 }, thumb: null };
  const markup = String(render({ event }));
  assert.match(markup, /href="\/e\/starfest-night"/);
  assert.match(markup, /14 Oct 2026/);
  assert.match(markup, /#SolLunaStarfest/);
  assert.match(markup, /<span class="badge badge--accent c-event-card__count">12<\/span>/);
});

test('eventCard: no hashtag means no hashtag text, and counts across kinds sum', () => {
  /** @type {import('../../src/http/contracts.js').HomeEvent} */
  const event = { slug: 'x', name: 'X', occurredOn: '2026-01-01', hashtag: null, counts: { translation: 3, other: 4 } };
  const markup = String(render({ event }));
  assert.ok(!markup.includes('#'));
  assert.match(markup, />7</);
});

test('eventCard: a representative picture leads the card when the event has one', () => {
  /** @type {import('../../src/http/contracts.js').HomeEvent} */
  const event = {
    slug: 'starfest-night', name: 'SOLLUNA AT STARFEST', occurredOn: '2026-10-14', hashtag: null, counts: { translation: 1 },
    thumb: { url: 'https://pbs.twimg.com/media/x.jpg', width: 1080, height: 1920, video: true },
  };
  const markup = String(render({ event }));
  assert.match(markup, /<span class="c-thumb" data-cover>/, 'the card\'s full-width cover picture');
  assert.match(markup, /<img class="c-thumb__img" src="https:\/\/pbs\.twimg\.com\/media\/x\.jpg"/);
  assert.ok(markup.indexOf('c-thumb') < markup.indexOf('c-event-card__name'), 'picture before the name');
});

test('eventCard: no picture, no image', () => {
  const event = { slug: 's', name: 'N', occurredOn: '2026-10-14', hashtag: null, counts: {}, thumb: null };
  const markup = String(render({ event }));
  assert.doesNotMatch(markup, /<img/);
  assert.doesNotMatch(markup, /c-thumb/);
});
