// @ts-check
/**
 * Query string and body parsing for the handler. Values stay strings
 * (services validate and convert them); a route names its list params,
 * which may repeat or be comma-separated. Anything else given twice is a
 * `BadRequest`, never silently first- or last-wins.
 */
import { BadRequest } from './errors.js';

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
 * A JSON body, or undefined when there is none.
 * @param {Request} request
 * @returns {Promise<unknown>}
 */
export async function readBody(request) {
  if (hasNoBody(request)) return undefined;
  if (Number(request.headers.get('content-length') ?? 0) > BODY_MAX) throw new BadRequest('body is too large');
  const text = await request.text();
  if (text.length === 0) return undefined;
  if (text.length > BODY_MAX) throw new BadRequest('body is too large');
  if (!/^application\/json\b/i.test(request.headers.get('content-type') ?? '')) throw new BadRequest('body must be JSON');
  try {
    return JSON.parse(text);
  } catch {
    throw new BadRequest('body is not valid JSON');
  }
}
