// @ts-check
/**
 * Event addresses: `/e/<date>/<tag>`, stored in `events.slug` as
 * `YYYY-MM-DD/<tag>`. The tag half is just a slug (`slugPart`), so this
 * module is also where `slugify` used to live.
 */

/**
 * Lower-case ASCII words joined by `-`; diacritics are dropped. Text
 * with nothing left (e.g. all Thai) falls back to `event`.
 * @param {string} text
 */
export function slugPart(text) {
  const slug = text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'event';
}

/**
 * An event's address (`events.slug`): the date, then the tag's slug.
 * @param {{occurredOn: string, addressTag: string}} input
 * @returns {string}
 */
export function addressOf({ occurredOn, addressTag }) {
  return `${occurredOn}/${slugPart(addressTag)}`;
}

/**
 * A slug as URL path segments: each part percent-encoded, the `/`
 * between them kept (split on the first `/`), so `/e/${addressPath(slug)}`
 * and `/api/event/${addressPath(slug)}` match their `:date/:tag` routes.
 * Browser code takes it (and `slugPart`) from `public/js/core/routes.js`.
 * @param {string} slug
 * @returns {string}
 */
export function addressPath(slug) {
  const index = slug.indexOf('/');
  if (index === -1) return encodeURIComponent(slug);
  return `${encodeURIComponent(slug.slice(0, index))}/${encodeURIComponent(slug.slice(index + 1))}`;
}

/**
 * The tag a new proposal addresses itself by, when the submitter hasn't
 * chosen one: the first hashtag, else the proposed name.
 * @param {{hashtags: string[], name: string}} input
 * @returns {string}
 */
export function defaultAddressTag({ hashtags, name }) {
  return hashtags.length > 0 ? hashtags[0] : name;
}

/**
 * The tag half of a slug (after the `/`), or `null` for a one-part slug
 * (an event addressed the old way, before dates moved into the URL).
 * @param {string} slug
 * @returns {string|null}
 */
export function addressTagOf(slug) {
  const index = slug.indexOf('/');
  return index === -1 ? null : slug.slice(index + 1);
}

/**
 * `address`, unless it's already taken, in which case its tag half is
 * numbered `-2`, `-3`… until free.
 * @param {string} address
 * @param {Set<string>} taken
 * @returns {string}
 */
export function withClashSuffix(address, taken) {
  if (!taken.has(address)) return address;
  const slashIndex = address.lastIndexOf('/');
  const prefix = slashIndex === -1 ? '' : address.slice(0, slashIndex + 1);
  const tag = slashIndex === -1 ? address : address.slice(slashIndex + 1);
  let n = 2;
  while (taken.has(`${prefix}${tag}-${n}`)) n += 1;
  return `${prefix}${tag}-${n}`;
}
