// @ts-check
/**
 * OAuth `state` (and PKCE `verifier` / Google `nonce`) round-trip through a
 * short-lived, signed cookie. The `state` guards the callback against CSRF
 * and replay: it is HMAC-SHA256 signed with `AUTH_SECRET`, expires after 10
 * minutes, and the route clears the cookie as it reads the state, so a
 * state can be used once.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { BadRequest } from '../domain/errors.js';
import { serializeCookie } from '../domain/cookies.js';

const COOKIE_NAME = 'oauth';
const TTL_MS = 10 * 60 * 1000; // 10 minutes
/** A stand-in origin: only same-origin return paths survive resolution. */
const SITE = 'https://site.invalid';

/**
 * Keep a return path on this site. Resolving against a stand-in origin
 * catches what a prefix test misses: browsers read `\` as `/`, so
 * `/\evil.example` (and `//evil.example`, `https://evil.example`) would
 * otherwise redirect off-site. Returns the normalised path, or `/me`.
 * @param {string} returnTo
 * @returns {string}
 */
function safeReturnTo(returnTo) {
  try {
    const url = new URL(returnTo, SITE);
    if (url.origin !== SITE) return '/me';
    return `${url.pathname}${url.search}${url.hash}` || '/me';
  } catch {
    return '/me';
  }
}

/** @param {string} secret @param {string} payload */
function sign(secret, payload) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

/** @param {string} secret @param {string} payload @param {string} sig */
function verify(secret, payload, sig) {
  const expected = sign(secret, payload);
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The cookie that clears the state cookie after a successful (or refused) read. */
export function clearStateCookie() {
  return serializeCookie(COOKIE_NAME, '', { maxAge: 0 });
}

/**
 * @param {Record<string, string|undefined>} env
 * @param {{ verifier: string|null, returnTo: string, nonce?: string, now?: number }} input
 *   `now` (epoch ms) is injectable so expiry is testable without mocking the clock.
 * @returns {{ state: string, cookie: string }}
 */
export function issueState(env, { verifier, returnTo, nonce, now = Date.now() }) {
  const secret = env.AUTH_SECRET ?? '';
  const state = randomBytes(24).toString('base64url');
  const payload = JSON.stringify({ state, verifier, returnTo: safeReturnTo(returnTo), nonce: nonce ?? null, exp: now + TTL_MS });
  return { state, cookie: serializeCookie(COOKIE_NAME, `${payload}.${sign(secret, payload)}`, { maxAge: TTL_MS / 1000 }) };
}

/** @param {string} secret @param {string} raw @returns {any|null} the parsed, signature-valid payload, else null */
function parseStateCookie(secret, raw) {
  const dot = raw ? raw.lastIndexOf('.') : -1;
  if (dot < 0) return null;
  const payload = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  if (!verify(secret, payload, sig)) return null;
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

/** @param {any} parsed @param {string} state @param {number} now */
function stateIsValid(parsed, state, now) {
  return parsed !== null && parsed.state === state && typeof parsed.exp === 'number' && parsed.exp >= now;
}

/**
 * Reads and validates the state cookie against `state`, returning what was
 * stored. Throws `BadRequest` when the cookie is missing, the signature is
 * bad, the state doesn't match, or it has expired. Single-use is the route's
 * job: it always clears the cookie (with `clearStateCookie`) after calling.
 * @param {Record<string, string|undefined>} env
 * @param {import('../http/handler.js').RouteInput} input
 * @param {string} state
 * @param {{ now?: number }} [options] `now` (epoch ms) is injectable for tests
 * @returns {{ verifier: string|null, returnTo: string, nonce: string|null }}
 */
export function takeState(env, input, state, { now = Date.now() } = {}) {
  const parsed = parseStateCookie(env.AUTH_SECRET ?? '', input.cookies[COOKIE_NAME] ?? '');
  if (!stateIsValid(parsed, state, now)) throw new BadRequest('bad oauth state');
  return { verifier: parsed.verifier ?? null, returnTo: parsed.returnTo ?? '/me', nonce: parsed.nonce ?? null };
}
