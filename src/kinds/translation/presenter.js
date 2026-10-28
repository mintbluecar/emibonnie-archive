// @ts-check
/**
 * The translation kind's view models (src/http/contracts.js): bubbles with
 * every name, standard emoji, colour and continuation resolved here, the
 * cast, credits and the pinned media. Text stays raw; the page escapes it.
 */
import { BARE_MARKER } from '../../domain/lines.js';
import { parseHeader } from '../../domain/header.js';
import { LIVE_PATTERNS, ROLE_EMOJI } from '../../domain/constants.js';
import { resolveMedia, hasVideo, thumbOf, clipByOf, publicSources } from './media.js';
import { profileUrl } from './profile.js';
import { partLines } from '../../domain/lineFixes.js';

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
 * The emoji a marker shows as itself (a role's, or an unmapped marker's):
 * the marker, except the bare-colon marker, which has none -- its bubble
 * gets a blank neutral avatar (fix round 2).
 * @param {string} marker @returns {string}
 */
function ownEmojiOf(marker) {
  return marker === BARE_MARKER ? '' : marker;
}

/**
 * A generic role's emoji: the translator's own (the marker), or -- only
 * when they used none -- the role's default (`ROLE_EMOJI`, or the site's
 * `roleEmoji` via `ctx.roleEmoji`); '' for a role with no default (crowd).
 * @param {string} marker @param {string} role @param {PresentContext} ctx
 * @returns {string}
 */
function roleEmojiOf(marker, role, ctx) {
  const defaults = /** @type {Record<string, string|undefined>} */ (ctx.roleEmoji ?? ROLE_EMOJI);
  return ownEmojiOf(marker) || (defaults[role] ?? '');
}

/**
 * The one speaker resolver every display path uses (bubbles, joint
 * parts, search match lines): a known person's standard emoji and
 * name, a generic role's emoji (`roleEmojiOf`) and role name, or (never
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
  if (speaker && 'role' in speaker) return { emoji: roleEmojiOf(marker, speaker.role, ctx), name: speaker.role, person: undefined };
  return { emoji: ownEmojiOf(marker), name: null, person: undefined };
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
 * A line with a line-level `fixed` speaker: resolved from `fixed`, not the
 * marker map, and shown as speech (crowd stays the neutral crowd bubble).
 * @param {Extract<Line, { kind: 'speech' }> & { fixed: any }} line
 * @param {PresentContext} ctx
 * @returns {KeyedBubble}
 */
function fixedBubble(line, ctx) {
  const view = fixedSpeakerOf(line.fixed, line.marker, ctx);
  if ('role' in line.fixed && line.fixed.role === 'crowd') return { kind: 'crowd', text: line.text };
  const person = 'person' in line.fixed ? ctx.people.get(line.fixed.person) : undefined;
  if (person) {
    return { kind: 'speech', key: `p:${person.id}`, emoji: person.emoji, name: ctx.formatName(person.displayName), colour: person.colour, text: line.text, cont: false };
  }
  return { kind: 'speech', key: `m:${line.marker}`, emoji: view.emoji, name: view.name, text: line.text, cont: false };
}

/**
 * A fixed `Speaker`'s display emoji and name (for search match lines and
 * the cast, where no identity colour is needed).
 * @param {import('../../domain/speakers.js').Speaker} speaker
 * @param {string} marker
 * @param {PresentContext} ctx
 * @returns {{ emoji: string, name: string|null }}
 */
export function fixedSpeakerOf(speaker, marker, ctx) {
  if ('person' in speaker) {
    const person = ctx.people.get(speaker.person);
    return person ? { emoji: person.emoji, name: ctx.formatName(person.displayName) } : { emoji: ownEmojiOf(marker), name: null };
  }
  return { emoji: roleEmojiOf(marker, speaker.role, ctx), name: speaker.role };
}

/**
 * Every line of every part as a bubble, with line-level fixes applied
 * (a fixed line resolves its speaker from the fix, not the marker map).
 * @param {TranslationDetails} details
 * @param {PresentContext} ctx
 */
function keyedBubbles(details, ctx) {
  const parts = details.parts ?? [details.body];
  return partLines(parts, details.fixes ?? []).map((line) => {
    if (line.fixed) return fixedBubble(/** @type {any} */ (line), ctx);
    return bubbleOf(line, details.speakers, ctx);
  });
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
  const media = resolveMedia(sources);
  return {
    kind: KIND, sourceId, url: ctx.urlFor(KIND, sourceId), lines: previewLines(details, ctx), people: ctx.chips(card.people),
    accountHandle: card.account?.handle ?? null, accountUrl: card.account ? profileUrl(card.account.handle) : null,
    hasVideo: hasVideo(media), thumb: thumbOf(media),
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
  if ('role' in speaker && speaker.role !== 'crowd') return [`m:${marker}`, { kind: 'role', role: speaker.role, emoji: roleEmojiOf(marker, speaker.role, ctx), name: speaker.role }];
  return null;
}

/** @param {import('../../domain/speakers.js').Speaker} speaker @param {any} line @param {PresentContext} ctx @returns {[string, CastVM] | null} */
function fixedCastEntry(speaker, line, ctx) {
  if ('person' in speaker) {
    const person = ctx.people.get(speaker.person);
    if (!person) return null;
    return [`p:${person.id}`, { kind: 'person', id: person.id, emoji: person.emoji, name: ctx.formatName(person.displayName), colour: person.colour, igHandle: person.igHandle }];
  }
  if (speaker.role === 'crowd') return null;
  return [`m:${line.marker}`, { kind: 'role', role: speaker.role, emoji: roleEmojiOf(line.marker, speaker.role, ctx), name: speaker.role }];
}

/**
 * The people and generic roles who speak, in order of first line. A
 * joint line's components count as speaking too, each on its own
 * (review round 1, M5): a component that only ever speaks inside a
 * joint line still appears here, deduped the same way a repeated solo
 * speaker is. A line-level fix contributes its fixed speaker.
 * @param {TranslationDetails} details
 * @param {PresentContext} ctx
 * @returns {CastVM[]}
 */
function castOf(details, ctx) {
  /** @type {Map<string, CastVM>} */
  const cast = new Map();
  const add = (/** @type {[string, CastVM] | null} */ entry) => {
    if (entry && !cast.has(entry[0])) cast.set(entry[0], entry[1]);
  };
  for (const entry of partLines(details.parts ?? [details.body], details.fixes ?? [])) {
    const line = /** @type {any} */ (entry);
    if (line.fixed) {
      add(fixedCastEntry(line.fixed, line, ctx));
      continue;
    }
    if (line.kind !== 'speech') continue;
    for (const marker of line.markers) {
      if (!Object.hasOwn(details.speakers, marker)) continue;
      add(castEntryOf(marker, details.speakers[marker], ctx));
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
  const account = card.account ? { ...card.account, url: profileUrl(card.account.handle) } : null;
  return {
    bubbles: bubblesOf(details, ctx),
    cast: castOf(details, ctx),
    original: details.body,
    credits: { account, clipBy: clipByOf(sources, handle), occurredOn: card.occurredOn },
    sources: sources.map((s) => ({ role: /** @type {string} */ (s.role), url: /** @type {string} */ (s.url), status: /** @type {any} */ (s.status) })),
    media: resolveMedia(sources),
  };
}

export const present = { preview, detail };
