// @ts-check
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { IDS } from '../helpers/fixtures.js';
import { seededDeps, itemIdOf, SYSTEM } from '../helpers/ingest.js';
import { apiFor } from '../helpers/api.js';
import { injectMeta, escapeAttr } from '../../src/services/meta.js';

const SLUG = 'solluna-happy-day-2026-10-19';

/** @type {any} */
let deps;
before(async () => { deps = await seededDeps(); });
after(async () => { await deps.db.end(); });

/** @param {string} html @param {string} key */
function metaContent(html, key) {
  const m = new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)"`).exec(html);
  return m ? m[1] : null;
}

test('/t/<LONG>: the item page HTML with og:title, the first preview line as description, logo, twitter:card', async () => {
  const res = await apiFor(deps).call('GET', `/t/${IDS.LONG}`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /^text\/html/);
  const html = res.text;
  assert.match(html, /ITEM PAGE \$& \$' \$1/, 'the fixture page, untouched by replacement patterns');
  assert.equal((html.match(/<title>/g) ?? []).length, 1);
  assert.match(html, /<title>SOLLUNA AT STARFEST · solluna archive<\/title>/);
  assert.equal(metaContent(html, 'og:title'), 'SOLLUNA AT STARFEST · solluna archive');
  assert.equal(metaContent(html, 'og:description'), 'Can you tell everyone what it felt like when the lights went down for the countdown?');
  assert.equal(metaContent(html, 'og:image'), 'https://archive.example/site/logo.svg');
  assert.equal(metaContent(html, 'twitter:card'), 'summary');
});

test('the description is attribute-escaped and at most 200 characters', async () => {
  const id = await itemIdOf(deps.db, IDS.EVENT_A);
  const hostile = `☀️: "><script>alert(1)</script> & 'quoted' ${'x'.repeat(300)}`;
  const [part] = (await deps.db.query('select body from translation_parts where item_id = $1 order by position limit 1', [id])).rows;
  await deps.db.transaction((/** @type {any} */ tx) => tx.query(
    'update translation_parts set body = $2 where item_id = $1 and position = 0', [id, `${hostile}\n${part.body}`],
  ), SYSTEM);
  try {
    const html = (await apiFor(deps).call('GET', `/t/${IDS.EVENT_A}`)).text;
    assert.ok(!html.includes('<script>'), 'no raw tag');
    const description = metaContent(html, 'og:description') ?? '';
    assert.ok(description.startsWith('&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt; &amp; &#39;quoted&#39; xxx'), description);
    const decoded = description.replace(/&(quot|gt|lt|amp|#39);/g, 'X');
    assert.ok([...decoded].length <= 200, `${[...decoded].length}`);
  } finally {
    await deps.db.transaction((/** @type {any} */ tx) => tx.query('update translation_parts set body = $2 where item_id = $1 and position = 0', [id, part.body]), SYSTEM);
  }
});

test('a removed, unknown or opted-out item gets only the generic site meta, with no tweet text', async () => {
  const id = await itemIdOf(deps.db, IDS.LONG);
  await deps.db.transaction((/** @type {any} */ tx) => tx.query("update items set deleted_at = now(), deleted_reason = 'spam' where id = $1", [id]), SYSTEM);
  try {
    for (const path of [`/t/${IDS.LONG}`, '/t/1', `/t/${'9'.repeat(30)}`]) {
      const res = await apiFor(deps).call('GET', path);
      assert.equal(res.status, 200, path);
      assert.equal(res.headers.get('cache-control'), 'public, s-maxage=60', `${path}: cached like a 404`);
      assert.equal(metaContent(res.text, 'og:title'), 'solluna archive', path);
      assert.equal(metaContent(res.text, 'og:description'), deps.site.tagline, path);
      assert.ok(!res.text.includes('countdown'), path);
      assert.ok(!res.text.includes('STARFEST'), path);
    }
  } finally {
    await deps.db.transaction((/** @type {any} */ tx) => tx.query('update items set deleted_at = null, deleted_reason = null where id = $1', [id]), SYSTEM);
  }
});

test('/e/<slug>: the event page with the event name; a hidden or unknown event gets the generic meta', async () => {
  const res = await apiFor(deps).call('GET', `/e/${SLUG}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'public, s-maxage=300, stale-while-revalidate=86400, stale-if-error=86400');
  const shown = await apiFor(deps).call('GET', `/t/${IDS.LONG}`);
  assert.equal(shown.headers.get('cache-control'), 'public, s-maxage=300, stale-while-revalidate=86400, stale-if-error=86400', 'a visible item: the full cache');
  assert.match(res.text, /<title>SOLLUNA HAPPY DAY · solluna archive<\/title>/);
  assert.match(res.text, /EVENT PAGE/);
  assert.equal(metaContent(res.text, 'og:description'), '2026-10-19 · #SLHappyDay2026');
  const missing = await apiFor(deps).call('GET', '/e/no-such-event');
  assert.equal(missing.status, 200);
  assert.equal(missing.headers.get('cache-control'), 'public, s-maxage=60');
  assert.equal((await apiFor(deps).call('GET', '/e/no-such-event')).headers.get('cache-control'), 'public, s-maxage=60');
  assert.equal(metaContent(missing.text, 'og:title'), 'solluna archive');
});

test('without a built page, a minimal shell carries the meta', () => {
  const html = injectMeta(null, { title: 'a "b"', description: 'c', image: null });
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /<title>a &quot;b&quot;<\/title>/);
  assert.equal(metaContent(html, 'og:image'), null);
  assert.equal(escapeAttr(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
});

test('injectMeta replaces a page\'s own title, og:*, twitter:* and description tags', () => {
  const page = `<!doctype html><html><head>
<meta charset="utf-8">
<title>Old title</title>
<meta property="og:title" content="old og">
<meta content="old desc" property='og:description'>
<meta name="twitter:card" content="summary_large_image">
<meta name="description" content="old">
<meta name="viewport" content="width=device-width">
<TITLE>second</TITLE>
</head><body>keep</body></html>`;
  const html = injectMeta(page, { title: 'New', description: 'Fresh', image: 'https://a.example/logo.svg' });
  assert.equal((html.match(/<title>/gi) ?? []).length, 1);
  assert.match(html, /<title>New<\/title>/);
  assert.equal((html.match(/og:title/g) ?? []).length, 1);
  assert.equal((html.match(/og:description/g) ?? []).length, 1);
  assert.equal((html.match(/twitter:card/g) ?? []).length, 1);
  assert.equal((html.match(/name="description"/g) ?? []).length, 1);
  for (const old of ['Old title', 'old og', 'old desc', 'summary_large_image', 'second', 'content="old"']) assert.ok(!html.includes(old), old);
  assert.match(html, /<meta charset="utf-8">/);
  assert.match(html, /name="viewport"/);
  assert.match(html, /<body>keep<\/body>/);
});

test('metaRoutes derives the meta routes from src/pages.js and the kinds: page paths, never /api/meta/*', async () => {
  const { metaRoutes } = await import('../../src/routes/meta.js');
  const pageList = [{ path: '/e/:slug', file: 'event.html', meta: /** @type {const} */ ('event') }, { path: '/search', file: 'search.html' }];
  assert.deepEqual(metaRoutes(pageList, [{ urlPrefix: '/t/' }, { urlPrefix: '/zz/' }]).map((r) => r.path), ['/e/:slug', '/t/:sourceId', '/zz/:sourceId']);
  assert.throws(() => metaRoutes([{ path: '/x/:id', file: 'x.html', meta: /** @type {any} */ ('nope') }], []), /unknown meta renderer 'nope'/);
});
