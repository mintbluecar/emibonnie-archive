// @ts-check
/**
 * Task 13: step 2 of the add flow (and the edit page's step 2). Every
 * field the preview filled in is shown for checking, an owner alone may
 * add to the Type and Client/Media lists, and a text-only post has no
 * pinned area at all -- not an empty one.
 */
import '../helpers/siteFixture.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copyRe } from '../helpers/copyMarkup.js';
// Dynamic import: see header.test.js for why.
const { render } = await import('../../public/js/components/addDetails.js');
const { choicesFromDraft } = await import('../../public/js/state/addState.js');
const { t } = await import('../../public/js/core/site.js');

/** @returns {any} a preview draft's form-relevant parts */
function draft(overrides = {}) {
  return {
    common: {
      placement: 'event', eventId: 11, proposal: null, occurredOn: '2026-10-14',
      categoryName: 'live', clientName: null, followsOn: null,
      credited: { handle: 'tl_alpha' },
    },
    tweet: { authorHandle: 'tl_alpha', clipSource: null },
    newTags: ['#MoonshadowSeriesFinalEP'],
    media: null,
    subbed: false,
    ...overrides,
  };
}

const OPTIONS = {
  people: [],
  roles: ['host', 'fan', 'speaker', 'crowd'],
  events: [{ id: 11, name: 'SOLLUNA HAPPY DAY', slug: 'solluna-happy-day', occurredOn: '2026-10-19' }],
  categories: ['live', 'show / interview'],
  clients: ['Big Media Co'],
};

/**
 * @param {{ isOwner?: boolean, draft?: any, choices?: any, media?: any }} [props]
 */
function markupOf({ isOwner = false, draft: d = draft(), choices = {}, media = null } = {}) {
  return String(render({ draft: d, options: OPTIONS, isOwner, choices: { ...choicesFromDraft(d), ...choices }, media }));
}

test('addDetails: only the owner is offered a new type or client', () => {
  const member = markupOf({ isOwner: false });
  assert.ok(!member.includes(t('add.newType')), member);
  assert.ok(!member.includes(t('add.newClient')), member);

  const owner = markupOf({ isOwner: true });
  assert.match(owner, copyRe(t('add.newType')));
  assert.match(owner, copyRe(t('add.newClient')));
});

test('addDetails: the matched event, its date and the hashtags are shown for checking', () => {
  const markup = markupOf();
  assert.match(markup, copyRe(t('add.detailsTitle')));
  assert.match(markup, /SOLLUNA HAPPY DAY/);
  assert.match(markup, /#MoonshadowSeriesFinalEP/);
  assert.match(markup, copyRe(t('add.matches')));
});

test('addDetails: a text-only post shows no pinned area, a clip shows the player', () => {
  assert.ok(!markupOf().includes('c-media-box'), 'nothing pinned for a text-only post');

  const withClip = markupOf({
    media: { type: 'video', variants: [{ bitrate: 1, url: 'https://video.twimg.com/x.mp4' }], width: 320, height: 180, poster: null },
  });
  assert.match(withClip, /class="c-media-box"/);
  assert.match(withClip, /class="c-video/);
});

test('addDetails: a new event offers a typed title, prefilled from the proposed name', () => {
  const markup = markupOf({
    draft: draft({ common: { ...draft().common, eventId: null, proposal: { name: 'SOLLUNA HAPPY DAY (2)', slug: 'x' } } }),
    choices: { eventMode: 'new' },
  });
  assert.match(markup, copyRe(t('add.newEvent')));
  assert.match(markup, /value="SOLLUNA HAPPY DAY \(2\)"/);
});

test('addDetails: every placement is offered, with the current one selected', () => {
  const markup = markupOf({ choices: { placement: 'post' } });
  for (const placement of ['event', 'shared_story', 'post', 'unsorted']) {
    assert.match(markup, copyRe(t(`add.placement.${placement}`)), placement);
  }
  assert.match(markup, /<option value="post"[^>]*selected/);
});

test('addDetails: "already subbed" is a checkbox with its own visible label', () => {
  const markup = markupOf();
  const label = markup.match(/<label[^>]*class="c-add__check"[^>]*>[\s\S]*?<\/label>/)?.[0] ?? '';
  assert.match(label, /<input[^>]*type="checkbox"[^>]*data-field="subbed"/);
  assert.match(label, copyRe(t('add.subbed')));
});

test('addDetails: follows-on is offered when the post quotes its own earlier translation', () => {
  const withQuote = markupOf({ draft: draft({ common: { ...draft().common, followsOn: { platform: 'x', externalId: '9' } } }) });
  assert.match(withQuote, copyRe(t('add.followsOn')));
  assert.match(withQuote, copyRe(t('add.followsOnAdd')));
});

test('addDetails: a member picks a type from the list, never free text', () => {
  const markup = markupOf();
  assert.match(markup, /<option value="live"[^>]*selected/);
  assert.match(markup, /<option value="show \/ interview">show \/ interview<\/option>/);
});
