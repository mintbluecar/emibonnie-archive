// @ts-check
/**
 * The translation kind's optional upkeep methods (the Kind contract's
 * `refresh` and `checkFollowUps`, src/kinds/defineKind.js): owner-decided
 * upkeep of an archived translation's X posts, each run on demand (a
 * button, or the item route once an edit window has closed) -- there's no
 * daily sweep:
 *
 * - `refreshEdits` re-fetches every post whose edit window isn't finalized,
 *   takes an edited text into its part (the only path allowed to rewrite a
 *   part; the audit log keeps the old body), and finalizes a post once its
 *   window has closed, so it's never fetched again.
 * - `checkFollowUps` re-reads the primary post's thread and appends any
 *   same-author follow-ups no item archives yet.
 */
import { fetchTweet } from '../../sources/fetchTweet.js';
import { fetchThread } from '../../sources/thread.js';
import { findSourceOwner, primarySource } from '../../repo/itemSources.js';
import { addAliases, unfinalizedSources, updateEditState } from '../../repo/sourceEdits.js';
import { isTextEnteredManually, updatePartBody, dropFixesForPart } from './repo.js';
import { appendPosts } from './persist.js';
import { asFetched } from './source.js';
import { GONE_GRACE_HOURS } from '../../domain/constants.js';

/** @typedef {import('../../db/common.js').Db} Db */
/** @typedef {import('../../db/common.js').Tx} Tx */
/** @typedef {import('../../sources/normalize.js').Tweet} Tweet */
/** @typedef {{ db: Db, fetchImpl: typeof fetch, now?: () => Date }} UpkeepDeps */
/** @typedef {Awaited<ReturnType<typeof unfinalizedSources>>[number]} OpenSource */

const HANDLE_IN_URL = /^https:\/\/(?:x|twitter)\.com\/([^/]+)\/status\//u;
const HOUR_MS = 60 * 60 * 1000;

/** @param {Date|string|null} value */
function toTime(value) {
  return value === null ? null : new Date(value).getTime();
}

/**
 * Whether a post's edit window is over for good. A live post: it has no
 * window, or the window has closed by `now`. A post that's gone
 * (`deleted`) or can't be read (`unavailable`): its stored window is
 * missing, or closed more than `GONE_GRACE_HOURS` ago -- until then it's
 * read again, in case the source was only briefly unreachable.
 * @param {{ live: boolean, editableUntil: string|null, source: OpenSource, now: Date }} input
 */
function isClosed({ live, editableUntil, source, now }) {
  if (!live) {
    const stored = toTime(source.editableUntil);
    return stored === null || stored < now.getTime() - GONE_GRACE_HOURS * HOUR_MS;
  }
  const closesAt = toTime(editableUntil ?? source.editableUntil);
  return closesAt === null || closesAt < now.getTime();
}

/**
 * Applies one re-fetched post: a changed text (unless the part was typed in
 * by hand), any new version ids, and the window -- finalized once it has
 * closed, or (a post that's gone or unreadable) a day after it closed, so
 * the item page stops scheduling fetches of it.
 * @param {Tx} tx
 * @param {{ itemId: number, source: OpenSource, tweet: Tweet, now: Date, manual: boolean }} input
 * @returns {Promise<boolean>} whether the part's body changed
 */
async function applyRefetch(tx, { itemId, source, tweet, now, manual }) {
  const live = tweet.status === 'live';
  const changedPositions = live && !(manual && source.role === 'primary')
    ? await updatePartBody(tx, { itemId, sourceId: source.id, body: tweet.text })
    : [];
  // A part whose body was rewritten loses its line fixes (the positions no
  // longer apply); marker-level speakers are kept.
  for (const position of changedPositions) await dropFixesForPart(tx, itemId, position);
  if (live) await addAliases(tx, { sourceId: source.id, platform: source.platform, ids: [...tweet.edit.versionIds, tweet.id] });
  const editableUntil = live ? tweet.edit.editableUntil : null;
  await updateEditState(tx, { sourceId: source.id, editableUntil, finalizedAt: isClosed({ live, editableUntil, source, now }) ? now : null });
  return changedPositions.length > 0;
}

/**
 * The latest `editable_until` among the item's still-open posts, or null.
 * @param {Db} db
 * @param {number} itemId
 * @returns {Promise<string|null>}
 */
async function openUntil(db, itemId) {
  const times = (await unfinalizedSources(db, itemId)).map((s) => toTime(s.editableUntil)).filter((t) => t !== null);
  return times.length > 0 ? new Date(Math.max(...times)).toISOString() : null;
}

/**
 * @param {UpkeepDeps} deps
 * @param {number} itemId
 * @param {{ actor: string }} options
 * @returns {Promise<{ updated: number, editableUntil: string|null }>}
 */
export async function refreshEdits(deps, itemId, { actor }) {
  const now = deps.now?.() ?? new Date();
  const open = (await unfinalizedSources(deps.db, itemId)).filter((s) => s.platform === 'x');
  const fetched = await Promise.all(open.map(async (source) => ({ source, tweet: await fetchTweet(deps, source.externalId) })));
  const manual = await isTextEnteredManually(deps.db, itemId);
  let updated = 0;
  await deps.db.transaction(async (tx) => {
    for (const { source, tweet } of fetched) {
      if (await applyRefetch(tx, { itemId, source, tweet, now, manual })) updated += 1;
    }
  }, { actor });
  return { updated, editableUntil: await openUntil(deps.db, itemId) };
}

/**
 * The thread's follow-ups no item archives yet (aliases included, so an
 * edited follow-up's new id isn't added twice), each read through its own
 * post fetch like at intake.
 * @param {UpkeepDeps} deps
 * @param {{ kind: string, followUps: import('../../sources/normalize.js').FollowUp[] }} input
 */
async function newPosts(deps, { kind, followUps }) {
  const owners = await Promise.all(followUps.map((post) => findSourceOwner(deps.db, { kind, platform: 'x', externalId: post.id })));
  const missing = followUps.filter((_, i) => owners[i] === null);
  return Promise.all(missing.map((post) => asFetched(deps, post)));
}

/**
 * @param {UpkeepDeps} deps
 * @param {number} itemId
 * @param {{ actor: string }} options
 * @returns {Promise<{ added: number }>}
 */
export async function checkFollowUps(deps, itemId, { actor }) {
  const primary = /** @type {any} */ (await primarySource(deps.db, itemId));
  if (!primary || primary.platform !== 'x' || !primary.externalId) return { added: 0 };
  const posts = await newPosts(deps, { kind: primary.kind, followUps: await fetchThread(deps, primary.externalId) });
  if (posts.length === 0) return { added: 0 };
  const handle = HANDLE_IN_URL.exec(primary.url)?.[1] ?? null;
  const added = await deps.db.transaction(
    (tx) => appendPosts(tx, { itemId, accountId: primary.accountId, handle, posts }),
    { actor },
  );
  return { added };
}
