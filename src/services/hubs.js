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
import { listCategories } from '../repo/lookups.js';
import { countsByEventKind, eventCrowd, eventLabels, personCounts, visibleAccountHandles } from '../repo/hubQueries.js';
import { formatName } from '../site/loadSite.js';
import { kindsOf, chipOf } from './cards.js';
import { sectionsOf } from './sections.js';
import { hubPage } from './params.js';

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
 */

/** @param {ViewDeps} deps @param {string} slug @param {PageParams} [params] @returns {Promise<EventView|null>} */
export async function eventView(deps, slug, params = {}) {
  const page = hubPage(params);
  const event = await getVisibleEventBySlug(deps.db, slug);
  if (!event) return null;
  const [crowd, people, labels, listed] = await Promise.all([
    eventCrowd(deps.db, event.id), listPeople(deps.db), eventLabels(deps.db, event.id),
    sectionsOf(deps, { scope: { eventId: event.id }, order: 'asc', page, withEvent: false }),
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

/** @param {ViewDeps} deps @param {string} ig @param {PageParams} [params] @returns {Promise<PersonView|null>} */
export async function personView(deps, ig, params = {}) {
  const page = hubPage(params);
  const person = await personFor(deps, ig);
  if (!person) return null;
  const chip = chipOf(person, (name) => formatName(deps.site, name));
  const view = {
    person: { ...chip, featured: person.featured },
    counts: await personCounts(deps.db, person.id),
    sections: (await sectionsOf(deps, { scope: { personId: person.id }, order: 'desc', page, withEvent: true })).sections,
  };
  return person.igHandle !== null && person.igHandle !== ig.replace(/^@/, '') ? { ...view, redirectTo: person.igHandle } : view;
}

/**
 * A translator's page. The account is looked up on each kind's platform;
 * one with no visible items has no page (null).
 * @param {ViewDeps} deps @param {string} handle @param {PageParams} [params]
 * @returns {Promise<AccountView|OptedOutAccountView|null>}
 */
export async function accountView(deps, handle, params = {}) {
  const page = hubPage(params);
  for (const platform of new Set(Object.values(kindsOf(deps)).map((k) => k.platform))) {
    const account = await findAccountForView(deps.db, platform, handle.replace(/^@/, ''));
    if (!account) continue;
    if (account.optedOut) return { account: { handle: account.current ? account.handle : handle, optedOut: true } };
    const { sections, totals } = await sectionsOf(deps, { scope: { accountId: account.id }, order: 'desc', page, withEvent: true });
    const items = Object.values(totals).reduce((n, count) => n + count, 0);
    if (items === 0) return null;
    const view = { account: { handle: account.handle, displayName: account.displayName }, counts: { items }, sections };
    return account.handle !== handle ? { ...view, redirectTo: account.handle } : view;
  }
  return null;
}

/** @param {ViewDeps} deps @returns {Promise<FilterOptions>} */
export async function filterOptions(deps) {
  const [people, categories, events, accounts] = await Promise.all([
    listPeople(deps.db), listCategories(deps.db), listVisibleEvents(deps.db, { limit: RECENT_EVENTS }), visibleAccountHandles(deps.db),
  ]);
  const format = (/** @type {string} */ name) => formatName(deps.site, name);
  return {
    people: people.map((p) => chipOf(p, format)),
    categories,
    events: events.map((e) => ({ slug: e.slug, name: e.name })),
    accounts,
  };
}
