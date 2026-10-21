// @ts-check
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { matchRoute } from '../src/http/router.js';

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
 * @param {Rewrite} rewrite
 * @param {string} pathname
 * @returns {boolean}
 */
function matchesRewrite(rewrite, pathname) {
  return matchRoute([{ method: 'GET', path: rewrite.source }], 'GET', pathname) !== null;
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

/**
 * Applies the first matching rewrite to `pathname`, if any.
 * @param {Rewrite[]} rewrites
 * @param {string} pathname
 * @returns {string}
 */
function applyRewrites(rewrites, pathname) {
  const hit = rewrites.find((rewrite) => matchesRewrite(rewrite, pathname));
  return hit ? hit.destination : pathname;
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
  const filePath = resolveStaticPath(root, pathname);
  if (!filePath) {
    res.statusCode = 404;
    res.end('Not Found');
    return;
  }

  const body = await readFile(filePath);
  res.statusCode = 200;
  res.setHeader('Content-Type', MIME_TYPES[path.extname(filePath)] ?? 'application/octet-stream');
  res.end(body);
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
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        const response = await handle(toWebRequest(req, url));
        await sendWebResponse(response, res);
        return;
      }

      await serveStatic(root, applyRewrites(rewrites, url.pathname), res);
    } catch (/** @type {any} */ err) {
      res.statusCode = err && err.code === 'ENOENT' ? 404 : 500;
      res.end(res.statusCode === 404 ? 'Not Found' : 'Internal Server Error');
    }
  });
}

/**
 * @returns {Promise<Response>} a placeholder 404; real routing (`api/[...route].js`'s
 * handler) lands in a later task.
 */
async function notImplemented() {
  return new Response('Not Found', { status: 404 });
}

async function main() {
  const port = Number(process.env.PORT ?? 3000);
  const srv = createServer({ root: 'public', rewrites: [], handle: notImplemented });
  srv.listen(port, () => {
    console.log(`dev server listening on http://localhost:${port}`);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
