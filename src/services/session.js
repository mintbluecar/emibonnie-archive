// @ts-check
/**
 * Sessions and the signed-in user (Plan 2a Task 4). `signInUser` upserts
 * the `users` row and issues a 7-day session; `currentUser`/`requireUser`
 * read the `sid` cookie through `RouteInput`; `signOut`/`signOutEverywhere`
 * end sessions.
 *
 * Session cookies are `HttpOnly; Secure; SameSite=Lax; Path=/`
 * (src/http/cookies.js), and only the token's SHA-256 is stored.
 */
import { randomBytes } from 'node:crypto';
import { Unauthorized, Forbidden, Conflict } from '../domain/errors.js';
import { serializeCookie } from '../domain/cookies.js';
import { linkXAccountToUser, xAccountIdsOfUser } from '../repo/accounts.js';
import { createSession, deleteSession, deleteUserSessions, userIdForToken } from '../repo/sessions.js';
import { set as settingsSet } from '../repo/settings.js';

const SESSION_MAX_AGE = 7 * 24 * 60 * 60; // 7 days
const COOKIE_NAME = 'sid';

/** @typedef {{ db: import('../db/common.js').Db, site: import('../site/schema.js').Site, now?: () => Date }} SessionDeps */
/** @typedef {import('../http/handler.js').RouteInput} RouteInput */

/**
 * @typedef {{ id: string, via: 'x'|'google', xUserId: string|null, handle: string|null,
 *   displayName: string|null, isOwner: boolean, isBlocked: boolean, translatorAccountIds: number[],
 *   welcomedTranslator: boolean }} SessionUser
 */

/** @param {string} userId */
function userViaAndSubject(userId) {
  const m = /^(x|google):(.+)$/.exec(userId);
  if (!m) return null;
  return { via: /** @type {'x'|'google'} */ (m[1]), subject: m[2] };
}

/**
 * Upsert the user row for a sign-in and produce its `SessionUser` shape.
 * Runs inside the sign-in transaction (actor = the user's own id).
 * @param {import('../db/common.js').Tx} tx
 * @param {{ site: import('../site/schema.js').Site, via: 'x'|'google', subject: string, handle: string|null }} input
 * @returns {Promise<{ userId: string }>}
 */
async function upsertUserRow(tx, { site, via, subject, handle }) {
  const userId = `${via}:${subject}`;
  const isOwner = via === 'x' && subject === site.ownerXUserId;
  const role = isOwner ? 'owner' : 'member';
  // A previously deleted user is restored on sign-in with a blank name (its
  // past items stay "a fan"); a fresh user starts with no display name.
  await tx.query(
    `insert into users (id, role, meta, deleted_at, display_name) values ($1, $2, $3, null, null)
     on conflict (id) do update set role = excluded.role, deleted_at = null,
       display_name = case when users.deleted_at is null then users.display_name else null end,
       meta = case when users.deleted_at is null then users.meta else excluded.meta end`,
    [userId, role, via === 'x' && handle ? JSON.stringify({ handle }) : '{}'],
  );
  return { userId };
}

/**
 * Sign the user in: upsert their user row, link their X account (for X),
 * create a 7-day session, and return the `SessionUser` plus its cookie.
 * @param {SessionDeps} deps
 * @param {{ via: 'x'|'google', subject: string, handle: string|null }} input
 * @returns {Promise<{ user: SessionUser, cookie: string }>}
 */
export async function signInUser(deps, { via, subject, handle }) {
  const now = (deps.now ?? (() => new Date()))();
  const token = randomBytes(32).toString('base64url');

  const userId = await deps.db.transaction(async (tx) => {
    const { userId } = await upsertUserRow(tx, { site: deps.site, via, subject, handle });
    if (via === 'x') await linkXAccountToUser(tx, { externalId: subject, userId });
    await createSession(tx, { token, userId, expiresAt: new Date(now.getTime() + SESSION_MAX_AGE * 1000) });
    return userId;
  }, { actor: `${via}:${subject}` });

  return { user: await loadSessionUser(deps, userId), cookie: serializeCookie(COOKIE_NAME, token, { maxAge: SESSION_MAX_AGE }) };
}

/** @param {unknown} value @returns {string|null} */
const str = (value) => (value == null ? null : String(value));

/** @param {any} row @returns {string|null} */
function xHandleOf(row) {
  return str(row?.meta?.handle);
}

/** @param {any} row @returns {boolean} */
function welcomedOf(row) {
  return row?.meta?.translatorWelcomedAt != null;
}

/**
 * @param {string} userId
 * @param {any} row
 * @param {number[]} translatorAccountIds
 * @returns {SessionUser}
 */
function toSessionUser(userId, row, translatorAccountIds) {
  const parsed = userViaAndSubject(userId);
  const displayName = str(row?.display_name);
  const isOwner = row?.role === 'owner';
  const isBlocked = row?.blocked_at != null;
  const isX = parsed?.via === 'x';
  return {
    id: userId, via: isX ? 'x' : 'google',
    xUserId: isX ? parsed.subject : null,
    handle: isX ? xHandleOf(row) : null,
    displayName, isOwner, isBlocked, translatorAccountIds,
    welcomedTranslator: welcomedOf(row),
  };
}

/**
 * The `SessionUser` for a signed-in `userId`. Call only with an existing
 * user id (the row is read by id).
 * @param {SessionDeps} deps
 * @param {string} userId
 * @returns {Promise<SessionUser>}
 */
async function loadSessionUser(deps, userId) {
  const { rows } = await deps.db.query('select display_name, role, blocked_at, meta from users where id = $1', [userId]);
  const translatorAccountIds = await xAccountIdsOfUser(deps.db, userId);
  return toSessionUser(userId, rows[0], translatorAccountIds);
}

/** Caches one user lookup per request's `input` object, so a request that reads
 * the user in several places hits the database once. WeakMap keys don't leak. */
const cache = new WeakMap();

/**
 * The signed-in user for this request, or null. Ignores expired sessions.
 * @param {SessionDeps} deps
 * @param {RouteInput} input
 * @returns {Promise<SessionUser|null>}
 */
export async function currentUser(deps, input) {
  if (cache.has(input)) return cache.get(input) ?? null;
  const token = input.cookies?.[COOKIE_NAME];
  const now = (deps.now ?? (() => new Date()))();
  const userId = token ? await userIdForToken(deps.db, token, now) : null;
  const user = userId ? await loadSessionUser(deps, userId) : null;
  cache.set(input, user);
  return user;
}

/**
 * The signed-in user, or throws: `Unauthorized` when signed out,
 * `Forbidden('blocked')` when blocked unless `allowBlocked`.
 * @param {SessionDeps} deps
 * @param {RouteInput} input
 * @param {{ allowBlocked?: boolean }} [options]
 * @returns {Promise<SessionUser>}
 */
export async function requireUser(deps, input, { allowBlocked = false } = {}) {
  const user = await currentUser(deps, input);
  if (!user) throw new Unauthorized();
  if (user.isBlocked && !allowBlocked) throw new Forbidden('blocked');
  return user;
}

/**
 * Sign the request out: delete the session and return the cookie that
 * clears it. Safe to call when there is no active session.
 * @param {SessionDeps} deps
 * @param {RouteInput} input
 * @returns {Promise<string>}
 */
export async function signOut(deps, input) {
  const token = input.cookies[COOKIE_NAME];
  if (token) await deps.db.transaction((tx) => deleteSession(tx, token), { actor: 'system' });
  return serializeCookie(COOKIE_NAME, '', { maxAge: 0 });
}

/** @param {SessionDeps} deps @param {string} userId */
export async function signOutEverywhere(deps, userId) {
  await deps.db.transaction((tx) => deleteUserSessions(tx, userId), { actor: userId });
}

/** Record that an X sign-in failed (for the owner's attention). @param {{ db: import('../db/common.js').Db }} deps */
export async function recordXSignInFailure(deps) {
  await deps.db.transaction((tx) => settingsSet(tx, 'xSignInFailedAt', new Date().toISOString()), { actor: 'system' });
}

/**
 * Set (or clear) a user's public display name. Used for the Google "pick a
 * name" step; `cleanDisplayName` runs first.
 * @param {{ db: import('../db/common.js').Db }} deps
 * @param {string} userId
 * @param {string} name
 */
export async function setDisplayName(deps, userId, name) {
  await deps.db.transaction((tx) => tx.query('update users set display_name = $2 where id = $1', [userId, name]), { actor: userId });
}

/** Whether a signed-in user is recognised as a credited translator. @param {SessionUser} user */
export function isTranslator(user) {
  return user.translatorAccountIds.length > 0;
}

/**
 * A Google user who hasn't picked a public display name yet. The me page
 * asks them to pick one (its `needsName` flag).
 * @param {SessionUser} user
 * @returns {boolean}
 */
export function needsDisplayName(user) {
  return user.via === 'google' && !user.displayName;
}

/**
 * Refuse a write whose "added by" would be missing: a Google user must
 * pick a display name first (`409 needs_name`). Used by every add route.
 * @param {SessionUser} user
 * @returns {void}
 */
export function requireDisplayName(user) {
  if (needsDisplayName(user)) throw new Conflict('needs_name');
}
