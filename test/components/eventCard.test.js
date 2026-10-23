// @ts-check
import '../helpers/siteFixture.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { render } from '../../public/js/components/eventCard.js';

test('eventCard: links to the event, shows the date and the total count across kinds', () => {
  /** @type {import('../../src/http/contracts.js').HomeEvent} */
  const event = { slug: 'starfest-night', name: 'SOLLUNA AT STARFEST', occurredOn: '2026-10-14', hashtag: 'SolLunaStarfest', counts: { translation: 12 } };
  const markup = String(render({ event }));
  assert.match(markup, /href="\/e\/starfest-night"/);
  assert.match(markup, /14 Oct 2026/);
  assert.match(markup, /#SolLunaStarfest/);
  assert.match(markup, /<span class="c-event-card__count">12<\/span>/);
});

test('eventCard: no hashtag means no hashtag text, and counts across kinds sum', () => {
  /** @type {import('../../src/http/contracts.js').HomeEvent} */
  const event = { slug: 'x', name: 'X', occurredOn: '2026-01-01', hashtag: null, counts: { translation: 3, other: 4 } };
  const markup = String(render({ event }));
  assert.ok(!markup.includes('#'));
  assert.match(markup, />7</);
});
