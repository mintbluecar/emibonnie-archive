// @ts-check
/**
 * Query string and body parsing for the handler. Values stay strings
 * (services validate and convert them); a route names its list params,
 * which may repeat or be comma-separated. Anything else given twice is a
 * `BadRequest`, never silently first- or last-wins.
 */
import { BadRequest, PayloadTooLarge } from './errors.js';

/** Request bodies larger than this are refused (the public API takes none this big). */
const BODY_MAX = 16 * 1024;

/**
 * @param {URLSearchParams} searchParams
 * @param {readonly string[]} [lists] params that hold a list
 * @returns {Record<string, string|string[]>} a prototype-less object, so no key can reach `Object.prototype`
 */
export function parseQuery(searchParams, lists = []) {
  /** @type {Record<string, string|string[]>} */
  const out = Object.create(null);
  for (const key of new Set(searchParams.keys())) {
    const values = searchParams.getAll(key);
    if (lists.includes(key)) {
      const items = values.flatMap((v) => v.split(',')).filter((v) => v !== '');
      if (items.length > 0) out[key] = items;
    } else if (values.length > 1) {
      throw new BadRequest(`${key} may be given only once`);
    } else {
      out[key] = values[0];
    }
  }
  return out;
}

/** @param {Request} request */
const hasNoBody = (request) => request.method === 'GET' || request.method === 'HEAD' || !request.body;

/**
 * The body as text, counting bytes as they stream in and stopping (and
 * cancelling the stream) once past `BODY_MAX`, with or without a
 * content-length.
 * @param {ReadableStream<Uint8Array>} body
 * @returns {Promise<string>}
 */
async function readCapped(body) {
  const reader = body.getReader();
  /** @type {Uint8Array[]} */
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > BODY_MAX) {
      await reader.cancel().catch(() => {});
      throw new PayloadTooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * A JSON body, or undefined when there is none. Over 16 KB is a
 * `PayloadTooLarge` (413).
 * @param {Request} request
 * @returns {Promise<unknown>}
 */
export async function readBody(request) {
  if (hasNoBody(request)) return undefined;
  if (Number(request.headers.get('content-length') ?? 0) > BODY_MAX) throw new PayloadTooLarge();
  const text = await readCapped(/** @type {ReadableStream<Uint8Array>} */ (request.body));
  if (text.length === 0) return undefined;
  if (!/^application\/json\b/i.test(request.headers.get('content-type') ?? '')) throw new BadRequest('body must be JSON');
  try {
    return JSON.parse(text);
  } catch {
    throw new BadRequest('body is not valid JSON');
  }
}

/**
 * Refuses query params a route didn't declare (`allowed`; null accepts
 * any), so no variant of a cached URL can bypass the CDN cache.
 * @param {Record<string, unknown>} query
 * @param {readonly string[]|null|undefined} allowed
 */
export function assertKnownParams(query, allowed) {
  if (allowed === null) return;
  const unknown = Object.keys(query).find((key) => !(allowed ?? []).includes(key));
  if (unknown !== undefined) throw new BadRequest(`unknown query parameter: ${unknown.slice(0, 50)}`);
}
