// @ts-check
/**
 * `cleanDisplayName`: normalise and validate the public display name a
 * Google user picks. The name is shown publicly, so it must never look
 * like an X handle (a leading `@`) or carry invisible/bidi characters that
 * could imitate one. Pure.
 */

import { withoutInvisible } from './text.js';

/** Name length bounds (characters after cleaning). */
const MAX = 30;

/**
 * @param {string} raw
 * @returns {{ ok: true, name: string } | { ok: false, reason: 'empty'|'too_long'|'looks_like_handle' }}
 */
export function cleanDisplayName(raw) {
  // NFKC and no invisible characters (see domain/text.js), then also drop
  // control characters, collapse whitespace and trim.
  const cleaned = withoutInvisible(raw)
    .replace(/\p{Cc}/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  if (cleaned === '') return { ok: false, reason: 'empty' };
  if (cleaned.startsWith('@')) return { ok: false, reason: 'looks_like_handle' };
  if (cleaned.length > MAX) return { ok: false, reason: 'too_long' };
  return { ok: true, name: cleaned };
}
