// @ts-check
import http from 'node:http';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * The dev stand-in for Vercel's request context, which `waitUntil` from
 * `@vercel/functions` reads (`globalThis[Symbol.for('@vercel/request-context')].get()`).
 * Each API request gets its own `waitUntil` collector; the server awaits
 * the collected work after the response is sent.
 */
const REQUEST_CONTEXT = Symbol.for('@vercel/request-context');
/** @type {AsyncLocalStorage<{ waitUntil: (promise: Promise<unknown>) => void }>} */
const requestContext = new AsyncLocalStorage();

function installRequestContext() {
  /** @type {any} */ (globalThis)[REQUEST_CONTEXT] ??= { get: () => requestContext.getStore() ?? {} };
}

/** @type {Record<string, string>} */
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * @typedef {{ source: string, destination: string }} Rewrite
 * @typedef {{ source: string, destination: string, permanent?: boolean, statusCode?: number }} Redirect
 * @typedef {{ source: string, headers: { key: string, value: string }[] }} HeaderRule
 * @typedef {(request: Request) => Promise<Response>} ApiHandler
 */

/**
 * Builds a Web `Request` from a Node request, converting its body (when it
 * has one) to a Web `ReadableStream`.
 * @param {import('node:http').IncomingMessage} req
 * @param {URL} url
 * @returns {Request}
 */
function toWebRequest(req, url) {
  const method = req.method ?? 'GET';
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    for (const one of Array.isArray(value) ? value : [value]) headers.append(key, one);
  }
  const hasBody = method !== 'GET' && method !== 'HEAD';
  return new Request(url, {
    method,
    headers,
    // @ts-expect-error -- Node's Readable is accepted as a BodyInit by undici at runtime.
    body: hasBody ? Readable.toWeb(req) : undefined,
    duplex: hasBody ? 'half' : undefined,
  });
}

/**
 * Writes a Web `Response` onto a Node response, converting its body (when it
 * has one) from a Web `ReadableStream`.
 * @param {Response} response
 * @param {import('node:http').ServerResponse} res
 * @returns {Promise<void>}
 */
async function sendWebResponse(response, res) {
  res.statusCode = response.status;
  for (const [key, value] of response.headers) res.setHeader(key, value);
  const body = response.body;
  if (!body) {
    res.end();
    return;
  }
  await new Promise((resolve, reject) => {
    // The DOM lib's global `ReadableStream` (what `Response.body` is typed
    // as) and node:stream/web's `ReadableStream` (what `Readable.fromWeb`
    // expects) are structurally near-identical but not the same type.
    const nodeStream = Readable.fromWeb(/** @type {any} */ (body));
    nodeStream.pipe(res);
    nodeStream.on('end', resolve);
    nodeStream.on('error', reject);
  });
}

/**
 * Resolves `pathname` to a file under `root`, refusing to escape it.
 * @param {string} root
 * @param {string} pathname
 * @returns {string | null}
 */
function resolveStaticPath(root, pathname) {
  const safePathname = pathname === '/' ? '/index.html' : pathname;
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(resolvedRoot, `.${safePathname}`);
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(resolvedRoot + path.sep)) return null;
  return resolvedPath;
}

/** The one function's path (`api/index.js`): a rewrite to it calls the handler. */
const FUNCTION_PATH = '/api';

/**
 * The first rewrite whose `source` matches `pathname`, if any. Sources
 * are read as anchored regexes, the same way `applyHeaderRules` reads a
 * header `source`; the build only writes exact paths and unnamed groups
 * (`/api/(.*)`, `/p/(.*)`), and `createServer` refuses a named param.
 * @param {Rewrite[]} rewrites
 * @param {string} pathname
 * @returns {Rewrite|null}
 */
function matchRewrite(rewrites, pathname) {
  return rewrites.find((rewrite) => new RegExp(`^${rewrite.source}$`).test(pathname)) ?? null;
}

/**
 * Where Vercel sends `pathname`: the function (`null`), for `/api` itself
 * or a rewrite to it, else the static file path to serve.
 * @param {Rewrite[]} rewrites
 * @param {string} pathname
 * @returns {string|null}
 */
function staticTargetOf(rewrites, pathname) {
  if (pathname === FUNCTION_PATH) return null;
  const rewrite = matchRewrite(rewrites, pathname);
  if (!rewrite) return pathname;
  return rewrite.destination === FUNCTION_PATH ? null : rewrite.destination;
}

/**
 * Refuses a rewrite `source` with a named param (`/t/:id`): on Vercel it
 * adds `?id=...` to the request, which the handler refuses as an unknown
 * query param (https://vercel.com/docs/routing/rewrites). Dev would not
 * reproduce that, so it fails loudly instead.
 * @param {Rewrite[]} rewrites
 */
function assertUnnamedSources(rewrites) {
  const named = rewrites.find((rewrite) => /\/:[A-Za-z_]/.test(rewrite.source));
  if (named) throw new Error(`dev: rewrite source ${named.source} has a named param; use an unnamed group, e.g. (.*)`);
}

/**
 * Sets every header from every `vercel.json` rule whose `source` matches
 * `pathname` -- unlike a rewrite, every match applies (Vercel's own
 * `headers` config works the same way, e.g. the security headers on
 * `/(.*)` and the cache header on `/build/(.*)` both apply to a path
 * under `/build/`), so dev's CSP (and the rest) matches production on
 * every response, API routes included (review round 2, C2). `pathname`
 * is the incoming request path, never a rewrite's destination -- same
 * as Vercel, whose `headers` config matches the path the browser asked
 * for, not wherever it's rewritten to (review round 2, "also, small").
 * @param {HeaderRule[]} rules
 * @param {string} pathname
 * @param {import('node:http').ServerResponse} res
 * @returns {void}
 */
function applyHeaderRules(rules, pathname, res) {
  for (const rule of rules) {
    if (!new RegExp(`^${rule.source}$`).test(pathname)) continue;
    for (const { key, value } of rule.headers) res.setHeader(key, value);
  }
}

/**
 * The `root/404.html` body, or plain text when there is none (the repo's
 * own `test/fixtures/static` has no 404.html, for instance). Mirrors
 * Vercel's own static-output behaviour: "Emit a 404.html file to your
 * Output Directory and it will be served as the 404 page when a route
 * does not match any other static file" (vercel.com/kb/guide/custom-404-page),
 * so dev matches production for an unmatched path the same way
 * `serveStatic`'s docstring already says it does for a *matched* one.
 * @param {string} root
 * @param {import('node:http').ServerResponse} res
 * @returns {Promise<void>}
 */
async function serveNotFound(root, res) {
  res.statusCode = 404;
  try {
    const body = await readFile(path.join(path.resolve(root), '404.html'));
    res.setHeader('Content-Type', MIME_TYPES['.html']);
    res.end(body);
  } catch {
    res.end('Not Found');
  }
}

/**
 * Serves a static file from `root` for `pathname`, or `root/404.html`
 * (else plain text) when it's missing or would escape `root`. No
 * extension-guessing here: a page route like `/search` only resolves
 * through a rewrite (the same `vercel.json` rewrites production
 * uses -- `scripts/build.js`'s `pageRewriteOf` emits one per static page
 * with a `file`, review round 1, C1), so dev and production resolve a
 * URL exactly the same way.
 * @param {string} root
 * @param {string} pathname
 * @param {import('node:http').ServerResponse} res
 * @returns {Promise<void>}
 */
async function serveStatic(root, pathname, res) {
  const filePath = resolveStaticPath(root, pathname);
  if (filePath) {
    try {
      const body = await readFile(filePath);
      res.statusCode = 200;
      res.setHeader('Content-Type', MIME_TYPES[path.extname(filePath)] ?? 'application/octet-stream');
      res.end(body);
      return;
    } catch (/** @type {any} */ err) {
      if (!err || err.code !== 'ENOENT') throw err;
    }
  }
  await serveNotFound(root, res);
}

/**
 * Where `url` redirects to, as Vercel's `redirects` config would send it
 * (Task 10d: `/search?q=x` -> `/?q=x`), or `null`. `source` is a plain
 * path, matched exactly. The request's query string goes on to the
 * destination, as on Vercel ("By default, all query strings that are
 * found in the source path will be passed to the destination path",
 * https://vercel.com/kb/guide/how-do-i-perform-vercel-redirects-based-on-query-strings);
 * `permanent` is a 308, otherwise 307
 * (https://vercel.com/docs/project-configuration/vercel-json, "redirects").
 * @param {Redirect[]} redirects @param {URL} url
 * @returns {{ location: string, status: number }|null}
 */
export function redirectOf(redirects, url) {
  const match = redirects.find((r) => r.source === url.pathname);
  if (!match) return null;
  const query = url.search.slice(1);
  const joiner = match.destination.includes('?') ? '&' : '?';
  const location = query ? `${match.destination}${joiner}${query}` : match.destination;
  return { location, status: match.statusCode ?? (match.permanent === false ? 307 : 308) };
}

/**
 * Creates a dev HTTP server that mirrors Vercel's routing for the
 * generated `vercel.json`: a redirect answers first (Vercel runs
 * `redirects` before `rewrites`); then the first matching rewrite wins; one whose
 * destination is `/api` (or a request for `/api` itself) calls `handle`
 * with the *original* request URL, unchanged and with no query params
 * added, exactly what Vercel hands `api/index.js`; any other rewrite
 * serves its destination file; no match serves the path as a static
 * file. Used both for local development and, through the same contract,
 * by tests exercising the Vercel function's behaviour without Vercel.
 * @param {{ root: string, routes?: unknown[], rewrites?: Rewrite[], redirects?: Redirect[], headers?: HeaderRule[], handle: ApiHandler }} options
 * @returns {import('node:http').Server}
 */
export function createServer({ root, rewrites = [], redirects = [], headers = [], handle }) {
  installRequestContext();
  assertUnnamedSources(rewrites);
  /** @type {import('node:http').Server} */
  const server = http.createServer(async (req, res) => {
    try {
      // The Host header keeps the port, so the request URL's origin is the browser's (the Origin check).
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      // Matched against the incoming path, not the rewritten one -- same as Vercel's own
      // `headers` config (review round 2, "also, small"): a `source` names what the browser
      // actually requested, regardless of which file or function answers it.
      applyHeaderRules(headers, url.pathname, res);
      const redirect = redirectOf(redirects, url);
      if (redirect) {
        res.writeHead(redirect.status, { Location: redirect.location });
        res.end();
        return;
      }
      const file = staticTargetOf(rewrites, url.pathname);
      if (file === null) {
        await serveApi(handle, toWebRequest(req, url), res).then((results) => server.emit('waitUntilSettled', results));
        return;
      }
      await serveStatic(root, file, res);
    } catch (/** @type {any} */ err) {
      res.statusCode = err && err.code === 'ENOENT' ? 404 : 500;
      res.end(res.statusCode === 404 ? 'Not Found' : 'Internal Server Error');
    }
  });
  return server;
}

/**
 * Sends `handle`'s response, then awaits whatever it passed to `waitUntil`.
 * @param {ApiHandler} handle
 * @param {Request} request
 * @param {import('node:http').ServerResponse} res
 * @returns {Promise<PromiseSettledResult<unknown>[]>}
 */
async function serveApi(handle, request, res) {
  /** @type {Promise<unknown>[]} */
  const tasks = [];
  await requestContext.run({ waitUntil: (promise) => { tasks.push(promise); } }, async () => {
    await sendWebResponse(await handle(request), res);
  });
  return Promise.allSettled(tasks);
}

/**
 * The build output this server needs that's missing under `root` (a
 * fresh clone has none: it's all gitignored, Task 9a item 8).
 * @param {string} root
 * @returns {string[]}
 */
export function missingBuildOutput(root) {
  return ['vercel.json', 'src/site/generated.js', 'public/index.html'].filter((rel) => !existsSync(path.join(root, rel)));
}

async function main() {
  if (process.argv.includes('--watch')) {
    // `npm run dev -- --watch` (Task 10c, i): `dev` already built, so the
    // watcher serves that build and rebuilds on changes (no second build).
    const { main: watchMain } = await import('./devWatch.js');
    await watchMain({ skipFirstBuild: true });
    return;
  }
  const port = Number(process.env.PORT ?? 3000);
  const missing = missingBuildOutput('.');
  if (missing.length > 0) {
    console.error(`dev: no build yet (missing ${missing.join(', ')}): run npm run build first, or npm run dev, which builds`);
    process.exitCode = 1;
    return;
  }
  const { default: api } = await import('../api/index.js');
  const vercel = JSON.parse(await readFile('vercel.json', 'utf8'));
  const srv = createServer({ root: 'public', rewrites: vercel.rewrites ?? [], redirects: vercel.redirects ?? [], headers: vercel.headers ?? [], handle: (request) => api.fetch(request) });
  srv.listen(port, () => {
    console.log(`dev server listening on http://localhost:${port}`);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
