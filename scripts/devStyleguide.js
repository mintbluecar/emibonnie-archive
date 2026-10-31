// @ts-check
/**
 * Styling system Task 3: serves the dev-only style guide for
 * `scripts/dev.js`'s `GET /dev/styleguide` route. Split out of dev.js on
 * its own so dev.js's request handler stays small -- this file has no
 * other reason to exist separately.
 */
import { readFile } from 'node:fs/promises';

/** The dev-only style guide's generated file, outside `public/` (never deployed, Styling system Task 3's `scripts/styleguide.js` writes it). */
export const DEV_STYLEGUIDE_PATH = 'dev/styleguide/index.html';

/**
 * Serves the generated style guide straight from disk -- it sits outside
 * `root` (`dev/` is beside `public/`, never built or deployed), so it
 * needs its own tiny path instead of `scripts/dev.js`'s normal static
 * resolution under `root`. 404 (plain, not `root/404.html`: this route
 * doesn't exist at all outside local dev) when the generated file is
 * missing, e.g. any clone before its first build.
 * @param {string} filePath
 * @param {import('node:http').ServerResponse} res
 * @returns {Promise<void>}
 */
export async function serveDevStyleguide(filePath, res) {
  try {
    const body = await readFile(filePath);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(body);
  } catch (/** @type {any} */ err) {
    if (!err || err.code !== 'ENOENT') throw err;
    res.statusCode = 404;
    res.end('Not Found');
  }
}
