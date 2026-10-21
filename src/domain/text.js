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
