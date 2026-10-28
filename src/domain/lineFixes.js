// @ts-check
/**
 * Line-level speaker fixes (Plan 2a Task 7). Stored beside the verbatim
 * text (never in it), these override what the marker map would say for one
 * part and line, or force a line to read as plain. Pure: this is the one
 * place the fixes are applied when lines are read, so bubbles, cast,
 * "who's in it" and search all see the same corrected view.
 */
import { splitLines } from './lines.js';
import { BadRequest } from './errors.js';

/** @typedef {import('./lines.js').Line} Line */
/** @typedef {import('./speakers.js').Speaker} Speaker */
/** @typedef {import('./speakers.js').SpeakerMap} SpeakerMap */
/** @typedef {import('./lines.js').Marker} Marker */
/**
 * @typedef {{ part: number, line: number, as: 'plain' }
 *   | { part: number, line: number, as: 'speech', speaker: Speaker }} LineFix
 *   `line` indexes a part's **non-blank** lines (how `splitLines` counts them).
 * @typedef {Line & { part: number, line: number, fixed?: Speaker }} FixedLine
 */

/**
 * @param {string[]} parts
 * @param {LineFix[]} fixes
 * @returns {Map<string, LineFix>} keyed by `${part}:${line}`
 */
function fixMap(parts, fixes) {
  /** @type {Map<string, LineFix>} */
  const map = new Map();
  for (const fix of fixes) {
    if (fix.part < 0 || fix.part >= parts.length) continue;
    const lines = splitLines(parts[fix.part]);
    if (fix.line < 0 || fix.line >= lines.length) continue;
    map.set(`${fix.part}:${fix.line}`, fix);
  }
  return map;
}

/**
 * `parts` expanded to its classified lines, each tagged with its part and
 * non-blank line index, and a `fixed` speaker where a line fix applies. A
 * plain fix forces the line back to the raw text (its stored body stays
 * untouched); a speech fix gives the line the chosen speaker, keeping the
 * parser's marker and text when it found one, else a bare speech line.
 * @param {string[]} parts
 * @param {LineFix[]} fixes
 * @returns {FixedLine[]}
 */
export function partLines(parts, fixes) {
  const fixesBy = fixMap(parts, fixes);
  /** @type {FixedLine[]} */
  const out = [];
  for (let part = 0; part < parts.length; part += 1) {
    const rawLines = parts[part].split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    const lines = splitLines(parts[part]);
    lines.forEach((line, index) => {
      const fix = fixesBy.get(`${part}:${index}`);
      if (!fix) {
        out.push({ ...line, part, line: index });
        return;
      }
      if (fix.as === 'plain') {
        out.push({ kind: 'plain', text: rawLines[index], part, line: index });
        return;
      }
      out.push({ ...line, part, line: index, fixed: fix.speaker });
    });
  }
  return out;
}

/**
 * The markers still unmapped after line fixes: a fixed line never counts,
 * whatever its marker. `map` is the item's marker-level speaker map.
 * @param {string[]} parts
 * @param {LineFix[]} fixes
 * @param {SpeakerMap} map
 * @returns {Marker[]}
 */
export function unmappedMarkers(parts, fixes, map) {
  const fixedKeys = new Set(fixMap(parts, fixes).keys());
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const line of partLines(parts, fixes)) {
    if (fixedKeys.has(`${line.part}:${line.line}`)) continue;
    if (line.kind !== 'speech') continue;
    for (const marker of line.markers) {
      if (Object.hasOwn(map, marker)) continue;
      counts.set(marker, (counts.get(marker) ?? 0) + 1);
    }
  }
  return [...counts.entries()].map(([marker, count]) => ({ marker, count }));
}

/**
 * Rejects a set of fixes that can't apply to these parts: an out-of-range
 * part or line, a duplicate `(part, line)`, or a speech fix with no
 * speaker. Throws `BadRequest`.
 * @param {string[]} parts
 * @param {LineFix[]} fixes
 * @returns {void}
 */
export function validateFixes(parts, fixes) {
  const seen = new Set();
  for (const fix of fixes) {
    if (fix.part < 0 || fix.part >= parts.length) throw new BadRequest('line fix part out of range');
    const lineCount = splitLines(parts[fix.part]).length;
    if (fix.line < 0 || fix.line >= lineCount) throw new BadRequest('line fix line out of range');
    const key = `${fix.part}:${fix.line}`;
    if (seen.has(key)) throw new BadRequest('duplicate line fix');
    seen.add(key);
    if (fix.as === 'speech' && !fix.speaker) throw new BadRequest('speech fix needs a speaker');
  }
}
