// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
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

test('dev server: rewrites, api dispatch, 404', async () => {
  const handle = async (req) => Response.json({ path: new URL(req.url).pathname });
  const srv = createServer({
    root: 'test/fixtures/static',
    routes: [],
    rewrites: [{ source: '/e/:slug', destination: '/event.html' }],
    handle,
  });
  const base = await listen(srv);
  assert.match(await (await fetch(base + '/e/x')).text(), /EVENT PAGE/);
  assert.deepEqual(await (await fetch(base + '/api/ping')).json(), { path: '/api/ping' });
  assert.equal((await fetch(base + '/nope.html')).status, 404);
  srv.close();
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
  const srv = createServer({ root: 'test/fixtures/static', handle });
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
