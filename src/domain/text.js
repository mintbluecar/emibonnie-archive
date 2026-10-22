// @ts-check

/**
 * The only function that computes `tags.norm`, so a tag stored by this
 * code and a tag looked up by SQL always agree. Unicode NFC (canonical,
 * not compatibility), then lower-cased, then trimmed with internal
 * whitespace runs collapsed to one space. NFC deliberately leaves
 * compatibility variants (fullwidth, etc.) distinct from their ASCII
 * forms, unlike `cleanDisplayName`'s NFKC below: a tag is an exact key,
 * not a display string meant to fold look-alikes together.
 * @param {string} s
 * @returns {string}
 */
export function norm(s) {
  return s.normalize('NFC').toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Removes characters from directional overrides/marks and zero-width
 * joiners/spaces (Unicode category `Cf`, "Format") — the trick used to
 * make a handle look different from how it reads. NFKC first folds
 * compatibility variants (fullwidth, etc.) to their ordinary form, since
 * a display name should read the same either way.
 * @param {string} s
 * @returns {string}
 */
export function cleanDisplayName(s) {
  const cleaned = s.normalize('NFKC').replace(/\p{Cf}/gu, '').trim();
  const withoutAt = cleaned.startsWith('@') ? cleaned.slice(1) : cleaned;
  return withoutAt.trim().slice(0, 40);
}

/** How much of a long line a search result shows, in code points (about two and a half phone lines). */
const EXCERPT_MAX = 120;
/** How much of that window sits before the match. */
const EXCERPT_BEFORE = 40;
/** How far an edge may move to land on a space rather than mid-word. */
const EXCERPT_SNAP = 15;

/**
 * `start` moved forward to just after a space, if one is within reach
 * (and before `limit`), so the window opens on a whole word.
 * @param {string[]} chars @param {number} start @param {number} limit
 * @returns {number}
 */
function snapStart(chars, start, limit) {
  if (start === 0) return 0;
  for (let i = start; i < Math.min(start + EXCERPT_SNAP, limit); i += 1) if (chars[i] === ' ') return i + 1;
  return start;
}

/**
 * `end` moved back to a space, if one is within reach (and after `limit`).
 * @param {string[]} chars @param {number} end @param {number} limit
 * @returns {number}
 */
function snapEnd(chars, end, limit) {
  if (end === chars.length) return end;
  for (let i = end; i > Math.max(end - EXCERPT_SNAP, limit); i -= 1) if (chars[i] === ' ') return i;
  return end;
}

/**
 * A long line cut to a window of about `EXCERPT_MAX` code points around
 * the first case-insensitive match of `q`, opening and closing on word
 * edges where there are spaces, with "…" where text was cut (Task 9b: a
 * search result shows the matching lines, and a translator's paragraph
 * can run for several hundred characters). Counts code points, so Thai
 * (no spaces) is cut by length and an emoji is never split. A short line,
 * or one where the match isn't found as written, comes back unchanged.
 * @param {string} line @param {string} q
 * @returns {string}
 */
export function excerptAround(line, q) {
  const chars = [...line];
  if (chars.length <= EXCERPT_MAX) return line;
  const at = line.toLowerCase().indexOf(q.toLowerCase());
  if (at < 0) return line;
  const matchStart = [...line.slice(0, at)].length;
  const matchEnd = matchStart + [...q].length;
  let start = Math.max(0, Math.min(matchStart - EXCERPT_BEFORE, chars.length - EXCERPT_MAX));
  let end = Math.max(Math.min(chars.length, start + EXCERPT_MAX), matchEnd);
  start = snapStart(chars, start, matchStart);
  end = snapEnd(chars, end, matchEnd);
  const body = chars.slice(start, end).join('').trim();
  return `${start > 0 ? '…' : ''}${body}${end < chars.length ? '…' : ''}`;
}
