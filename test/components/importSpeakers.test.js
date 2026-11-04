// @ts-check
/** Plan 3 Task 10: the marker cards, the publish bar and the retry loop. */
import '../helpers/siteFixture.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MiniElement } from '../helpers/miniDom.js';
import { mount, mountPage } from '../../public/js/core/dom.js';
import { ShellHtml } from '../../public/js/core/html.js';
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

test('the card, select, buttons and remember box are primitives', () => {
  const markup = String(render({ markers: [group()], people: PEOPLE, roles: ROLES, expanded: new Set(['3:☀️']), remember: true }));
  assert.match(markup, /<article class="card card--compact stack stack--2"[^>]*data-speaker-card>/);
  assert.match(markup, /<span class="field__select"><select data-marker-select=/);
  assert.match(markup, /<span class="field__select"><select data-entry-select=/);
  assert.match(markup, /<button class="btn btn--secondary btn--sm" type="button" data-action="save-marker"/);
  assert.match(markup, /<button class="btn btn--secondary btn--sm" type="button" data-action="review"[^>]*aria-expanded="true"/);
  assert.match(markup, /<button class="btn btn--secondary btn--sm btn--icon" type="button" data-action="save-entry"[^>]*aria-label="[^"]+"/);
  assert.match(markup, /<label class="check meta c-import-speakers__remember">/);
  const collapsed = String(render({ markers: [group()], people: PEOPLE, roles: ROLES, expanded: new Set(), remember: true }));
  assert.match(collapsed, /data-action="review"[^>]*aria-expanded="false"/);
  for (const action of ['publish-ready', 'publish-all', 'retry-import']) {
    assert.match(markup, new RegExp(`<button class="btn btn--secondary btn--sm" type="button" data-action="${action}">`));
  }
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

test('review still opens a marker after the page has repainted and bound again (the owner bug: it did nothing)', async () => {
  const st = state({ markers: [group()] });
  const root = new MiniElement('div');
  let reloads = 0;
  const paint = () => {
    mountPage(/** @type {any} */ (root), new ShellHtml(String(render({ markers: st.markers, people: PEOPLE, roles: ROLES, expanded: st.expanded, remember: st.remember }))));
    bind(/** @type {any} */ (root), { state: st, map: async () => ({}), reload: async () => { reloads += 1; paint(); } });
  };
  paint();
  paint();
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

test('retryJob sends the cursor back and stops at remaining 0', async () => {
  const replies = [{ processed: 4, remaining: 3, lastId: 44 }, { processed: 3, remaining: 0, lastId: 77 }];
  /** @type {{ url: string, body: any }[]} */
  const calls = [];
  await withGlobals({
    fetch: /** @type {any} */ (async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) });
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

    assert.deepEqual(calls.map((c) => c.url), ['/api/owner/imports/7/retry', '/api/owner/imports/7/retry']);
    assert.deepEqual(calls.map((c) => c.body), [{ afterId: 0 }, { afterId: 44 }], 'the second call carries the first reply\'s cursor');
    const status = /** @type {any} */ (root.querySelector('[data-import-speakers-status]'));
    assert.match(String(status?.textContent), /7/, 'the total processed count');
    assert.equal(reloads, 1, 'stops once remaining is 0, instead of looping to the 200-attempt cap');
  });
});

test('the select offers a new person and "not a speaker" between the people and the roles', () => {
  const [select] = selectsOf(String(render({ markers: [group()], people: PEOPLE, roles: ROLES, expanded: new Set(), remember: true })));
  assert.match(select, copyRe(t('import.marker.newPerson')));
  assert.match(select, copyRe(t('import.marker.notSpeaker')));
  assert.ok(select.indexOf('person:6') < select.indexOf('value="new"'), 'people first');
  assert.ok(select.indexOf('value="plain"') < select.indexOf('role:fan'), 'roles last');
});

/**
 * Renders and binds one card against a fake fetch, returning the requests it made.
 * @param {{ remember?: boolean, respond?: (url: string) => Response }} [opts]
 */
async function withCard({ remember = true, respond = () => Response.json({ updated: 1 }) } = {}, fn) {
  /** @type {{ url: string, body: any }[]} */
  const calls = [];
  await withGlobals({
    fetch: /** @type {any} */ (async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) });
      return respond(String(url));
    }),
  }, async () => {
    const st = state({ markers: [group()], remember });
    const root = new MiniElement('div');
    mount(root, render({ markers: st.markers, people: PEOPLE, roles: ROLES, expanded: new Set(), remember: st.remember }));
    bind(/** @type {any} */ (root), { state: st, map: (body) => postJson(`/api/owner/imports/${st.jobId}/map`, body), reload: async () => {} });
    await fn(root);
  });
  return calls;
}

/** @param {any} root @param {string} value */
function choose(root, value) {
  const select = root.querySelector('[data-marker-select]');
  select.value = value;
  select.dispatchEvent({ type: 'change', target: select });
}

/** @param {any} root */
async function saveMarker(root) {
  root.querySelector('[data-action="save-marker"]').click();
  await new Promise((resolve) => setTimeout(resolve, 10));
}

test('choosing a new person opens its name and handle fields; choosing someone else closes them', async () => {
  await withCard({}, async (root) => {
    const fields = /** @type {any} */ (root.querySelector('[data-new-person]'));
    choose(root, 'new');
    assert.equal(fields.hidden, false);
    choose(root, 'person:5');
    assert.equal(fields.hidden, true);
  });
});

test('saving a new person creates them, then maps the marker to their id', async () => {
  const calls = await withCard({
    respond: (url) => (url === '/api/people' ? Response.json({ id: 42 }) : Response.json({ updated: 2 })),
  }, async (root) => {
    choose(root, 'new');
    /** @type {any} */ (root.querySelector('[data-new-name]')).value = ' Juniper ';
    /** @type {any} */ (root.querySelector('[data-new-handle]')).value = 'juniper.x';
    await saveMarker(root);
  });
  assert.deepEqual(calls.map((c) => c.url), ['/api/people', '/api/owner/imports/7/map']);
  assert.deepEqual(calls[0].body, { displayName: 'Juniper', igHandle: 'juniper.x' });
  assert.deepEqual(calls[1].body, { accountId: 3, marker: '☀️', speaker: { person: 42 }, remember: true });
});

test('a new person with no handle posts nothing and says they could not be added', async () => {
  let status = '';
  const calls = await withCard({}, async (root) => {
    choose(root, 'new');
    /** @type {any} */ (root.querySelector('[data-new-name]')).value = 'Juniper';
    await saveMarker(root);
    status = root.querySelector('[data-import-speakers-status]').textContent;
  });
  assert.equal(calls.length, 0);
  assert.equal(status, t('add.personFailed'));
});

test('"not a speaker" maps the marker to plain text and is never remembered', async () => {
  const calls = await withCard({ remember: true }, async (root) => {
    choose(root, 'plain');
    await saveMarker(root);
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body, { accountId: 3, marker: '☀️', speaker: { plain: true }, remember: false });
});

test('the "translator unknown" card sends accountId null, not a number', async () => {
  /** @type {any[]} */
  const bodies = [];
  await withGlobals({
    fetch: /** @type {any} */ (async (_url, init) => { bodies.push(JSON.parse(String(init?.body ?? '{}'))); return Response.json({ updated: 1 }); }),
  }, async () => {
    const st = state({ markers: [group({ accountId: null, handle: null })] });
    const root = new MiniElement('div');
    mount(root, render({ markers: st.markers, people: PEOPLE, roles: ROLES, expanded: new Set(), remember: true }));
    bind(/** @type {any} */ (root), { state: st, map: (body) => postJson('/api/owner/imports/7/map', body), reload: async () => {} });
    choose(root, 'role:fan');
    await saveMarker(root);
  });
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].accountId, null);
});

test('a save that changes nothing says so and does not reload', async () => {
  let status = '';
  let reloads = 0;
  await withGlobals({ fetch: /** @type {any} */ (async () => Response.json({ updated: 0 })) }, async () => {
    const st = state({ markers: [group()] });
    const root = new MiniElement('div');
    mount(root, render({ markers: st.markers, people: PEOPLE, roles: ROLES, expanded: new Set(), remember: true }));
    bind(/** @type {any} */ (root), { state: st, map: (body) => postJson('/api/owner/imports/7/map', body), reload: async () => { reloads += 1; } });
    choose(root, 'role:fan');
    await saveMarker(root);
    status = /** @type {any} */ (root.querySelector('[data-import-speakers-status]')).textContent;
  });
  assert.equal(status, t('import.marker.nothing'));
  assert.equal(reloads, 0);
});

test('review opens a marker on the "translator unknown" card too', async () => {
  const st = state({ markers: [group({ accountId: null, handle: null })] });
  const root = new MiniElement('div');
  const paint = () => {
    mount(root, render({ markers: st.markers, people: PEOPLE, roles: ROLES, expanded: st.expanded, remember: st.remember }));
  };
  paint();
  bind(/** @type {any} */ (root), { state: st, map: async () => ({}), reload: async () => { paint(); } });
  /** @type {any} */ (root.querySelector('[data-action="review"]')).click();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(root.querySelector('[data-entry-select]'), 'the entries are open');
});
