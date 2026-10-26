// @ts-check
/**
 * The signed-in user's own interface: `GET /api/me` (who am I?), `POST
 * /api/me/name` (a Google user picks their public name), `POST
 * /api/auth/signout` and `/api/auth/signout-all`.
 */
import { NO_STORE } from '../http/handler.js';
import { BadRequest } from '../http/errors.js';
import { jsonWithCookies } from '../http/cookies.js';
import { currentUser, requireUser, signOut, signOutEverywhere, setDisplayName, isTranslator } from '../services/session.js';
import { limit } from '../services/limits.js';
import { cleanDisplayName } from '../domain/displayName.js';
import { deleteAccount } from '../services/deleteAccount.js';

/** @param {import('../services/session.js').SessionUser|null} user */
function meUser(user) {
  if (!user) return null;
  return {
    via: user.via,
    handle: user.handle,
    displayName: user.displayName,
    isOwner: user.isOwner,
    isTranslator: isTranslator(user),
    needsName: user.via === 'google' && !user.displayName,
  };
}

export const meRoute = {
  method: 'GET',
  path: '/api/me',
  cache: NO_STORE,
  query: [],
  /** @param {import('../http/handler.js').RouteInput} input @param {any} deps */
  run: async (input, deps) => ({ user: meUser(await currentUser(deps, input)) }),
};

export const setNameRoute = {
  method: 'POST',
  path: '/api/me/name',
  cache: NO_STORE,
  /** @param {import('../http/handler.js').RouteInput} input @param {any} deps */
  run: async (input, deps) => {
    const user = await requireUser(deps, input);
    await limit(deps, 'setName', user.id);
    const raw = typeof (/** @type {any} */ (input.body))?.name === 'string' ? (/** @type {any} */ (input.body)).name : '';
    const cleaned = cleanDisplayName(raw);
    if (!cleaned.ok) throw new BadRequest(cleaned.reason);
    await setDisplayName(deps, user.id, cleaned.name);
    return { ok: true, name: cleaned.name };
  },
};

export const signOutRoute = {
  method: 'POST',
  path: '/api/auth/signout',
  cache: NO_STORE,
  /** @param {import('../http/handler.js').RouteInput} input @param {any} deps */
  run: async (input, deps) => jsonWithCookies({ ok: true }, [await signOut(deps, input)]),
};

export const signOutAllRoute = {
  method: 'POST',
  path: '/api/auth/signout-all',
  cache: NO_STORE,
  /** @param {import('../http/handler.js').RouteInput} input @param {any} deps */
  run: async (input, deps) => {
    const user = await requireUser(deps, input);
    await signOutEverywhere(deps, user.id);
    return jsonWithCookies({ ok: true }, [await signOut(deps, input)]);
  },
};

export const deleteAccountRoute = {
  method: 'POST',
  path: '/api/me/delete',
  cache: NO_STORE,
  /** @param {import('../http/handler.js').RouteInput} input @param {any} deps */
  run: async (input, deps) => {
    const user = await requireUser(deps, input);
    await limit(deps, 'deleteAccount', user.id);
    const confirm = /** @type {any} */ (input.body)?.confirm;
    if (confirm !== 'delete') throw new BadRequest('confirm must be "delete"');
    const clear = await deleteAccount({ db: deps.db }, user.id);
    return jsonWithCookies({ ok: true }, [clear]);
  },
};
