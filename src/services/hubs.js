// @ts-check
/**
 * The hub views (src/http/contracts.js): home, event, person, translator
 * account and the search filter options (one item's page: itemView.js). Visible
 * items and events only; per-kind sections in registry order, with empty
 * kinds left out. Never names a kind.
 */
import { listVisibleEvents, getVisibleEventBySlug } from '../repo/events.js';
import { getPersonByHandle, listPeople } from '../repo/people.js';
import { findAccountForView } from '../repo/accounts.js';
import {
  countsByEventKind, eventCrowd, eventLabels, personCounts, visibleAccountHandles, visibleCategories, visibleClients, visiblePersonIds,
} from '../repo/hubQueries.js';
import { formatName } from '../site/loadSite.js';
import { kindsOf, chipOf } from './cards.js';
import { sectionsOf } from './sections.js';
import { hubPage, orderParam } from './params.js';

/** @typedef {import('./cards.js').ViewDeps} ViewDeps */
/** @typedef {import('../http/contracts.js').HomeView} HomeView */
/** @typedef {import('../http/contracts.js').EventView} EventView */
/** @typedef {import('../http/contracts.js').PersonView} PersonView */
/** @typedef {import('../http/contracts.js').AccountView} AccountView */
/** @typedef {import('../http/contracts.js').OptedOutAccountView} OptedOutAccountView */
/** @typedef {import('../http/contracts.js').FilterOptions} FilterOptions */

const RECENT_EVENTS = 200;
const IDENTITY_PLATFORM = 'instagram';

/** @param {ViewDeps} deps @returns {Promise<HomeView>} */
export async function homeView(deps) {
  const [events, counts] = await Promise.all([listVisibleEvents(deps.db), countsByEventKind(deps.db)]);
  /** @type {HomeView['months']} */
  const months = [];
  for (const e of events) {
    const month = e.occurredOn.slice(0, 7);
    if (months.at(-1)?.month !== month) months.push({ month, events: [] });
    const entry = { slug: e.slug, name: e.name, occurredOn: e.occurredOn, hashtag: e.hashtags[0] ?? null, counts: counts.get(e.id) ?? {} };
    months[months.length - 1].events.push(entry);
  }
  return { months };
}

/**
 * @typedef {{ limit?: unknown, offset?: unknown }} PageParams
 *   As parsed from the query string: each per-kind section's page size
 *   (1 to 50, default 50) and start (0 to 10000, default 0); anything else
 *   is a `BadRequest`.
 * @typedef {PageParams & { order?: unknown }} EventParams
 *   `PageParams` plus `order` (`'asc'`|`'desc'`, default `'asc'`; see
 *   `orderParam`), the event page's "newest first" toggle.
 */

/** @param {ViewDeps} deps @param {string} slug @param {EventParams} [params] @returns {Promise<EventView|null>} */
export async function eventView(deps, slug, params = {}) {
  const page = hubPage(params);
  const order = orderParam(params.order);
  const event = await getVisibleEventBySlug(deps.db, slug);
  if (!event) return null;
  const [crowd, people, labels, listed] = await Promise.all([
    eventCrowd(deps.db, event.id), listPeople(deps.db), eventLabels(deps.db, event.id),
    sectionsOf(deps, { scope: { eventId: event.id }, order, page, withEvent: false }),
  ]);
  const format = (/** @type {string} */ name) => formatName(deps.site, name);
  const byId = new Map(people.map((p) => [p.id, p]));
  const { name, occurredOn, hashtags, keywords } = event;
  return {
    event: { slug: event.slug, name, occurredOn, hashtags, keywords, type: labels.type, client: labels.client },
    accountCount: crowd.accountCount,
    counts: listed.totals,
    people: crowd.personIds.map((id) => byId.get(id)).filter((p) => p !== undefined).map((p) => chipOf(p, format)),
    sections: listed.sections,
  };
}

/**
 * The person an IG handle names now, or named before a handle change.
 * @param {ViewDeps} deps @param {string} ig
 */
async function personFor(deps, ig) {
  const handle = ig.replace(/^@/, '');
  const current = await getPersonByHandle(deps.db, handle);
  if (current) return current;
  const account = await findAccountForView(deps.db, IDENTITY_PLATFORM, handle);
  return account?.personId ? getPersonByHandle(deps.db, account.handle) : null;
}

/**
 * A person's page. A person who isn't featured has a page only while
 * they're on a visible item (null otherwise, like an unknown handle).
 * @param {ViewDeps} deps @param {string} ig @param {PageParams} [params] @returns {Promise<PersonView|null>}
 */
export async function personView(deps, ig, params = {}) {
  const page = hubPage(params);
  const person = await personFor(deps, ig);
  if (!person) return null;
  const counts = await personCounts(deps.db, person.id);
  if (!person.featured && counts.items === 0) return null;
  const chip = chipOf(person, (name) => formatName(deps.site, name));
  const view = {
    person: { ...chip, featured: person.featured },
    counts,
    sections: (await sectionsOf(deps, { scope: { personId: person.id }, order: 'desc', page, withEvent: true })).sections,
  };
  return person.igHandle !== null && person.igHandle !== ig.replace(/^@/, '') ? { ...view, redirectTo: person.igHandle } : view;
}

/**
 * `AccountView.account`, with `profileUrl` left out entirely when the
 * matched kind doesn't define one (review round 1, I3).
 * @param {{ handle: string, displayName: string|null }} account @param {string|undefined} profileUrl
 * @returns {{ handle: string, displayName: string|null, profileUrl?: string }}
 */
function accountChipOf(account, profileUrl) {
  return profileUrl ? { handle: account.handle, displayName: account.displayName, profileUrl } : { handle: account.handle, displayName: account.displayName };
}

/**
 * A translator's page. The account is looked up on each kind's platform;
 * one with no visible items has no page (null).
 * @param {ViewDeps} deps @param {string} handle @param {PageParams} [params]
 * @returns {Promise<AccountView|OptedOutAccountView|null>}
 */
export async function accountView(deps, handle, params = {}) {
  const page = hubPage(params);
  const seenPlatforms = new Set();
  for (const kind of Object.values(kindsOf(deps))) {
    if (seenPlatforms.has(kind.platform)) continue;
    seenPlatforms.add(kind.platform);
    const account = await findAccountForView(deps.db, kind.platform, handle.replace(/^@/, ''));
    if (!account) continue;
    if (account.optedOut) return { account: { handle: account.current ? account.handle : handle, optedOut: true } };
    const { sections, totals } = await sectionsOf(deps, { scope: { accountId: account.id }, order: 'desc', page, withEvent: true });
    const items = Object.values(totals).reduce((n, count) => n + count, 0);
    if (items === 0) return null;
    const view = { account: accountChipOf(account, kind.profileUrl?.(account.handle)), counts: { items }, sections };
    return account.handle !== handle ? { ...view, redirectTo: account.handle } : view;
  }
  return null;
}

/**
 * The search filter options: featured people always, anyone else only
 * while on a visible item; categories, clients, events and accounts only
 * through visible items (review round 1, I3: `clients` added).
 * @param {ViewDeps} deps @returns {Promise<FilterOptions>}
 */
export async function filterOptions(deps) {
  const [people, onVisible, categories, clients, events, accounts] = await Promise.all([
    listPeople(deps.db), visiblePersonIds(deps.db), visibleCategories(deps.db), visibleClients(deps.db),
    listVisibleEvents(deps.db, { limit: RECENT_EVENTS }), visibleAccountHandles(deps.db),
  ]);
  const format = (/** @type {string} */ name) => formatName(deps.site, name);
  return {
    people: people.filter((p) => p.featured || onVisible.has(p.id)).map((p) => chipOf(p, format)),
    categories,
    clients,
    events: events.map((e) => ({ slug: e.slug, name: e.name })),
    accounts,
  };
}
