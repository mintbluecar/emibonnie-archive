#!/usr/bin/env node
// @ts-check
// Generates this directory's synthetic tweet fixtures. Every id, handle
// and line of text here is invented for the test suite; none of it is
// copied from a real tweet. Run with `node test/fixtures/tweets/build.mjs`.
// Structure (keys and nesting) mirrors the two real sources described in
// docs/decisions/0003-two-tweet-sources.md: X's syndication endpoint
// (`.syn.json`) and FxTwitter (`.fx.json`), plus FxTwitter's thread
// endpoint (`.thread.json`).
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DIR = fileURLToPath(new URL('.', import.meta.url));

const AUTHORS = {
  alpha: { handle: 'tl_alpha', id: '9001', name: 'alpha clips' },
  beta: { handle: 'tl_beta', id: '9002', name: 'beta subs' },
  gamma: { handle: 'tl_gamma', id: '9003', name: 'gamma live' },
  delta: { handle: 'tl_delta', id: '9004', name: 'delta clips' },
  solX: { handle: 'solsunny_x', id: '8001', name: 'sol' },
};

/** @param {string} iso */
function twitterDate(iso) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const d = new Date(iso);
  const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return `${days[d.getUTCDay()]} ${months[d.getUTCMonth()]} ${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} +0000 ${d.getUTCFullYear()}`;
}

/**
 * @param {string} fullText
 * @param {string} hashtag
 */
function hashtagEntity(fullText, hashtag) {
  const start = fullText.indexOf(`#${hashtag}`);
  return { indices: [start, start + hashtag.length + 1], text: hashtag };
}

const MP4_BITRATES = [632000, 950000, 2176000, 10368000];

/**
 * @param {{id: string, width: number, height: number, durationMs: number, badHost?: boolean}} opts
 */
function videoMediaDetail({ id, width, height, durationMs, badHost }) {
  const variants = [
    { content_type: 'application/x-mpegURL', url: `https://video.twimg.com/amplify_video/${id}/pl/playlist.m3u8` },
    ...MP4_BITRATES.map((bitrate) => ({
      bitrate,
      content_type: 'video/mp4',
      url: `https://video.twimg.com/amplify_video/${id}/vid/avc1/${bitrate}.mp4`,
    })),
  ];
  if (badHost) {
    variants.push({ bitrate: 100000, content_type: 'video/mp4', url: `https://cdn.badhost.example/${id}/low.mp4` });
  }
  return {
    type: 'video',
    media_url_https: `https://pbs.twimg.com/amplify_video_thumb/${id}/thumb.jpg`,
    original_info: { width, height },
    video_info: { duration_millis: durationMs, variants },
  };
}

/**
 * @param {{id: string, width: number, height: number, badHost?: boolean}} opts
 */
function photoMediaDetail({ id, width, height, badHost }) {
  const host = badHost ? 'cdn.badhost.example' : 'pbs.twimg.com';
  return {
    type: 'photo',
    media_url_https: `https://${host}/media/${id}.jpg`,
    original_info: { width, height },
  };
}

/**
 * @param {string} fullText
 * @param {string} tcoId
 * @param {string} expandedUrl
 */
function mediaEntity(fullText, tcoId, expandedUrl) {
  const url = `https://t.co/${tcoId}`;
  return {
    indices: [fullText.length, fullText.length + url.length],
    display: `pic.x.com/${tcoId}`,
    original: url,
    url,
    expanded_url: expandedUrl,
  };
}

/**
 * Builds the `.syn.json` and `.fx.json` pair for one tweet.
 * @param {object} spec
 */
function buildTweet(spec) {
  const {
    id,
    author,
    text,
    createdAtIso,
    lang = 'en',
    noteText = null,
    mediaDetails = [],
    hashtags = [],
    clipExpandedUrl = null,
    quoted = null,
    editControl = null,
    isStaleEdit = false,
    replyTo = null,
  } = spec;

  const hasMedia = mediaDetails.length > 0;
  const tcoId = `${id}media`;
  const expandedUrl = clipExpandedUrl ?? `https://x.com/${author.handle}/status/${id}/video/1`;
  const baseText = noteText ?? text;
  const synText = hasMedia ? `${baseText} https://t.co/${tcoId}` : baseText;
  const displayEnd = baseText.length;

  const entitiesMedia = hasMedia ? [mediaEntity(baseText, tcoId, expandedUrl)] : [];
  const entities = {
    hashtags: hashtags.map((tag) => hashtagEntity(text, tag)),
    media: entitiesMedia,
  };

  const syn = {
    __typename: 'Tweet',
    favorite_count: 42,
    lang,
    possibly_sensitive: false,
    created_at: createdAtIso,
    display_text_range: [0, displayEnd],
    entities,
    id_str: id,
    text: synText,
    user: { id_str: author.id, name: author.name, screen_name: author.handle },
    mediaDetails,
    photos: [],
    video: null,
    conversation_count: 1,
    news_action_type: 'conversation',
    isEdited: Boolean(editControl),
    isStaleEdit,
  };
  if (noteText) syn.note_tweet = { id: `note_${id}` };
  if (quoted) syn.quoted_tweet = quoted.syn;
  if (editControl) syn.edit_control = editControl;

  const fx = {
    status: {
      type: 'status',
      url: `https://x.com/${author.handle}/status/${id}`,
      id,
      text,
      raw_text: { text, display_text_range: [0, text.length], facets: [] },
      author: { screen_name: author.handle, url: `https://x.com/${author.handle}`, id: author.id, name: author.name },
      replies: 0,
      reposts: 0,
      likes: 42,
      bookmarks: 0,
      quotes: quoted ? 1 : 0,
      embed_card: hasMedia ? 'player' : 'tweet',
      created_at: twitterDate(createdAtIso),
      created_timestamp: Math.floor(new Date(createdAtIso).getTime() / 1000),
      possibly_sensitive: false,
      views: 100,
      is_note_tweet: Boolean(noteText),
      community_note: null,
      lang,
      replying_to: replyTo,
      media: hasMedia ? { all: [], videos: [], photos: [] } : {},
      provider: 'twitter',
      reposted_by: null,
    },
    thread: null,
    code: 200,
  };
  if (quoted) fx.status.quote = quoted.fx.status;
  fx.author = fx.status.author;

  return { syn, fx };
}

/**
 * @param {string} dir
 * @param {string} id
 * @param {{syn: any, fx?: any}} pair
 */
function write(dir, id, pair) {
  writeFileSync(path.join(dir, `${id}.syn.json`), `${JSON.stringify(pair.syn, null, 1)}\n`);
  if (pair.fx) writeFileSync(path.join(dir, `${id}.fx.json`), `${JSON.stringify(pair.fx, null, 1)}\n`);
}

const LONG_FULL_TEXT = `SOLLUNA AT STARFEST
#SolLunaStarfest #fancamclip

🦁: Can you tell everyone what it felt like when the lights went down for the countdown?
🌧️: Honestly, the second the countdown started, the whole arena got so loud, and then it dropped into almost total silence right when the two of them turned to look at each other. I have never felt a crowd change like that so fast.
🌧️: I was standing near the rail with my phone up the entire time because I did not want to miss a single frame of it, and I am so glad I kept recording through the whole thing instead of just the first few seconds like I usually do.
🦁: Sol and luna, is there anything the two of you want to say about this moment, now that you have seen the clip going around?
🐶: Yeah, I was right behind the barrier for that whole segment and I swear the air in the room actually changed the second they stepped toward each other.
🐱: Same here, honestly, and I was on the opposite side of the stage.
🐶: I think it is because they usually keep some distance when they are on a stage like that, so when they closed it like that it felt like a much bigger deal than it probably was meant to be.
🐱: Exactly, it felt completely different from every other fan event we have both been to this year, and we have been to a lot of them together.
🦁: Were either of you surprised when you saw it happen live?
🐱: Not really, we already kind of knew something like that was coming.*
🦁: What???
🐱: It is confirmed! Confirmed! The whole thing is already confirmed!
🐶: Confirmed, confirmed, confirmed.
🐱: Confirmed, confirmed. It was already confirmed a while ago. Oi.
🦁: Ahh, confirmed.
🐱: That really shocked me the first time I heard it. Come and hug me.**
🗣️: Ahhh~
🦁: Ahhh, what do we even do with that~
🐶: What?
🦁: Go ahead, go ahead, you two can hug it out.
🐶: We hug all the time anyway!
🗣️: 🎉🎉🎉🎉🎉🎉
🐱: We hug all the time.
🦁: Are you just telling us, or are you actually showing off right now?
🦁: Well, however it happened, it is official now, and the whole timeline from backstage to the stage lights is already out there for everyone to piece together.
🐱: I am just sharing, in case you two do not believe me about any of this.
🐶: นี่มันครบเซ็ตจริง ๆ นะ เก็บภาพได้ครบทุกมุมเลย

* They had not said anything out loud yet at that point, but everyone backstage already felt like the whole story was ครบ, meaning complete, long before it was ever confirmed to the public.

** The "(something), come and hug me!" line is a running joke that started earlier this year and the fans never let it go.`;

function buildLong() {
  const createdAtIso = '2026-10-18T10:15:00.000Z';
  const quoted = buildTweet({
    id: IDS.LONG_QUOTED,
    author: AUTHORS.alpha,
    text: 'SOLLUNA AT STARFEST - full clip incoming soon, stay tuned everyone.',
    createdAtIso: '2026-10-17T09:00:00.000Z',
    hashtags: ['SolLunaStarfest'],
  });

  const cutAt = LONG_FULL_TEXT.indexOf('that so fast.') + 'that so'.length;
  const noteText = LONG_FULL_TEXT.slice(0, cutAt);

  const pair = buildTweet({
    id: IDS.LONG,
    author: AUTHORS.alpha,
    text: LONG_FULL_TEXT,
    noteText,
    createdAtIso,
    hashtags: ['SolLunaStarfest'],
    mediaDetails: [videoMediaDetail({ id: `${IDS.LONG}v`, width: 1080, height: 1920, durationMs: 42000, badHost: true })],
    quoted,
  });
  write(DIR, IDS.LONG, pair);
  // the quoted teaser on its own, so a test can archive it before LONG (follows-on)
  write(DIR, IDS.LONG_QUOTED, quoted);
}

function buildEventA() {
  const text = `SOLLUNA HAPPY DAY
#SLHappyDay2026 #fanclip

☀️: Thank you everyone for coming out and celebrating with us today, it really made our whole week.
🌙: Same here, honestly, let's do this again soon.
☀️: Definitely, we already have a few ideas for the next one.`;

  const pair = buildTweet({
    id: IDS.EVENT_A,
    author: AUTHORS.beta,
    text,
    createdAtIso: '2026-10-19T08:00:00.000Z',
    hashtags: ['SLHappyDay2026'],
    mediaDetails: [videoMediaDetail({ id: `${IDS.EVENT_A}v`, width: 1280, height: 720, durationMs: 15000 })],
    clipExpandedUrl: 'https://x.com/clipper_one/status/1800000000000000001/video/1',
  });
  write(DIR, IDS.EVENT_A, pair);
}

function buildEventB() {
  const text = `SOLLUNA HAPPY DAY
#SLHappyDay2026 #SolLuna

☀️: Everyone, thank you so much for celebrating with us today.
☀️: Luna, I have something to tell you.
🌙: What is it?
☀️: it's always you <b>&amp;</b> me, right?
🌙: Always, no matter what.`;

  const pair = buildTweet({
    id: IDS.EVENT_B,
    author: AUTHORS.gamma,
    text,
    createdAtIso: '2026-10-19T08:05:00.000Z',
    hashtags: ['SLHappyDay2026', 'SolLuna'],
  });
  write(DIR, IDS.EVENT_B, pair);
}

function buildLive() {
  const text = `#lunamoon TikTok live [260212]

🐱: hi everyone, thank you so much for joining tonight
💬: we love you!!
🐱: love you too, let's chat for a bit`;

  const pair = buildTweet({
    id: IDS.LIVE,
    author: AUTHORS.alpha,
    text,
    createdAtIso: '2026-02-12T13:00:00.000Z',
    mediaDetails: [videoMediaDetail({ id: `${IDS.LIVE}v`, width: 720, height: 1280, durationMs: 180000 })],
  });
  write(DIR, IDS.LIVE, pair);
}

function buildShared() {
  const text = `#SolLuna #starguest

💬: welcome everyone, glad you could join tonight's segment
🪇: (shakes a maraca happily)
💬: that was so much fun, thank you all`;

  const pair = buildTweet({
    id: IDS.SHARED,
    author: AUTHORS.alpha,
    text,
    createdAtIso: '2026-03-02T15:00:00.000Z',
    hashtags: ['SolLuna'],
  });
  write(DIR, IDS.SHARED, pair);
}

function buildJointLive() {
  const text = `#solsunny #lunamoon IG live [260301]

☀️: hi everyone, thanks for tuning in
🌙: hi hi!!
☀️: we're both here today
🌙: love you all, thank you for watching`;

  const pair = buildTweet({
    id: IDS.JOINT_LIVE,
    author: AUTHORS.beta,
    text,
    createdAtIso: '2026-03-01T14:00:00.000Z',
  });
  write(DIR, IDS.JOINT_LIVE, pair);
}

function buildTomb() {
  const syn = {
    __typename: 'TweetTombstone',
    tombstone: {
      __typename: 'TextTombstone',
      text: { text: 'This Tweet was deleted by the Tweet author.', entities: [] },
    },
  };
  writeFileSync(path.join(DIR, `${IDS.TOMB}.syn.json`), `${JSON.stringify(syn, null, 1)}\n`);
}

function buildPost() {
  const quotedText = 'คิดถึงเธอทุกวันเลยช่วงนี้ ดูแลตัวเองดี ๆ นะ';
  const quoted = buildTweet({
    id: IDS.POST_QUOTED,
    author: AUTHORS.solX,
    text: quotedText,
    createdAtIso: '2026-10-19T09:00:00.000Z',
    lang: 'th',
    mediaDetails: [photoMediaDetail({ id: `${IDS.POST_QUOTED}p`, width: 1200, height: 1200 })],
  });

  const text = "translation: can't stop thinking about you these past few days, take care of yourself okay?";
  const pair = buildTweet({
    id: IDS.POST,
    author: AUTHORS.beta,
    text,
    createdAtIso: '2026-10-19T09:10:00.000Z',
    quoted,
  });
  write(DIR, IDS.POST, pair);
}

function buildPhoto() {
  const text = `#solsunny

☀️: look at these two shots from earlier today
☀️: so happy with how they turned out`;

  const pair = buildTweet({
    id: IDS.PHOTO,
    author: AUTHORS.alpha,
    text,
    createdAtIso: '2026-10-20T10:00:00.000Z',
    hashtags: ['solsunny'],
    mediaDetails: [
      photoMediaDetail({ id: `${IDS.PHOTO}p1`, width: 1080, height: 1350 }),
      photoMediaDetail({ id: `${IDS.PHOTO}p2`, width: 1080, height: 1350 }),
      photoMediaDetail({ id: `${IDS.PHOTO}p3`, width: 800, height: 800, badHost: true }),
    ],
  });
  write(DIR, IDS.PHOTO, pair);
}

/**
 * @param {{handle: string, id: string}} author
 * @param {string|null} replyToId
 */
function threadItem(author, replyToId) {
  return replyToId ? { screen_name: author.handle, status: replyToId } : null;
}

function buildThread() {
  const text = `🌙: here's tonight's gift set, more photos and details coming in the next post
🌙: can't wait for everyone to see the whole thing`;

  const pair = buildTweet({ id: IDS.THREAD, author: AUTHORS.beta, text, createdAtIso: '2026-10-20T11:00:00.000Z' });
  write(DIR, IDS.THREAD, pair);

  const items = [
    { id: IDS.THREAD, text, author: AUTHORS.beta, iso: '2026-10-20T11:00:00.000Z', replyTo: null },
    {
      id: IDS.THREAD_FOLLOWUP,
      text: 'The list in the pic: lavender tea, honey cookies, paper lanterns, and a handwritten note.',
      author: AUTHORS.beta,
      iso: '2026-10-20T11:05:00.000Z',
      replyTo: IDS.THREAD,
    },
    {
      id: IDS.THREAD_OTHER,
      text: 'omg this is so cute',
      author: AUTHORS.gamma,
      iso: '2026-10-20T11:10:00.000Z',
      replyTo: IDS.THREAD_FOLLOWUP,
    },
  ];
  const thread = items.map((item) => ({
    id: item.id,
    text: item.text,
    author: { screen_name: item.author.handle, id: item.author.id },
    created_at: twitterDate(item.iso),
    replying_to: threadItem(item.author, item.replyTo),
  }));
  const threadData = {
    status: thread[0],
    thread,
    author: { screen_name: AUTHORS.beta.handle, id: AUTHORS.beta.id },
    code: 200,
  };
  writeFileSync(path.join(DIR, `${IDS.THREAD}.thread.json`), `${JSON.stringify(threadData, null, 1)}\n`);

  // the follow-up's own post, which intake reads its text from (the same path refreshEdits uses)
  const followUp = items[1];
  write(DIR, IDS.THREAD_FOLLOWUP, buildTweet({
    id: followUp.id, author: AUTHORS.beta, text: followUp.text, createdAtIso: followUp.iso,
    replyTo: { screen_name: AUTHORS.beta.handle, status: IDS.THREAD },
  }));
}

/**
 * Replies posted on their own after `THREAD` was archived: a new
 * same-author one (`THREAD_REPLY`, to the follow-up) and one by another
 * account (`THREAD_OTHER`). Neither is in `THREAD`'s thread file.
 */
function buildReplies() {
  const reply = buildTweet({
    id: IDS.THREAD_REPLY,
    author: AUTHORS.beta,
    text: 'One more: the lanterns were handmade too, which is why they took so long.',
    createdAtIso: '2026-10-20T12:00:00.000Z',
    replyTo: { screen_name: AUTHORS.beta.handle, status: IDS.THREAD_FOLLOWUP },
  });
  write(DIR, IDS.THREAD_REPLY, reply);

  const other = buildTweet({
    id: IDS.THREAD_OTHER,
    author: AUTHORS.gamma,
    text: 'omg this is so cute',
    createdAtIso: '2026-10-20T11:10:00.000Z',
    replyTo: { screen_name: AUTHORS.beta.handle, status: IDS.THREAD_FOLLOWUP },
  });
  write(DIR, IDS.THREAD_OTHER, other);
}

function buildEdited() {
  const editControl = {
    edit_tweet_ids: [IDS.EDITED_OLD, IDS.EDITED_NEW],
    editable_until_msecs: String(new Date('2026-10-14T00:00:00.000Z').getTime()),
    edits_remaining: '4',
    is_edit_eligible: false,
  };

  const oldPair = buildTweet({
    id: IDS.EDITED_OLD,
    author: AUTHORS.beta,
    text: "☀️: can't wait to see everyone at the fanmeet this weekend.",
    createdAtIso: '2026-10-13T12:00:00.000Z',
    editControl,
    isStaleEdit: true,
  });
  write(DIR, IDS.EDITED_OLD, oldPair);

  const newPair = buildTweet({
    id: IDS.EDITED_NEW,
    author: AUTHORS.beta,
    text: "☀️: can't wait to see everyone at the fanmeet next weekend.",
    createdAtIso: '2026-10-13T12:00:00.000Z',
    editControl,
    isStaleEdit: false,
  });
  write(DIR, IDS.EDITED_NEW, newPair);
}

export const IDS = {
  LONG: '1900000000000000001',
  LONG_QUOTED: '1900000000000000000',
  EVENT_A: '1900000000000000002',
  EVENT_B: '1900000000000000003',
  LIVE: '1900000000000000004',
  SHARED: '1900000000000000005',
  TOMB: '1900000000000000006',
  JOINT_LIVE: '1900000000000000007',
  POST: '1900000000000000008',
  POST_QUOTED: '1900000000000000010',
  PHOTO: '1900000000000000009',
  THREAD: '1900000000000000011',
  THREAD_FOLLOWUP: '1900000000000000012',
  THREAD_OTHER: '1900000000000000013',
  THREAD_REPLY: '1900000000000000014',
  EDITED_OLD: '1900000000000000015',
  EDITED_NEW: '1900000000000000016',
};

export function build() {
  buildLong();
  buildEventA();
  buildEventB();
  buildLive();
  buildShared();
  buildTomb();
  buildJointLive();
  buildPost();
  buildPhoto();
  buildThread();
  buildReplies();
  buildEdited();
}

// Only regenerate the committed fixtures when run directly; importing this
// module for `IDS` (e.g. from test/helpers/fixtures.js) must not write.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) build();
