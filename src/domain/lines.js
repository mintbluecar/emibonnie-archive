// @ts-check

/**
 * @typedef {{kind: 'speech', marker: string, text: string}} SpeechLine
 * @typedef {{kind: 'plain', text: string}} PlainLine
 * @typedef {{kind: 'footnote', mark: '*'|'**', text: string}} FootnoteLine
 * @typedef {SpeechLine|PlainLine|FootnoteLine} Line
 * @typedef {{marker: string, count: number}} Marker
 */

const MARKER_WINDOW = 12;
const LABEL_MARKER = /^[A-Za-z0-9]{1,3}$/;
const FOOTNOTE_PREFIX = /^(\*{1,2})\s(.*)$/;

/** @param {string} candidate */
function isEmojiMarker(candidate) {
  const graphemes = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(candidate)];
  return graphemes.length === 1 && /\p{Extended_Pictographic}/u.test(graphemes[0].segment);
}

/** @param {string} candidate */
function isMarker(candidate) {
  return candidate.length > 0 && (isEmojiMarker(candidate) || LABEL_MARKER.test(candidate));
}

/**
 * The marker text immediately before a line's first `:`, if one is found
 * within `MARKER_WINDOW` characters of it and is a whole emoji grapheme
 * cluster or a short (1-3 character) label. `null` otherwise.
 * @param {string} line
 * @param {number} colonIndex
 */
function markerBefore(line, colonIndex) {
  const start = Math.max(0, colonIndex - MARKER_WINDOW);
  const candidate = line.slice(start, colonIndex).trim();
  return isMarker(candidate) ? candidate : null;
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
  if (line.startsWith(':')) return { kind: 'plain', text: line };

  const footnote = footnoteOf(line);
  if (footnote) return footnote;

  const colonIndex = line.indexOf(':');
  const marker = colonIndex > 0 ? markerBefore(line, colonIndex) : null;
  if (marker) return { kind: 'speech', marker, text: line.slice(colonIndex + 1).trim() };

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
 * Tallies the distinct speech markers used in `lines`, in order of first
 * appearance.
 * @param {Line[]} lines
 * @returns {Marker[]}
 */
export function findMarkers(lines) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const line of lines) {
    if (line.kind !== 'speech') continue;
    counts.set(line.marker, (counts.get(line.marker) ?? 0) + 1);
  }
  return [...counts.entries()].map(([marker, count]) => ({ marker, count }));
}
