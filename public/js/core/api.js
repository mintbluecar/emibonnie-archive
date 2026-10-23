// @ts-check
/** Thrown by `getJson()` when the response isn't OK (2xx). */
export class ApiError extends Error {
  /** @param {number} status */
  constructor(status) {
    super(`request failed with status ${status}`);
    this.name = 'ApiError';
    this.status = status;
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
