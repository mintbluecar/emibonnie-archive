// @ts-check
/**
 * The translation kind's view models (src/http/contracts.js): bubbles with
 * every name, standard emoji, colour and continuation resolved here, the
 * cast, credits and the pinned media. Text stays raw; the page escapes it.
 */
import { splitLines } from '../../domain/lines.js';
import { parseHeader } from '../../domain/header.js';
import { LIVE_PATTERNS } from '../../domain/constants.js';
import { resolveMedia, hasVideo, clipByOf, publicSources } from './media.js';

/** @typedef {import('../../http/contracts.js').BubbleVM} BubbleVM */
/** @typedef {import('../../http/contracts.js').CastVM} CastVM */
/** @typedef {import('../../http/contracts.js').KindPreview} KindPreview */
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
 * The one speaker resolver every display path uses (bubbles, joint
 * parts, search match lines): a known person's standard emoji and
 * name, a generic role's translator emoji and role name, or (never
 * mapped) the marker itself with `name: null`. `person` is the known
 * person, if any, for callers that need their id or colour.
 * @param {string} marker
 * @param {SpeakerMap} speakers
 * @param {PresentContext} ctx
 * @returns {{ emoji: string, name: string|null, person: any }}
 */
function speakerOf(marker, speakers, ctx) {
  const speaker = Object.hasOwn(speakers, marker) ? speakers[marker] : undefined;
  const person = speaker && 'person' in speaker ? ctx.people.get(speaker.person) : undefined;
  if (person) return { emoji: person.emoji, name: ctx.formatName(person.displayName), person };
  const name = speaker && 'role' in speaker ? speaker.role : null;
  return { emoji: marker, name, person: undefined };
}

/**
 * One marker's display emoji and name (`speakerOf`, without the person):
 * a joint-bubble component, or a search match line's speaker. Crowd stays
 * a named role here, rather than becoming a `kind: 'crowd'` bubble.
 * @param {string} marker
 * @param {SpeakerMap} speakers
 * @param {PresentContext} ctx
 * @returns {{emoji: string, name: string|null}}
 */
export function componentOf(marker, speakers, ctx) {
  const { emoji, name } = speakerOf(marker, speakers, ctx);
  return { emoji, name };
}

/**
 * @param {string} marker
 * @param {string} text
 * @param {SpeakerMap} speakers
 * @param {PresentContext} ctx
 * @returns {KeyedBubble}
 */
function soloBubble(marker, text, speakers, ctx) {
  const speaker = Object.hasOwn(speakers, marker) ? speakers[marker] : undefined;
  if (speaker && 'role' in speaker && speaker.role === 'crowd') return { kind: 'crowd', text };
  const { emoji, name, person } = speakerOf(marker, speakers, ctx);
  if (person) return { kind: 'speech', key: `p:${person.id}`, emoji, name, colour: person.colour, text, cont: false };
  return { kind: 'speech', key: `m:${marker}`, emoji, name, text, cont: false };
}

/**
 * A joint line (2+ markers run together): one neutral bubble (no person
 * colour), its components resolved in line order.
 * @param {Extract<Line, { kind: 'speech' }>} line
 * @param {SpeakerMap} speakers
 * @param {PresentContext} ctx
 * @returns {KeyedBubble}
 */
function jointBubble(line, speakers, ctx) {
  const parts = line.markers.map((marker) => componentOf(marker, speakers, ctx));
  return { kind: 'joint', key: `j:${line.markers.join('|')}`, parts, text: line.text, cont: false };
}

/**
 * @param {Extract<Line, { kind: 'speech' }>} line
 * @param {SpeakerMap} speakers
 * @param {PresentContext} ctx
 * @returns {KeyedBubble}
 */
function speechBubble(line, speakers, ctx) {
  return line.markers.length > 1 ? jointBubble(line, speakers, ctx) : soloBubble(line.marker, line.text, speakers, ctx);
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
 * Sets `cont` from the bubble before, and drops the speaker keys. A
 * joint bubble's key is the whole joint (its markers, in order), so
 * consecutive identical joint lines collapse the same way a repeated
 * single speaker does.
 * @param {KeyedBubble[]} bubbles
 * @returns {BubbleVM[]}
 */
function withContinuation(bubbles) {
  return bubbles.map((bubble, i) => {
    if (bubble.kind !== 'speech' && bubble.kind !== 'joint') return bubble;
    const { key, ...rest } = bubble;
    const before = bubbles[i - 1];
    const keyed = before?.kind === 'speech' || before?.kind === 'joint';
    return { ...rest, cont: keyed && before.key === key };
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
 * The first 2 spoken bubbles (speech or joint), else the first 2 plain
 * lines outside the header (no hashtag, not the keyword or live line).
 * Review round 1, I2: a joint line is a spoken line too.
 * @param {TranslationDetails} details
 * @param {PresentContext} ctx
 */
function previewLines(details, ctx) {
  const all = keyedBubbles(details, ctx);
  const speech = all.filter((b) => b.kind === 'speech' || b.kind === 'joint');
  if (speech.length > 0) return withContinuation(speech.slice(0, PREVIEW_LINES));
  const context = new Set((parseHeader(details.body, { livePatterns: LIVE_PATTERNS }).context ?? '').split('\n'));
  return withContinuation(all.filter((b) => b.kind === 'plain' && context.has(b.text)).slice(0, PREVIEW_LINES));
}

/**
 * @param {Card} card
 * @param {TranslationDetails} details
 * @param {PresentContext} ctx
 * @returns {KindPreview}
 */
function preview(card, details, ctx) {
  const sources = publicSources(details.sources);
  const sourceId = card.sourceId;
  const followsOn = card.followsOn;
  return {
    kind: KIND, sourceId, url: ctx.urlFor(KIND, sourceId), lines: previewLines(details, ctx), people: ctx.chips(card.people),
    accountHandle: card.account?.handle ?? null, hasVideo: hasVideo(resolveMedia(sources)),
    followsOnFrom: followsOn ? { sourceId: followsOn.sourceId, url: ctx.urlFor(followsOn.kind, followsOn.sourceId) } : null,
  };
}

/**
 * `marker`'s cast entry (a person, or a non-crowd role), keyed for
 * dedupe; `null` for crowd or an unmapped marker.
 * @param {string} marker
 * @param {SpeakerMap[string]} speaker
 * @param {PresentContext} ctx
 * @returns {[string, CastVM]|null}
 */
function castEntryOf(marker, speaker, ctx) {
  const person = 'person' in speaker ? ctx.people.get(speaker.person) : undefined;
  if (person) {
    const name = ctx.formatName(person.displayName);
    return [`p:${person.id}`, { kind: 'person', id: person.id, emoji: person.emoji, name, colour: person.colour, igHandle: person.igHandle }];
  }
  if ('role' in speaker && speaker.role !== 'crowd') return [`m:${marker}`, { kind: 'role', role: speaker.role, emoji: marker, name: speaker.role }];
  return null;
}

/**
 * The people and generic roles who speak, in order of first line. A
 * joint line's components count as speaking too, each on its own
 * (review round 1, M5): a component that only ever speaks inside a
 * joint line still appears here, deduped the same way a repeated solo
 * speaker is.
 * @param {TranslationDetails} details
 * @param {PresentContext} ctx
 * @returns {CastVM[]}
 */
function castOf(details, ctx) {
  /** @type {Map<string, CastVM>} */
  const cast = new Map();
  for (const line of splitLines(details.body)) {
    if (line.kind !== 'speech') continue;
    for (const marker of line.markers) {
      if (!Object.hasOwn(details.speakers, marker)) continue;
      const entry = castEntryOf(marker, details.speakers[marker], ctx);
      if (entry && !cast.has(entry[0])) cast.set(entry[0], entry[1]);
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
  const sources = publicSources(details.sources);
  return {
    bubbles: bubblesOf(details, ctx),
    cast: castOf(details, ctx),
    original: details.body,
    credits: { account: card.account, clipBy: clipByOf(sources, handle), postedAt: card.postedAt, occurredOn: card.occurredOn },
    sources: sources.map((s) => ({ role: /** @type {string} */ (s.role), url: /** @type {string} */ (s.url), status: /** @type {any} */ (s.status) })),
    media: resolveMedia(sources),
  };
}

export const present = { preview, detail };
