// @ts-check
/**
 * Loads what a kind's `draft` may consult (`DraftContext`), and settles
 * the item's date. Read-only.
 */
import { listPeople, listPersonAccounts } from '../repo/people.js';
import { listEvents } from '../repo/events.js';
import { ignoredHashtags } from '../repo/tags.js';
import { LIVE_PATTERNS } from '../domain/constants.js';
import { localDate } from '../domain/dates.js';
import { formatName } from '../site/loadSite.js';
import { BadRequest } from '../domain/errors.js';

/** @typedef {import('../kinds/defineKind.js').DraftContext} DraftContext */
/** @typedef {import('../kinds/defineKind.js').DraftCommon} DraftCommon */
/** @typedef {import('../kinds/defineKind.js').DraftOverrides} DraftOverrides */
/** @typedef {import('../domain/speakers.js').SpeakerMap} SpeakerMap */
/** @typedef {import('../site/schema.js').Site} Site */

/**
 * The engine's live patterns plus the site's `extraLivePatterns`, compiled
 * case-insensitively like the engine's own.
 * @param {Site} site
 * @returns {import('../domain/constants.js').LiveTextPattern[]}
 */
function livePatternsOf(site) {
  const extra = site.extraLivePatterns.map(({ code, platformCode, pattern }) => ({ code, platformCode, pattern: new RegExp(pattern, 'iu') }));
  return [...LIVE_PATTERNS, ...extra];
}

/**
 * Everything but `remembered`, which depends on the credited account and
 * is filled in by the caller once that's known.
 * @param {{ db: any, site: Site }} deps
 * @param {{ chosen?: SpeakerMap, overrides?: DraftOverrides }} request
 * @returns {Promise<DraftContext>}
 */
export async function loadContext({ db, site }, { chosen = {}, overrides = {} }) {
  const [people, personAccounts, events, ignored] = await Promise.all([
    listPeople(db), listPersonAccounts(db), listEvents(db), ignoredHashtags(db),
  ]);
  return {
    people: people.map((p) => ({ id: p.id, displayName: p.displayName, igHandle: p.igHandle ?? '', extraHashtags: p.extraHashtags })),
    personAccounts,
    events,
    ignoredHashtags: ignored,
    livePatterns: livePatternsOf(site),
    defaultMarkers: /** @type {DraftContext['defaultMarkers']} */ (site.defaultMarkers),
    timezone: site.timezone,
    formatName: (name) => formatName(site, name),
    remembered: {},
    chosen,
    overrides,
  };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;

/**
 * The item's `occurred_on`: the submitter's date, else the draft's, else
 * the posting instant's local date. `null` when none can be found.
 * @param {DraftCommon} common
 * @param {DraftOverrides|undefined} overrides
 * @param {string} timezone
 * @returns {string|null}
 */
export function occurredOnOf(common, overrides, timezone) {
  const given = overrides?.occurredOn;
  if (given !== undefined) {
    if (!ISO_DATE.test(given)) throw new BadRequest(`occurredOn must be YYYY-MM-DD: ${given}`);
    return given;
  }
  if (common.occurredOn) return common.occurredOn;
  return common.postedAt ? localDate(common.postedAt, timezone) : null;
}
