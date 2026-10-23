// @ts-check

const ENDPOINT = 'https://api.fxtwitter.com/2/thread';

/**
 * @param {{fetchImpl: typeof fetch}} deps
 * @param {string} id
 * @returns {Promise<any|null>}
 */
async function fetchThreadJson(deps, id) {
  try {
    const res = await deps.fetchImpl(`${ENDPOINT}/${id}`, { redirect: 'error', signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** @param {any} data */
function itemsOf(data) {
  const items = data?.thread;
  return Array.isArray(items) ? items : null;
}

/** @param {any} item */
function authorIdOf(item) {
  return item?.author?.id ?? null;
}

/** @param {any} item */
function replyTargetOf(item) {
  return item?.replying_to?.status ?? null;
}

/** @param {any} item */
function editableUntilOf(item) {
  const untilMsecs = item.edit_control?.editable_until_msecs;
  return untilMsecs ? new Date(Number(untilMsecs)).toISOString() : null;
}

/**
 * Whether `item` is a different, same-author tweet that replies within
 * `chain` (directly to `rootId` or to an already-accepted follow-up).
 * @param {any} item
 * @param {string} rootId
 * @param {string|null} rootAuthorId
 * @param {Set<string|null>} chain
 */
function isChainFollowUp(item, rootId, rootAuthorId, chain) {
  if (item.id === rootId || authorIdOf(item) !== rootAuthorId) return false;
  return chain.has(replyTargetOf(item));
}

/**
 * Fetches the same-author follow-ups that reply within `id`'s thread,
 * in order, excluding `id` itself. Returns `[]` on any failure, or when
 * the thread has no entries by the same author replying in-chain.
 * @param {{fetchImpl: typeof fetch}} deps
 * @param {string} id
 * @returns {Promise<import('./normalize.js').FollowUp[]>}
 */
export async function fetchThread(deps, id) {
  const data = await fetchThreadJson(deps, id);
  const items = itemsOf(data);
  if (!items) return [];

  const root = items.find((/** @type {any} */ item) => item?.id === id);
  if (!root) return [];
  const rootAuthorId = authorIdOf(root);

  const chain = new Set([id]);
  /** @type {import('./normalize.js').FollowUp[]} */
  const followUps = [];
  for (const item of items) {
    if (!isChainFollowUp(item, id, rootAuthorId, chain)) continue;
    chain.add(item.id);
    followUps.push({ id: item.id, text: item.text, createdAt: item.created_at ?? null, editableUntil: editableUntilOf(item) });
  }
  return followUps;
}
