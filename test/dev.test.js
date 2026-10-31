// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from '../scripts/dev.js';

/**
 * Starts `srv` on an ephemeral port on the loopback interface and resolves
 * with its base URL once listening.
 * @param {import('node:http').Server} srv
 * @returns {Promise<string>}
 */
function listen(srv) {
  return new Promise((resolve, reject) => {
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      if (!address || typeof address === 'string') {
        reject(new Error('expected srv to listen on a TCP port'));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

/** The generated vercel.json's shape: `/api/(.*)` and each meta page to the function, static pages to their file. */
const REWRITES = [
  { source: '/api/(.*)', destination: '/api' },
  { source: '/t/(.*)', destination: '/api' },
  { source: '/p/(.*)', destination: '/event.html' },
];

test('dev server: rewrites, api dispatch, 404', async () => {
  const handle = async (req) => Response.json({ path: new URL(req.url).pathname });
  const srv = createServer({ root: 'test/fixtures/static', routes: [], rewrites: REWRITES, handle });
  const base = await listen(srv);
  assert.match(await (await fetch(base + '/p/x')).text(), /EVENT PAGE/);
  assert.deepEqual(await (await fetch(base + '/api/ping')).json(), { path: '/api/ping' });
  assert.equal((await fetch(base + '/nope.html')).status, 404);
  srv.close();
});

test('dev server: every Set-Cookie of a response reaches the browser, not just the last (as Vercel sends them)', async () => {
  const handle = async () => {
    const headers = new Headers({ 'content-type': 'application/json' });
    headers.append('set-cookie', 'sid=abc; HttpOnly; Path=/');
    headers.append('set-cookie', 'signed_in=1; Path=/');
    return new Response('{}', { headers });
  };
  const srv = createServer({ root: 'test/fixtures/static', routes: [], rewrites: REWRITES, handle });
  const base = await listen(srv);
  try {
    const res = await fetch(base + '/api/auth/dev');
    assert.deepEqual(res.headers.getSetCookie(), ['sid=abc; HttpOnly; Path=/', 'signed_in=1; Path=/']);
    assert.equal(res.headers.get('content-type'), 'application/json');
  } finally {
    srv.closeAllConnections();
    srv.close();
  }
});

test('dev server: a rewrite to /api hands the handler the original URL, query untouched and nothing added (as Vercel does)', async () => {
  /** @type {string[]} */
  const seen = [];
  const handle = async (/** @type {Request} */ req) => { seen.push(new URL(req.url).pathname + new URL(req.url).search); return new Response('ok'); };
  const srv = createServer({ root: 'test/fixtures/static', rewrites: REWRITES, handle });
  const base = await listen(srv);
  for (const path of ['/t/123', '/t/123?s=20', '/api/home', '/api/meta/t/123', '/api']) assert.equal((await fetch(base + path)).status, 200, path);
  assert.deepEqual(seen, ['/t/123', '/t/123?s=20', '/api/home', '/api/meta/t/123', '/api']);
  const none = createServer({ root: 'test/fixtures/static', rewrites: [], handle });
  const base2 = await listen(none);
  assert.equal((await fetch(base2 + '/api/home')).status, 404, 'without the /api/(.*) rewrite, /api/home is not the function (only /api is)');
  srv.close();
  none.close();
});

test('dev server: refuses a rewrite source with a named param (Vercel would add it as a query param)', () => {
  const handle = async () => new Response('ok');
  assert.throws(() => createServer({ root: 'test/fixtures/static', rewrites: [{ source: '/t/:id', destination: '/api' }], handle }), /named param/);
});

test('dev server: an unmatched path serves root/404.html with status 404 (mirrors Vercel\'s own static-output behaviour)', async () => {
  const handle = async (req) => Response.json({ path: new URL(req.url).pathname });
  const srv = createServer({ root: 'test/fixtures/static', routes: [], rewrites: [], handle });
  const base = await listen(srv);
  const res = await fetch(base + '/no-such-page');
  assert.equal(res.status, 404);
  assert.match(await res.text(), /NOT FOUND PAGE/);
  srv.close();
});

test('dev server: an unmatched path still 404s with plain text when root has no 404.html', async () => {
  const handle = async (req) => Response.json({ path: new URL(req.url).pathname });
  // test/fixtures (not .../static): no 404.html sits here.
  const srv = createServer({ root: 'test/fixtures', routes: [], rewrites: [], handle });
  const base = await listen(srv);
  const res = await fetch(base + '/no-such-page');
  assert.equal(res.status, 404);
  assert.equal(await res.text(), 'Not Found');
  srv.close();
});

test('dev server: a static page route (no :param) resolves only through an explicit rewrite, same as production -- no extension-guessing fallback (review round 1, C1)', async () => {
  const handle = async (req) => Response.json({ path: new URL(req.url).pathname });
  // No rewrite for /event here: unlike production's vercel.json (which scripts/build.js's
  // pageRewriteOf now emits one for every static page with a file), this server has none.
  const srv = createServer({ root: 'test/fixtures/static', routes: [], rewrites: [], handle });
  const base = await listen(srv);
  assert.equal((await fetch(base + '/event')).status, 404, 'no rewrite means no <path>.html guessing');

  const withRewrite = createServer({
    root: 'test/fixtures/static', routes: [], rewrites: [{ source: '/event', destination: '/event.html' }], handle,
  });
  const base2 = await listen(withRewrite);
  assert.match(await (await fetch(base2 + '/event')).text(), /EVENT PAGE/, 'an explicit rewrite (as production has) resolves it');
  srv.close();
  withRewrite.close();
});

test('dev server: a page response carries vercel.json\'s headers, CSP and Referrer-Policy included (review round 2, C2)', async () => {
  const handle = async (req) => Response.json({ path: new URL(req.url).pathname });
  const headers = [
    { source: '/(.*)', headers: [{ key: 'Content-Security-Policy', value: "default-src 'self'" }, { key: 'Referrer-Policy', value: 'no-referrer' }] },
    { source: '/build/(.*)', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
  ];
  const srv = createServer({ root: 'test/fixtures/static', rewrites: [...REWRITES, { source: '/e/(.*)', destination: '/event.html' }], headers, handle });
  const base = await listen(srv);
  const page = await fetch(base + '/e/x');
  assert.equal(page.headers.get('content-security-policy'), "default-src 'self'");
  assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(page.headers.get('cache-control'), null, 'only /build/(.*) gets Cache-Control');
  const api = await fetch(base + '/api/ping');
  assert.equal(api.headers.get('content-security-policy'), "default-src 'self'", 'the API gets it too, same as production');
  srv.close();
});

test('dev server: a header rule matches the incoming path, not a rewrite\'s destination (review round 2, "also, small")', async () => {
  const handle = async (req) => Response.json({ path: new URL(req.url).pathname });
  // Only the incoming /e/x matches this; the rewrite's destination, /event.html, never would.
  const headers = [{ source: '/e/(.*)', headers: [{ key: 'X-Incoming-Path-Rule', value: 'hit' }] }];
  const srv = createServer({ root: 'test/fixtures/static', rewrites: [...REWRITES, { source: '/e/(.*)', destination: '/event.html' }], headers, handle });
  const base = await listen(srv);
  const page = await fetch(base + '/e/x');
  assert.equal(page.headers.get('x-incoming-path-rule'), 'hit');
  srv.close();
});

test('dev server: waitUntil (from @vercel/functions) runs after the response, and the server awaits it', async () => {
  const { waitUntil } = await import('@vercel/functions');
  /** @type {(v?: unknown) => void} */
  let release = () => {};
  const gate = new Promise((resolve) => { release = resolve; });
  let done = false;
  const handle = async (/** @type {Request} */ req) => {
    waitUntil(gate.then(() => { done = true; }));
    return Response.json({ origin: new URL(req.url).origin });
  };
  const srv = createServer({ root: 'test/fixtures/static', rewrites: REWRITES, handle });
  const base = await listen(srv);
  const settled = new Promise((resolve) => srv.once('waitUntilSettled', resolve));
  const res = await fetch(base + '/api/bg');
  assert.deepEqual(await res.json(), { origin: base }, 'the request URL keeps the Host, so same-origin checks work');
  assert.equal(done, false, 'the response did not wait for the background work');
  release();
  await settled;
  assert.equal(done, true);
  srv.close();
});

test('dev server: names the build output it needs when there is none yet (a fresh clone; Task 9a item 8)', async () => {
  const { missingBuildOutput } = await import('../scripts/dev.js');
  assert.deepEqual(missingBuildOutput('test/fixtures'), ['vercel.json', 'src/site/generated.js', 'public/index.html']);
});

test('dev server (Task 10d): a redirect answers before any rewrite, 308, keeping the query string (as Vercel passes it on)', async () => {
  /** @type {string[]} */
  const seen = [];
  const handle = async (/** @type {Request} */ req) => { seen.push(req.url); return new Response('ok'); };
  const redirects = [{ source: '/search', destination: '/', permanent: true }];
  const srv = createServer({ root: 'test/fixtures/static', rewrites: [...REWRITES, { source: '/search', destination: '/api' }], redirects, handle });
  const base = await listen(srv);
  for (const [path, location] of [['/search?q=x', '/?q=x'], ['/search', '/'], ['/search?people=1&people=2&q=%E0%B8%84', '/?people=1&people=2&q=%E0%B8%84']]) {
    const res = await fetch(base + path, { redirect: 'manual' });
    assert.equal(res.status, 308, path);
    assert.equal(res.headers.get('location'), location, path);
  }
  assert.equal((await fetch(base + '/search/x', { redirect: 'manual' })).status, 404, 'only the exact path redirects');
  assert.deepEqual(seen, [], 'the redirect never reaches the function');
  srv.close();
});

test('redirectOf (Task 10d): 307 when not permanent, an explicit statusCode wins, a destination query is joined with &', async () => {
  const { redirectOf } = await import('../scripts/dev.js');
  const url = new URL('http://x/old?q=1');
  assert.deepEqual(redirectOf([{ source: '/old', destination: '/new', permanent: false }], url), { location: '/new?q=1', status: 307 });
  assert.deepEqual(redirectOf([{ source: '/old', destination: '/new?a=b', statusCode: 301 }], url), { location: '/new?a=b&q=1', status: 301 });
  assert.equal(redirectOf([{ source: '/other', destination: '/' }], url), null);
});

test('dev server (Styling system Task 3): GET /dev/styleguide serves the generated file straight from disk, 404 (never root/404.html) without it', async () => {
  const handle = async (req) => Response.json({ path: new URL(req.url).pathname });
  const dir = mkdtempSync(path.join(tmpdir(), 'fan-archive-styleguide-'));
  try {
    const missing = createServer({ root: 'test/fixtures/static', rewrites: [], handle, devStyleguidePath: path.join(dir, 'index.html') });
    const base1 = await listen(missing);
    const res1 = await fetch(base1 + '/dev/styleguide');
    assert.equal(res1.status, 404);
    assert.equal(await res1.text(), 'Not Found');
    missing.close();

    writeFileSync(path.join(dir, 'index.html'), '<p>STYLE GUIDE PAGE</p>');
    const present = createServer({ root: 'test/fixtures/static', rewrites: [], handle, devStyleguidePath: path.join(dir, 'index.html') });
    const base2 = await listen(present);
    const res2 = await fetch(base2 + '/dev/styleguide');
    assert.equal(res2.status, 200);
    assert.equal(res2.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.match(await res2.text(), /STYLE GUIDE PAGE/);
    present.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('dev server (DEV_AS): a page load with no session goes to the dev sign-in first; API calls, assets and marked browsers do not', async () => {
  const handle = async () => new Response('ok');
  const srv = createServer({ root: 'test/fixtures/static', rewrites: REWRITES, handle, devAs: 'owner' });
  const base = await listen(srv);
  const html = { accept: 'text/html,application/xhtml+xml' };
  const page = await fetch(base + '/p/x?y=1', { headers: html, redirect: 'manual' });
  assert.equal(page.status, 302);
  assert.equal(page.headers.get('location'), `/api/auth/dev?as=owner&returnTo=${encodeURIComponent('/p/x?y=1')}`);
  assert.equal((await fetch(base + '/api/home', { headers: html, redirect: 'manual' })).status, 200, 'never the API itself');
  assert.equal((await fetch(base + '/p/x', { redirect: 'manual' })).status, 200, 'a fetch() that does not ask for HTML');
  for (const cookie of ['sid=abc', 'dev_as=guest']) {
    assert.equal((await fetch(base + '/p/x', { headers: { ...html, cookie }, redirect: 'manual' })).status, 200, cookie);
  }
  const off = createServer({ root: 'test/fixtures/static', rewrites: REWRITES, handle });
  const base2 = await listen(off);
  assert.equal((await fetch(base2 + '/p/x', { headers: html, redirect: 'manual' })).status, 200, 'without DEV_AS nothing changes');
  srv.close();
  off.close();
});
