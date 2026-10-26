// @ts-check
/** Thrown by `getJson()`/`postJson()` when the response isn't OK (2xx). */
export class ApiError extends Error {
  /**
   * @param {number} status
   * @param {any} [body] the server's JSON error body, when it sent one
   */
  constructor(status, body = null) {
    super(`request failed with status ${status}`);
    this.name = 'ApiError';
    this.status = status;
    /** The parsed error body (`{ error, message? }`), or null. */
    this.body = body;
  }
}

/**
 * Appends `params` to `path` as a query string, skipping `undefined` and
 * `null` values. `path` stays a plain string (not a `URL`), so a relative
 * page path works both in the browser and against a test's mocked
 * `fetch`.
 * @param {string} path
 * @param {Record<string, string|number|boolean|undefined|null>} [params]
 * @returns {string}
 */
function withQuery(path, params) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== null) query.set(key, String(value));
  }
  const search = query.toString();
  return search ? `${path}?${search}` : path;
}

/**
 * GETs `path` (with `params` as a query string) and parses the JSON body.
 * @param {string} path
 * @param {Record<string, string|number|boolean|undefined|null>} [params]
 * @returns {Promise<any>}
 */
export async function getJson(path, params) {
  const response = await fetch(withQuery(path, params));
  if (!response.ok) throw new ApiError(response.status);
  return response.json();
}

/**
 * POSTs `body` as JSON to `path` and parses the JSON response. An error
 * keeps its status and the server's own JSON body: the sign-in/name forms
 * show the server's `message` (`BadRequest` reasons like
 * `looks_like_handle`) in the page's words.
 * @param {string} path @param {unknown} [body]
 * @returns {Promise<any>}
 */
export async function postJson(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  if (!response.ok) {
    /** @type {any} */
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    throw new ApiError(response.status, payload);
  }
  return response.json();
}
