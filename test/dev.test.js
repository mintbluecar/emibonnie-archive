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
