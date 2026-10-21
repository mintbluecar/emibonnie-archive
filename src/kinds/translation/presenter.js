// @ts-check
/**
 * The translation kind's view models (src/http/contracts.js): bubbles with
 * every name, standard emoji, colour and continuation resolved here, the
 * cast, credits and the pinned media. Text stays raw; the page escapes it.
 */
import { splitLines } from '../../domain/lines.js';
import { parseHeader } from '../../domain/header.js';
import { LIVE_PATTERNS } from '../../domain/constants.js';
import { resolveMedia, hasVideo, clipByOf } from './media.js';

/** @typedef {import('../../http/contracts.js').BubbleVM} BubbleVM */
/** @typedef {import('../../http/contracts.js').CastVM} CastVM */
/** @typedef {import('../../http/contracts.js').Preview} Preview */
/** @typedef {import('../../http/contracts.js').DetailVM} DetailVM */
/** @typedef {import('../../http/contracts.js').PersonChip} PersonChip */
/** @typedef {import('../../domain/lines.js').Line} Line */
/** @typedef {import('../../domain/speakers.js').SpeakerMap} SpeakerMap */
/** @typedef {import('../../repo/cards.js').Card} Card */
/** @typedef {import('./repo.js').TranslationDetails} TranslationDetails */
/** @typedef {import('../defineKind.js').PresentContext} PresentContext */
/**
 * @typedef {BubbleVM & { key?: string }} KeyedBubble `key` names the speaker, for `cont`.
 */

const KIND = 'translation';
const PREVIEW_LINES = 2;

/**
 * @param {Extract<Line, { kind: 'speech' }>} line
 * @param {SpeakerMap} speakers
 * @param {PresentContext} ctx
 * @returns {KeyedBubble}
 */
function speechBubble({ marker, text }, speakers, ctx) {
  const speaker = Object.hasOwn(speakers, marker) ? speakers[marker] : undefined;
  if (speaker && 'role' in speaker && speaker.role === 'crowd') return { kind: 'crowd', text };
  const person = speaker && 'person' in speaker ? ctx.people.get(speaker.person) : undefined;
  if (person) {
    return { kind: 'speech', key: `p:${person.id}`, emoji: person.emoji, name: ctx.formatName(person.displayName), colour: person.colour, text, cont: false };
  }
  const name = speaker && 'role' in speaker ? speaker.role : null;
  return { kind: 'speech', key: `m:${marker}`, emoji: marker, name, text, cont: false };
}

/**
 * @param {Line} line
 * @param {SpeakerMap} speakers
 * @param {PresentContext} ctx
 * @returns {KeyedBubble}
 */
function bubbleOf(line, speakers, ctx) {
  if (line.kind === 'speech') return speechBubble(line, speakers, ctx);
  if (line.kind === 'footnote') return { kind: 'note', mark: line.mark, text: line.text };
  return { kind: 'plain', text: line.text };
}

/**
 * Sets `cont` from the bubble before, and drops the speaker keys.
 * @param {KeyedBubble[]} bubbles
 * @returns {BubbleVM[]}
 */
function withContinuation(bubbles) {
  return bubbles.map((bubble, i) => {
    if (bubble.kind !== 'speech') return bubble;
    const { key, ...rest } = bubble;
    const before = bubbles[i - 1];
    return { ...rest, cont: before?.kind === 'speech' && before.key === key };
  });
}

/** @param {TranslationDetails} details @param {PresentContext} ctx */
function keyedBubbles(details, ctx) {
  return splitLines(details.body).map((line) => bubbleOf(line, details.speakers, ctx));
}

/** Every line as a bubble; footnotes moved to the end. @param {TranslationDetails} details @param {PresentContext} ctx */
export function bubblesOf(details, ctx) {
  const all = keyedBubbles(details, ctx);
  return withContinuation([...all.filter((b) => b.kind !== 'note'), ...all.filter((b) => b.kind === 'note')]);
}

/**
 * The first 2 speech bubbles, else the first 2 plain lines outside the
 * header (no hashtag, not the keyword or live line).
 * @param {TranslationDetails} details
 * @param {PresentContext} ctx
 */
function previewLines(details, ctx) {
  const all = keyedBubbles(details, ctx);
  const speech = all.filter((b) => b.kind === 'speech');
  if (speech.length > 0) return withContinuation(speech.slice(0, PREVIEW_LINES));
  const context = new Set((parseHeader(details.body, { livePatterns: LIVE_PATTERNS }).context ?? '').split('\n'));
  return withContinuation(all.filter((b) => b.kind === 'plain' && context.has(b.text)).slice(0, PREVIEW_LINES));
}

/**
 * @param {Card} card
 * @param {TranslationDetails} details
 * @param {PresentContext} ctx
 * @returns {Preview}
 */
function preview(card, details, ctx) {
  const sourceId = card.sourceId;
  const followsOn = card.followsOn;
  return {
    kind: KIND, sourceId, url: ctx.urlFor(KIND, sourceId), lines: previewLines(details, ctx), people: ctx.chips(card.people),
    accountHandle: card.account?.handle ?? null, hasVideo: hasVideo(resolveMedia(details.sources)),
    followsOnFrom: followsOn ? { sourceId: followsOn.sourceId, url: ctx.urlFor(followsOn.kind, followsOn.sourceId) } : null,
  };
}

/**
 * The people and generic roles who speak, in order of first line.
 * @param {TranslationDetails} details
 * @param {PresentContext} ctx
 * @returns {CastVM[]}
 */
function castOf(details, ctx) {
  /** @type {Map<string, CastVM>} */
  const cast = new Map();
  for (const line of splitLines(details.body)) {
    if (line.kind !== 'speech' || !Object.hasOwn(details.speakers, line.marker)) continue;
    const speaker = details.speakers[line.marker];
    const person = 'person' in speaker ? ctx.people.get(speaker.person) : undefined;
    if (person && !cast.has(`p:${person.id}`)) {
      const name = ctx.formatName(person.displayName);
      cast.set(`p:${person.id}`, { kind: 'person', id: person.id, emoji: person.emoji, name, colour: person.colour, igHandle: person.igHandle });
    } else if ('role' in speaker && speaker.role !== 'crowd' && !cast.has(`m:${line.marker}`)) {
      cast.set(`m:${line.marker}`, { kind: 'role', role: speaker.role, emoji: line.marker, name: speaker.role });
    }
  }
  return [...cast.values()];
}

/**
 * @param {Card} card
 * @param {TranslationDetails} details
 * @param {PresentContext} ctx
 * @returns {DetailVM}
 */
function detail(card, details, ctx) {
  const handle = card.account?.handle ?? null;
  return {
    bubbles: bubblesOf(details, ctx),
    cast: castOf(details, ctx),
    original: details.body,
    credits: { account: card.account, clipBy: clipByOf(details.sources, handle), postedAt: card.postedAt, occurredOn: card.occurredOn },
    sources: details.sources.map((s) => ({ role: /** @type {string} */ (s.role), url: /** @type {string} */ (s.url), status: /** @type {any} */ (s.status) })),
    media: resolveMedia(details.sources),
  };
}

export const present = { preview, detail };
