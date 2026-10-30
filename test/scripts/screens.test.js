// @ts-check
/**
 * `npm run screens` (scripts/screens.js, Styling system Task 7): the two
 * pure parts, which need no server or browser.
 * - `pagesFor(role, api)`: the page list for a role, discovered through a
 *   stub API shaped like the real one (`/api/home`, `/api/event/:slug`,
 *   `/api/filters`, `/api/owner/imports`).
 * - `outPathFor(role, width, theme, name)`: the screenshot's path under
 *   the gallery's output dir.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pagesFor, outPathFor } from '../../scripts/screens.js';

/** A stub API with one event, one item, two people, one translator, and one import job. */
const FIXTURE = {
  '/api/home': { months: [{ events: [{ slug: 'an-event' }] }] },
  '/api/event/an-event': {
    sections: [{ items: [{ kind: 'translation', sourceId: '42', url: '/t/42', lines: [{ text: 'hello world' }] }] }],
  },
  '/api/filters': {
    people: [{ igHandle: 'solsunny' }, { igHandle: 'lunamoon' }],
    accounts: [{ handle: 'tl_alpha' }],
  },
  '/api/owner/imports': { jobs: [{ id: 7 }, { id: 3 }] },
};

/** @param {Record<string, any>} fixture @returns {(path: string) => Promise<any>} */
function stubApi(fixture) {
  return async (path) => fixture[path] ?? null;
}

test('pagesFor: the common pages every role gets, discovered through the API', async () => {
  const pages = await pagesFor('guest', stubApi(FIXTURE));
  const paths = pages.map((p) => p.path);
  assert.ok(paths.includes('/'), 'home');
  assert.ok(paths.includes('/e/an-event'), 'the first event');
  assert.ok(paths.includes('/t/42'), "the first event's first item");
  assert.ok(paths.includes('/p/solsunny') && paths.includes('/p/lunamoon'), 'every listed person');
  assert.ok(paths.includes('/tl/tl_alpha'), 'the first translator');
  assert.ok(paths.some((p) => p.startsWith('/?q=')), 'a search');
  assert.ok(paths.includes('/about') && paths.includes('/privacy') && paths.includes('/takedown'));
  assert.ok(paths.includes('/this-page-does-not-exist'), 'a 404');
});

test('pagesFor: owner adds the edit and import review pages, plus /me and /add', async () => {
  const pages = await pagesFor('owner', stubApi(FIXTURE));
  const paths = pages.map((p) => p.path);
  assert.ok(paths.includes('/me'));
  assert.ok(paths.includes('/add'));
  assert.ok(paths.includes('/edit/translation/42'), 'the first item, by kind and sourceId');
  assert.ok(paths.includes('/admin/imports/7'), 'the newest job (jobs[0])');
});

test('pagesFor: owner with no import jobs gets no import review page', async () => {
  const noJobs = { ...FIXTURE, '/api/owner/imports': { jobs: [] } };
  const pages = await pagesFor('owner', stubApi(noJobs));
  assert.ok(!pages.some((p) => p.path.startsWith('/admin/imports/')));
});

test('pagesFor: translator only adds /me', async () => {
  const pages = await pagesFor('translator', stubApi(FIXTURE));
  const added = pages.filter((p) => p.path === '/me' || p.path === '/add' || p.path.startsWith('/edit/') || p.path.startsWith('/admin/imports/'));
  assert.deepEqual(added.map((p) => p.path), ['/me']);
});

test('pagesFor: member adds /me and /add', async () => {
  const pages = await pagesFor('member', stubApi(FIXTURE));
  const added = pages.filter((p) => p.path === '/me' || p.path === '/add' || p.path.startsWith('/edit/') || p.path.startsWith('/admin/imports/'));
  assert.deepEqual(added.map((p) => p.path).sort(), ['/add', '/me']);
});

test('pagesFor: guest has no owner pages (no edit, add or import review)', async () => {
  const pages = await pagesFor('guest', stubApi(FIXTURE));
  assert.ok(!pages.some((p) => p.path === '/add'));
  assert.ok(!pages.some((p) => p.path.startsWith('/edit/')));
  assert.ok(!pages.some((p) => p.path.startsWith('/admin/imports/')));
  assert.ok(pages.some((p) => p.path === '/me'), 'still visits /me, signed out');
});

test('pagesFor: a seed with no event skips the event/item pages, not the rest', async () => {
  const bare = { '/api/home': { months: [] }, '/api/filters': { people: [], accounts: [] } };
  const pages = await pagesFor('guest', stubApi(bare));
  const paths = pages.map((p) => p.path);
  assert.ok(!paths.some((p) => p.startsWith('/e/') || p.startsWith('/t/')));
  assert.ok(paths.includes('/') && paths.includes('/about'));
});

test('outPathFor: role, width, theme and a safe filename from the page name', () => {
  assert.equal(outPathFor('owner', 390, 'light', 'home'), 'owner/390-light/home.png');
  assert.equal(outPathFor('guest', 1280, 'dark', 'first event'), 'guest/1280-dark/first-event.png');
});

test('outPathFor: a name with punctuation still makes a plain filename', () => {
  const out = outPathFor('member', 390, 'light', 'person @weird/handle!');
  assert.equal(out, 'member/390-light/person-weird-handle.png');
});
