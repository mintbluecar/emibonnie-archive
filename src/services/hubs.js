// @ts-check
/**
 * The hub views (src/http/contracts.js): home, event, person, translator
 * account, the search filter options, and one item's page. Visible
 * items and events only; per-kind sections in registry order, with empty
 * kinds left out. Never names a kind.
 */
import { listVisibleItemIds, neighbours } from '../repo/items.js';
import { listVisibleEvents, getVisibleEventBySlug } from '../repo/events.js';
import { getPersonByHandle, listPeople } from '../repo/people.js';
import { findAccountForView } from '../repo/accounts.js';
import { listCategories } from '../repo/lookups.js';
import { countsByEventKind, eventCrowd, personCounts, visibleAccountHandles } from '../repo/hubQueries.js';
import { findVisibleItemId, loadCards } from '../repo/cards.js';
import { formatName } from '../site/loadSite.js';
import { kindsOf, chipOf, eventRefOf, presenterContext, previewsFor, detailsFor } from './cards.js';

/** @typedef {import('./cards.js').ViewDeps} ViewDeps */
/** @typedef {import('../http/contracts.js').Preview} Preview */
/** @typedef {import('../http/contracts.js').DetailVM} DetailVM */
/** @typedef {import('../http/contracts.js').HomeView} HomeView */
/** @typedef {import('../http/contracts.js').EventView} EventView */
/** @typedef {import('../http/contracts.js').PersonView} PersonView */
/** @typedef {import('../http/contracts.js').AccountView} AccountView */
/** @typedef {import('../http/contracts.js').OptedOutAccountView} OptedOutAccountView */
/** @typedef {import('../http/contracts.js').FilterOptions} FilterOptions */
/** @typedef {import('../http/contracts.js').ItemView} ItemView */
/** @typedef {import('../http/contracts.js').ItemLink} ItemLink */

const RECENT_EVENTS = 200;
const PAGE_ITEMS = 200;
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
 * Per-kind sections of `listVisibleItemIds(filters)`, each item presented
 * (plus its event when `withEvent`).
 * @param {ViewDeps} deps
 * @param {{ eventId?: number, personId?: number, accountId?: number, order: 'asc'|'desc' }} filters
 * @param {boolean} withEvent
 */
async function sectionsOf(deps, filters, withEvent) {
  const ctx = await presenterContext(deps);
  const sections = [];
  for (const kind of Object.keys(kindsOf(deps))) {
    const ids = (await listVisibleItemIds(deps.db, { ...filters, kind, limit: PAGE_ITEMS })).map((r) => r.id);
    const entries = await previewsFor(deps, ids, ctx);
    if (entries.length === 0) continue;
    const items = entries.map(({ card, preview }) => (withEvent ? { ...preview, event: eventRefOf(card.event) } : preview));
    sections.push({ kind, items });
  }
  return /** @type {any[]} */ (sections);
}

/** @param {ViewDeps} deps @param {string} slug @returns {Promise<EventView|null>} */
export async function eventView(deps, slug) {
  const event = await getVisibleEventBySlug(deps.db, slug);
  if (!event) return null;
  const [crowd, people] = await Promise.all([eventCrowd(deps.db, event.id), listPeople(deps.db)]);
  const format = (/** @type {string} */ name) => formatName(deps.site, name);
  const byId = new Map(people.map((p) => [p.id, p]));
  return {
    event: { slug: event.slug, name: event.name, occurredOn: event.occurredOn, hashtags: event.hashtags, keywords: event.keywords },
    accountCount: crowd.accountCount,
    people: crowd.personIds.map((id) => byId.get(id)).filter((p) => p !== undefined).map((p) => chipOf(p, format)),
    sections: await sectionsOf(deps, { eventId: event.id, order: 'asc' }, false),
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

/** @param {ViewDeps} deps @param {string} ig @returns {Promise<PersonView|null>} */
export async function personView(deps, ig) {
  const person = await personFor(deps, ig);
  if (!person) return null;
  const chip = chipOf(person, (name) => formatName(deps.site, name));
  const view = {
    person: { ...chip, featured: person.featured },
    counts: await personCounts(deps.db, person.id),
    sections: await sectionsOf(deps, { personId: person.id, order: 'desc' }, true),
  };
  return person.igHandle !== null && person.igHandle !== ig.replace(/^@/, '') ? { ...view, redirectTo: person.igHandle } : view;
}

/**
 * A translator's page. The account is looked up on each kind's platform;
 * one with no visible items has no page (null).
 * @param {ViewDeps} deps @param {string} handle
 * @returns {Promise<AccountView|OptedOutAccountView|null>}
 */
export async function accountView(deps, handle) {
  for (const platform of new Set(Object.values(kindsOf(deps)).map((k) => k.platform))) {
    const account = await findAccountForView(deps.db, platform, handle.replace(/^@/, ''));
    if (!account) continue;
    if (account.optedOut) return { account: { handle: account.current ? account.handle : handle, optedOut: true } };
    const sections = await sectionsOf(deps, { accountId: account.id, order: 'desc' }, true);
    const items = sections.reduce((n, s) => n + s.items.length, 0);
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

/** @param {ViewDeps} deps @param {number|null} itemId @returns {Promise<ItemLink|null>} */
async function linkTo(deps, itemId) {
  if (itemId === null) return null;
  const card = (await loadCards(deps.db, [itemId])).get(itemId);
  const kind = card ? kindsOf(deps)[card.kind] : undefined;
  return card && kind ? { sourceId: card.sourceId, url: `${kind.urlPrefix}${card.sourceId}` } : null;
}

/**
 * One visible item's page: its kind's detail, with the shared header
 * fields and its neighbours in its event. Null for an unknown kind, an
 * unknown id or a hidden item.
 * @param {ViewDeps} deps @param {string} kindName @param {string} sourceId
 * @returns {Promise<ItemView|null>}
 */
export async function itemView(deps, kindName, sourceId) {
  const kind = Object.hasOwn(kindsOf(deps), kindName) ? kindsOf(deps)[kindName] : undefined;
  if (!kind) return null;
  const id = await findVisibleItemId(deps.db, { kind: kind.name, platform: kind.platform, externalId: sourceId });
  const card = id === null ? undefined : (await loadCards(deps.db, [id])).get(id);
  const details = card ? (await detailsFor(deps, [card])).get(card.id) : undefined;
  if (!card || !details) return null;
  const ctx = await presenterContext(deps);
  const preview = /** @type {Preview} */ (kind.present.preview(card, details, ctx));
  const detail = /** @type {DetailVM} */ (kind.present.detail(card, details, ctx));
  const { prev, next } = card.event ? await neighbours(deps.db, card.id) : { prev: null, next: null };
  return {
    ...detail, kind: kind.name, sourceId: card.sourceId, url: preview.url, event: eventRefOf(card.event), people: preview.people,
    followsOnFrom: preview.followsOnFrom, prev: await linkTo(deps, prev), next: await linkTo(deps, next),
  };
}
