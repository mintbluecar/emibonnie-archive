// @ts-check
/** Plan 3 Task 10: the marker cards, the publish bar and the retry loop. */
import '../helpers/siteFixture.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MiniElement } from '../helpers/miniDom.js';
import { mount } from '../../public/js/core/dom.js';
import { postJson } from '../../public/js/core/api.js';
import { copyRe } from '../helpers/copyMarkup.js';
import { withGlobals } from '../helpers/globals.js';
const { render, bind } = await import('../../public/js/components/importSpeakers.js');
const { t } = await import('../../public/js/core/site.js');

const PEOPLE = [
  { id: 5, displayName: 'host', igHandle: 'host_x' },
  { id: 6, displayName: 'luna', igHandle: 'lunamoon' },
];
const ROLES = ['fan', 'guest'];

/** @param {Partial<any>} [overrides] */
function state(overrides = {}) {
  return {
    jobId: 7,
    markers: [],
    expanded: new Set(),
    remember: true,
    ...overrides,
  };
}

/** @param {Partial<any>} [overrides] */
function group(overrides = {}) {
  return {
    accountId: 3,
    handle: 'tl_alpha',
    markers: [
      {
        marker: '☀️', count: 2, example: 'sun line one',
        entries: [
          { itemId: 21, kind: 'translation', sourceId: '111', text: 'sun line one' },
          { itemId: 22, kind: 'translation', sourceId: '112', text: 'sun line two' },
        ],
      },
    ],
    ...overrides,
  };
}

/** @param {string} markup @returns {string[]} */
function selectsOf(markup) {
  return [...markup.matchAll(/<select[\s\S]*?<\/select>/g)].map((m) => m[0]);
}

test('a marker card shows its handle, entry count, example and a select of people then roles', () => {
  const markup = String(render({ markers: [group()], people: PEOPLE, roles: ROLES, expanded: new Set(), remember: true }));
  assert.match(markup, /@tl_alpha/);
  assert.match(markup, /2/, 'the marker count');
  assert.match(markup, /sun line one/, 'the example line');

  const [select] = selectsOf(markup);
  assert.ok(select, 'the marker has a select');
  assert.match(select, /<option value="person:5"/);
  assert.match(select, /<option value="person:6"/);
  assert.match(select, /<option value="role:fan"/);
  assert.ok(select.indexOf('person:5') < select.indexOf('role:fan'), 'people come before roles');

  assert.match(markup, /data-remember/, 'the remember checkbox');
  assert.match(markup, /checked/, 'remember is on by default');
  assert.match(markup, copyRe(t('import.marker.remember')));
});

test('review expands the marker into per-entry selects with their text', () => {
  const collapsed = String(render({ markers: [group()], people: PEOPLE, roles: ROLES, expanded: new Set(), remember: true }));
  assert.match(collapsed, /data-action="review"/);
  assert.ok(!collapsed.includes('data-entry-select'), 'collapsed: no per-entry select');

  const expanded = String(render({
    markers: [group()], people: PEOPLE, roles: ROLES,
    expanded: new Set(['3:☀️']), remember: true,
  }));
  const entrySelects = [...expanded.matchAll(/data-entry-select="(\d+)"/g)].map((m) => m[1]);
  assert.deepEqual(entrySelects, ['21', '22']);
  assert.match(expanded, /sun line one/);
  assert.match(expanded, /sun line two/);
});

test('a marker used twice shows the check note; a frequent one does not', () => {
  const twice = String(render({ markers: [group()], people: PEOPLE, roles: ROLES, expanded: new Set(), remember: true }));
  assert.match(twice, copyRe(t('import.marker.check')));

  const often = group({ markers: [{ marker: '☀️', count: 9, example: 'x', entries: [] }] });
  const many = String(render({ markers: [often], people: PEOPLE, roles: ROLES, expanded: new Set(), remember: true }));
  assert.ok(!many.includes(t('import.marker.check')));
});

test('an empty marker table says so', () => {
  const markup = String(render({ markers: [], people: [], roles: [], expanded: new Set(), remember: true }));
  assert.match(markup, copyRe(t('import.speakers.empty')));
});

test('saving a marker posts the account, marker, speaker and remember, then reloads', async () => {
  /** @type {{ url: string, body: any }[]} */
  const calls = [];
  await withGlobals({
    fetch: /** @type {any} */ (async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) });
      return Response.json({ updated: 2 });
    }),
  }, async () => {
    const st = state({ markers: [group()], remember: false });
    const root = new MiniElement('div');
    mount(root, render({ markers: st.markers, people: PEOPLE, roles: ROLES, expanded: new Set(), remember: st.remember }));
    let reloads = 0;
    bind(/** @type {any} */ (root), {
      state: st,
      map: (body) => postJson(`/api/owner/imports/${st.jobId}/map`, body),
      reload: async () => { reloads += 1; },
    });

    /** @type {any} */ (root.querySelector('[data-marker-select]')).value = 'person:6';
    /** @type {any} */ (root.querySelector('[data-action="save-marker"]')).click();
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/api/owner/imports/7/map');
    assert.deepEqual(calls[0].body, { accountId: 3, marker: '☀️', speaker: { person: 6 }, remember: false });
    assert.equal(reloads, 1);
  });
});

test('review toggles the marker open and closed and remembers the choice', async () => {
  const st = state({ markers: [group()] });
  const root = new MiniElement('div');
  mount(root, render({ markers: st.markers, people: PEOPLE, roles: ROLES, expanded: st.expanded, remember: st.remember }));
  let reloads = 0;
  bind(/** @type {any} */ (root), { state: st, map: async () => ({}), reload: async () => { reloads += 1; } });
  /** @type {any} */ (root.querySelector('[data-action="review"]')).click();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(st.expanded.has('3:☀️'));
  assert.equal(reloads, 1);
});

test('remember toggles the state the next save sends', async () => {
  const st = state({ markers: [group()] });
  const root = new MiniElement('div');
  mount(root, render({ markers: st.markers, people: PEOPLE, roles: ROLES, expanded: st.expanded, remember: st.remember }));
  bind(/** @type {any} */ (root), { state: st, map: async () => ({}), reload: async () => {} });
  const box = /** @type {any} */ (root.querySelector('[data-remember]'));
  box.checked = false;
  box.dispatchEvent({ type: 'change', target: box });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(st.remember, false);
});

test('publish ready and all post their scope and reload', async () => {
  /** @type {{ url: string, body: any }[]} */
  const calls = [];
  await withGlobals({
    fetch: /** @type {any} */ (async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) });
      return Response.json({ published: 1 });
    }),
  }, async () => {
    const st = state();
    const root = new MiniElement('div');
    mount(root, render({ markers: [], people: PEOPLE, roles: ROLES, expanded: new Set(), remember: true }));
    let reloads = 0;
    bind(/** @type {any} */ (root), { state: st, map: async () => ({}), reload: async () => { reloads += 1; } });

    /** @type {any} */ (root.querySelector('[data-action="publish-ready"]')).click();
    await new Promise((resolve) => setTimeout(resolve, 10));
    /** @type {any} */ (root.querySelector('[data-action="publish-all"]')).click();
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.deepEqual(calls.map((call) => call.url), [
      '/api/owner/imports/7/publish',
      '/api/owner/imports/7/publish',
    ]);
    assert.deepEqual(calls.map((call) => call.body.scope), ['ready', 'all']);
    assert.equal(reloads, 2);
  });
});

test('the retry loop keeps posting until remaining is 0 and reports the processed count', async () => {
  const replies = [{ processed: 4, remaining: 3 }, { processed: 3, remaining: 0 }];
  /** @type {string[]} */
  const calls = [];
  await withGlobals({
    fetch: /** @type {any} */ (async (url) => {
      calls.push(String(url));
      return Response.json(replies.shift());
    }),
  }, async () => {
    const st = state();
    const root = new MiniElement('div');
    mount(root, render({ markers: [], people: PEOPLE, roles: ROLES, expanded: new Set(), remember: true }));
    let reloads = 0;
    bind(/** @type {any} */ (root), { state: st, map: async () => ({}), reload: async () => { reloads += 1; } });

    /** @type {any} */ (root.querySelector('[data-action="retry-import"]')).click();
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.deepEqual(calls, ['/api/owner/imports/7/retry', '/api/owner/imports/7/retry']);
    const status = /** @type {any} */ (root.querySelector('[data-import-speakers-status]'));
    assert.match(String(status?.textContent), /7/, 'the total processed count');
    assert.equal(reloads, 1);
  });
});
