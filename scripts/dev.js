// @ts-check
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { AsyncLocalStorage } from 'node:async_hooks';
import { matchRoute } from '../src/http/router.js';

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
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(resolvedRoot, `.${pathname}`);
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(resolvedRoot + path.sep)) return null;
  return resolvedPath;
}

/**
 * The pathnames to try, in order, for a request -- mirroring Vercel's own
 * default static-file resolution (scripts/build.js's `pageRewriteOf`:
 * "a static path ... resolves to its file by name already"), which this
 * dev server otherwise has no equivalent for. `/` is `/index.html`; a
 * trailing slash is dropped (Vercel redirects `/search/` to `/search`
 * before resolving it); and a path with no extension (a page route like
 * `/search`, from `src/pages.js`) also tries `<path>.html`.
 * @param {string} pathname
 * @returns {string[]}
 */
function staticCandidates(pathname) {
  if (pathname === '/') return ['/index.html'];
  const withoutTrailingSlash = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  return path.extname(withoutTrailingSlash) ? [withoutTrailingSlash] : [withoutTrailingSlash, `${withoutTrailingSlash}.html`];
}

/**
 * Applies the first matching rewrite to `pathname`, if any, filling the
 * destination's `:param`s from the match (as Vercel does).
 * @param {Rewrite[]} rewrites
 * @param {string} pathname
 * @returns {string}
 */
function applyRewrites(rewrites, pathname) {
  for (const rewrite of rewrites) {
    const hit = matchRoute([{ method: 'GET', path: rewrite.source }], 'GET', pathname);
    if (hit) return rewrite.destination.replace(/:([A-Za-z_]\w*)/g, (whole, name) => (Object.hasOwn(hit.params, name) ? encodeURIComponent(hit.params[name]) : whole));
  }
  return pathname;
}

/**
 * Serves a static file from `root` for `pathname`, or a 404 when it's
 * missing or would escape `root`.
 * @param {string} root
 * @param {string} pathname
 * @param {import('node:http').ServerResponse} res
 * @returns {Promise<void>}
 */
async function serveStatic(root, pathname, res) {
  for (const candidate of staticCandidates(pathname)) {
    const filePath = resolveStaticPath(root, candidate);
    if (!filePath) continue;
    try {
      const body = await readFile(filePath);
      res.statusCode = 200;
      res.setHeader('Content-Type', MIME_TYPES[path.extname(filePath)] ?? 'application/octet-stream');
      res.end(body);
      return;
    } catch (/** @type {any} */ err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }
  res.statusCode = 404;
  res.end('Not Found');
}

/**
 * Creates a dev HTTP server that serves static files from `root`, applies
 * page rewrites, and sends `/api/*` requests to `handle`. Used both for
 * local development and, through the same contract, by tests exercising the
 * Vercel function's behaviour without Vercel.
 * @param {{ root: string, routes?: unknown[], rewrites?: Rewrite[], handle: ApiHandler }} options
 * @returns {import('node:http').Server}
 */
export function createServer({ root, rewrites = [], handle }) {
  installRequestContext();
  /** @type {import('node:http').Server} */
  const server = http.createServer(async (req, res) => {
    try {
      // The Host header keeps the port, so the request URL's origin is the browser's (the Origin check).
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const target = url.pathname.startsWith('/api/') ? url : new URL(applyRewrites(rewrites, url.pathname), url);
      if (target.pathname.startsWith('/api/')) {
        await serveApi(handle, toWebRequest(req, target), res).then((results) => server.emit('waitUntilSettled', results));
        return;
      }

      await serveStatic(root, target.pathname, res);
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

async function main() {
  const port = Number(process.env.PORT ?? 3000);
  const { default: api } = await import('../api/[...route].js');
  const vercel = JSON.parse(await readFile('vercel.json', 'utf8'));
  const srv = createServer({ root: 'public', rewrites: vercel.rewrites ?? [], handle: (request) => api.fetch(request) });
  srv.listen(port, () => {
    console.log(`dev server listening on http://localhost:${port}`);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
