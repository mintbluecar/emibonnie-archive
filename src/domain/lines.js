// @ts-check

/**
 * @typedef {{kind: 'speech', marker: string, markers: string[], text: string}} SpeechLine
 *   `marker` is the raw prefix as written; `markers` splits it into its
 *   component single-emoji markers (length 1 for an ordinary line, 2+ for
 *   a joint line -- see `markersOf`).
 * @typedef {{kind: 'plain', text: string}} PlainLine
 * @typedef {{kind: 'footnote', mark: '*'|'**', text: string}} FootnoteLine
 * @typedef {SpeechLine|PlainLine|FootnoteLine} Line
 * @typedef {{marker: string, count: number}} Marker
 */

/** A label marker: 1-3 alphanumerics, at least one a letter (M1b: a bare number, e.g. a clock time's "10", is never a marker). */
const LABEL_MARKER = /^(?=.*[A-Za-z])[A-Za-z0-9]{1,3}$/;
const FOOTNOTE_PREFIX = /^(\*{1,2})\s(.*)$/;
/** A line's bare ':' opener and its spaces, when words follow (fix round 1, M4). */
const BARE_COLON_OPENER = /^:\s*(?=[\p{L}\p{N}])/u;
/** A joint marker is at most this many component markers (review round 1, I1). */
const MAX_JOINT_MARKERS = 4;
/** An emoji keycap sequence: digit/`#`/`*`, an optional variation selector, the combining enclosing keycap U+20E3 (Unicode UTS #51 ED-14c). */
const KEYCAP_MARKER = /^[0-9#*]️?⃣$/u;
/** An emoji flag sequence: exactly two Regional_Indicator symbols forming one grapheme cluster (Unicode UTS #51 ED-14). */
const FLAG_MARKER = /^\p{Regional_Indicator}{2}$/u;

/** @param {string} candidate */
function graphemesOf(candidate) {
  return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(candidate)].map((s) => s.segment);
}

/**
 * Whether `candidate` is one grapheme cluster that reads as an emoji: an
 * ordinary pictographic emoji (plain, skin-toned, or a ZWJ sequence --
 * `Extended_Pictographic` covers all three, since it matches on the base
 * character), an emoji flag sequence (`FLAG_MARKER`), or an emoji keycap
 * sequence (`KEYCAP_MARKER`) -- the latter two are exact, anchored
 * matches, so a lone regional indicator (not a flag) or a keycap mark on
 * a non-digit base (not a keycap) correctly fail (review round 1, M1).
 * @param {string} candidate
 */
function isEmojiMarker(candidate) {
  const graphemes = graphemesOf(candidate);
  if (graphemes.length !== 1) return false;
  const [grapheme] = graphemes;
  return /\p{Extended_Pictographic}/u.test(grapheme) || FLAG_MARKER.test(grapheme) || KEYCAP_MARKER.test(grapheme);
}

/** @param {string} candidate */
function isMarker(candidate) {
  return candidate.length > 0 && (isEmojiMarker(candidate) || LABEL_MARKER.test(candidate));
}

/**
 * A joint marker's component markers, when `candidate` is 2 to
 * `MAX_JOINT_MARKERS` graphemes and each one is, on its own, a valid
 * single-emoji marker (so a skin-toned emoji, a ZWJ sequence, a flag or
 * a keycap -- each already one grapheme -- never splits). `null`
 * otherwise (including: too many graphemes, or any non-marker one --
 * review round 1, I1).
 * @param {string} candidate
 * @returns {string[]|null}
 */
function jointMarkersOf(candidate) {
  const graphemes = graphemesOf(candidate);
  return graphemes.length >= 2 && graphemes.length <= MAX_JOINT_MARKERS && graphemes.every(isEmojiMarker) ? graphemes : null;
}

/**
 * `candidate`'s component markers: itself (length 1) when it's a single
 * marker (emoji or short label), its graphemes when it's a joint marker,
 * else `null` (not a marker at all).
 * @param {string} candidate
 * @returns {string[]|null}
 */
function markersOf(candidate) {
  return isMarker(candidate) ? [candidate] : jointMarkersOf(candidate);
}

/**
 * The marker text before a line's first `:` -- the whole prefix,
 * trimmed, not a fixed-width slice of it (review round 1, I1: slicing a
 * window could cut a longer prefix and read the leftover fragment as a
 * false joint marker, or cut a multi-codepoint single marker like a ZWJ
 * sequence mid-cluster). It's a marker when the whole prefix is a whole
 * emoji grapheme cluster, a short (1-3 character, at least one letter)
 * label, or 2 to `MAX_JOINT_MARKERS` such emoji run together (a joint
 * marker). `null` otherwise.
 * @param {string} line
 * @param {number} colonIndex
 * @returns {{marker: string, markers: string[]}|null}
 */
function markerBefore(line, colonIndex) {
  const candidate = line.slice(0, colonIndex).trim();
  const markers = markersOf(candidate);
  return markers ? { marker: candidate, markers } : null;
}

/** @param {string} line */
function footnoteOf(line) {
  const match = FOOTNOTE_PREFIX.exec(line);
  return match ? { kind: /** @type {const} */ ('footnote'), mark: /** @type {'*'|'**'} */ (match[1]), text: match[2] } : null;
}

/**
 * Classifies one non-blank line of header or speech text.
 * @param {string} raw
 * @returns {Line}
 */
function classifyLine(raw) {
  const line = raw.trim();
  // A bare ':' opening a line: a speaker the translator left unmarked
  // (e.g. alternating with a marked one). It stays plain -- there's no
  // marker to map -- but without the ': ' separator, as a speech line
  // drops its own (fix round 1, M4).
  // Only before a letter or digit, so an emoticon like ':)' stays as written.
  if (line.startsWith(':')) return { kind: 'plain', text: BARE_COLON_OPENER.test(line) ? line.replace(BARE_COLON_OPENER, '') : line };

  const footnote = footnoteOf(line);
  if (footnote) return footnote;

  const colonIndex = line.indexOf(':');
  const found = colonIndex > 0 ? markerBefore(line, colonIndex) : null;
  if (found) return { kind: 'speech', marker: found.marker, markers: found.markers, text: line.slice(colonIndex + 1).trim() };

  return { kind: 'plain', text: line };
}

/**
 * Whether a raw text line reads as a speech line (a marker directly
 * before its first `:`), without producing a full `Line`.
 * @param {string} line
 * @returns {boolean}
 */
export function isSpeechLine(line) {
  return line.trim().length > 0 && classifyLine(line).kind === 'speech';
}

/**
 * Splits free text into classified lines, skipping blank ones.
 * @param {string} text
 * @returns {Line[]}
 */
export function splitLines(text) {
  return text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map(classifyLine);
}

/**
 * Tallies the distinct component speech markers used in `lines`, in order
 * of first appearance. A joint line counts each of its components, never
 * the joint string itself.
 * @param {Line[]} lines
 * @returns {Marker[]}
 */
export function findMarkers(lines) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const line of lines) {
    if (line.kind !== 'speech') continue;
    for (const marker of line.markers) counts.set(marker, (counts.get(marker) ?? 0) + 1);
  }
  return [...counts.entries()].map(([marker, count]) => ({ marker, count }));
}
