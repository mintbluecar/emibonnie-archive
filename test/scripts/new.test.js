// @ts-check
/**
 * `scripts/new.js` (`npm run new <kind> <name>`). Every case scaffolds
 * into a throwaway copy of the files the scaffolder edits, under the OS
 * temp dir -- never into this checkout (`npm test`'s posttest hash
 * check fails the run if `src/` or `public/` change). The full
 * end-to-end proof that a scaffolded kind plugs in without touching the
 * core is test/kinds/scaffoldedKind.test.js.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scaffold } from '../../scripts/new.js';
import { kindPrefixProblems } from '../../scripts/newChecks.js';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const NEW_SCRIPT = path.join(REPO_ROOT, 'scripts/new.js');
/**
 * The tracked files the scaffolder reads or edits (it creates everything else). Only the first
 * engine migration, so the expected numbers hold whatever later migrations this checkout has.
 */
const COPIED = ['src/routes/index.js', 'src/pages.js', 'src/site/copyDefaults.json', 'src/db/migrations/001_initial.sql'];

/** @param {(root: string) => void} fn */
function inTempRoot(fn) {
  const root = mkdtempSync(path.join(tmpdir(), 'fan-archive-new-'));
  try {
    for (const rel of COPIED) cpSync(path.join(REPO_ROOT, rel), path.join(root, rel), { recursive: true });
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** @param {string} root @param {string} rel */
const read = (root, rel) => readFileSync(path.join(root, rel), 'utf8');

/** Every file under `dir`, relative to it, sorted. @param {string} dir @returns {string[]} */
function filesUnder(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
    .sort();
}

test('component badge creates exactly the component and its test', () => {
  inTempRoot((root) => {
    const created = scaffold({ kind: 'component', name: 'badge', root });
    assert.deepEqual(created, ['public/js/components/badge.js', 'test/components/badge.test.js']);
    for (const rel of created) assert.ok(existsSync(path.join(root, rel)), rel);
    assert.match(read(root, 'public/js/components/badge.js'), /^\/\/ @ts-check/);
    assert.match(read(root, 'public/js/components/badge.js'), /html`/);
  });
});

test('migration add_x creates the next engine number, 002_add_x.sql', () => {
  inTempRoot((root) => {
    assert.deepEqual(scaffold({ kind: 'migration', name: 'add_x', root }), ['src/db/migrations/002_add_x.sql']);
    assert.match(read(root, 'src/db/migrations/002_add_x.sql'), /^-- 002_add_x:/);
  });
});

test('migration --site numbers site/migrations/ on its own, from 001', () => {
  inTempRoot((root) => {
    assert.deepEqual(scaffold({ kind: 'migration', name: 'add_x', root, site: true }), ['site/migrations/001_add_x.sql']);
    assert.deepEqual(scaffold({ kind: 'migration', name: 'add_y', root, site: true }), ['site/migrations/002_add_y.sql']);
    assert.ok(!existsSync(path.join(root, 'src/db/migrations/002_add_x.sql')), 'the engine namespace is untouched');
  });
});

test('the same name twice throws, and the failed run writes nothing', () => {
  inTempRoot((root) => {
    scaffold({ kind: 'component', name: 'badge', root });
    const before = filesUnder(root);
    assert.throws(() => scaffold({ kind: 'component', name: 'badge', root }), /already exists/);
    scaffold({ kind: 'migration', name: 'add_x', root });
    assert.throws(() => scaffold({ kind: 'migration', name: 'add_x', root }), /already exists/);
    assert.deepEqual(filesUnder(root), [...before, 'src/db/migrations/002_add_x.sql'].sort());
  });
});

test('Bad-Name, an unknown kind and a reserved kind URL prefix all throw', () => {
  inTempRoot((root) => {
    assert.throws(() => scaffold({ kind: 'component', name: 'Bad-Name', root }), /\^\[a-z\]\[a-z0-9_\]\*\$/);
    assert.throws(() => scaffold({ kind: 'widget', name: 'badge', root }), /unknown scaffold/);
    assert.throws(() => scaffold({ kind: 'kind', name: 'e', root }), /\/e\/ is reserved/);
    assert.throws(() => scaffold({ kind: 'kind', name: 'api', root }), /\/api\/ is reserved/);
  });
});

test('kind t, page t and page api are refused with a clear reason, and nothing is written', () => {
  inTempRoot((root) => {
    const before = filesUnder(root);
    assert.throws(() => scaffold({ kind: 'kind', name: 't', root }), /\/t\/ belongs to the translation kind/);
    assert.throws(() => scaffold({ kind: 'page', name: 't', root }), /\/t would shadow item pages/);
    assert.throws(() => scaffold({ kind: 'page', name: 'api', root }), /\/api is the API, not a page/);
    assert.throws(() => scaffold({ kind: 'page', name: 'e', root }), /already has a page under \/e\//);
    assert.deepEqual(filesUnder(root), before);
  });
});

test('a kind folder already using a prefix blocks a page there, and another kind with the same prefix', () => {
  inTempRoot((root) => {
    scaffold({ kind: 'kind', name: 'clip_note', root });
    assert.throws(() => scaffold({ kind: 'page', name: 'clip_note', root }), /shadow the clip_note kind's item pages/);
    assert.throws(() => scaffold({ kind: 'kind', name: 'clip_note', root }), /already exists/);
  });
});

test('JavaScript reserved words and names src/routes/index.js already binds are refused', () => {
  inTempRoot((root) => {
    const before = filesUnder(root);
    assert.throws(() => scaffold({ kind: 'component', name: 'delete', root }), /reserved word/);
    assert.throws(() => scaffold({ kind: 'route', name: 'class', root }), /reserved word/);
    assert.throws(() => scaffold({ kind: 'route', name: 'home', root }), /already binds the name home/);
    assert.throws(() => scaffold({ kind: 'route', name: 'kinds_registry', root }), /already binds the name kindsRegistry/);
    assert.throws(() => scaffold({ kind: 'route', name: 'page_meta_routes', root }), /already binds the name pageMetaRoutes/);
    assert.deepEqual(filesUnder(root), before);
  });
});

test('route registers itself at the marked insertion points in src/routes/index.js', () => {
  inTempRoot((root) => {
    const created = scaffold({ kind: 'route', name: 'top_items', root });
    assert.deepEqual(created, ['src/routes/topItems.js', 'test/routes/topItems.test.js', 'src/routes/index.js']);
    const index = read(root, 'src/routes/index.js');
    assert.match(index, /import \{ route as topItems \} from '\.\/topItems\.js';\n\/\/ scaffold:route-imports/);
    assert.match(index, /\n {2}topItems,\n {2}\/\/ scaffold:routes/);
    assert.match(read(root, 'src/routes/topItems.js'), /path: '\/api\/top-items'/);
  });
});

test('page creates its HTML and JS, lists itself in src/pages.js and adds its copy keys', () => {
  inTempRoot((root) => {
    const created = scaffold({ kind: 'page', name: 'top_items', root });
    assert.deepEqual(created, [
      'public/top-items.html', 'public/js/pages/topItems.js', 'test/pages/topItems.test.js', 'src/pages.js', 'src/site/copyDefaults.json',
    ]);
    assert.match(read(root, 'src/pages.js'), /\{ path: '\/top-items', file: 'top-items\.html' \},\n {2}\/\/ scaffold:pages/);
    assert.match(read(root, 'public/top-items.html'), /\{\{asset:js:topItems\}\}/);
    const copy = JSON.parse(read(root, 'src/site/copyDefaults.json'));
    assert.equal(typeof copy['topItems.title'], 'string');
    assert.throws(() => scaffold({ kind: 'page', name: 'top_items', root }), /already exists/);
  });
});

test('kind creates its folders, its migration and its tests, and edits nothing else', () => {
  inTempRoot((root) => {
    const before = new Map(COPIED.filter((rel) => rel.endsWith('.js') || rel.endsWith('.json')).map((rel) => [rel, read(root, rel)]));
    const created = scaffold({ kind: 'kind', name: 'clip_note', root });
    assert.deepEqual(created, [
      'src/kinds/clip_note/index.js', 'src/kinds/clip_note/domain.js', 'src/kinds/clip_note/repo.js',
      'src/kinds/clip_note/presenter.js', 'src/kinds/clip_note/search.js', 'src/kinds/clip_note/copy.json',
      'public/js/kinds/clip_note/section.js', 'public/js/kinds/clip_note/detail.js',
      'src/db/migrations/002_clip_note.sql',
      'test/kinds/clip_note/domain.test.js', 'test/kinds/clip_note/kind.test.js', 'test/kinds/clip_note/ui.test.js',
    ]);
    for (const [rel, text] of before) assert.equal(read(root, rel), text, `${rel} is untouched`);
    const sql = read(root, 'src/db/migrations/002_clip_note.sql');
    assert.match(sql, /insert into item_kinds values \('clip_note'\);/);
    assert.match(sql, /create table clip_note_items \(\n {2}item_id bigint primary key,/);
    assert.match(sql, /foreign key \(item_id, kind\) references items \(id, kind\)/);
    assert.match(read(root, 'src/kinds/clip_note/index.js'), /urlPrefix: '\/clip-note\/'/);
  });
});

test('no placeholder survives in any scaffolded file', () => {
  inTempRoot((root) => {
    // The kind gets its own name: its migration would clash with the migration scaffold's (by design).
    const created = [
      ...['route', 'page', 'component', 'migration'].flatMap((kind) => scaffold({ kind, name: 'zz_demo', root })),
      ...scaffold({ kind: 'kind', name: 'zz_kind', root }),
    ];
    for (const rel of created) assert.doesNotMatch(read(root, rel), /__[A-Za-z]+__/, rel);
  });
});

test('CLI: prints what it made; a repeat or a bad name exits 1 with the reason', () => {
  inTempRoot((root) => {
    mkdirSync(path.join(root, 'public/js/components'), { recursive: true });
    const run = (/** @type {string[]} */ args) => spawnSync(process.execPath, [NEW_SCRIPT, ...args], { cwd: root, encoding: 'utf8' });
    const ok = run(['component', 'badge']);
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /wrote public\/js\/components\/badge\.js/);
    const route = run(['route', 'top_items']);
    assert.equal(route.status, 0, route.stderr);
    assert.match(route.stdout, /reminder: add representative calls for \/api\/top-items to test\/privacy\.test\.js/);
    const again = run(['component', 'badge']);
    assert.equal(again.status, 1);
    assert.match(again.stderr, /already exists/);
    const bad = run(['component', 'Bad-Name']);
    assert.equal(bad.status, 1);
    assert.match(run([]).stderr, /usage: npm run new/);
  });
});

test('the real checkout carries both route insertion markers and the pages marker', () => {
  const index = readFileSync(path.join(REPO_ROOT, 'src/routes/index.js'), 'utf8');
  assert.match(index, /^\/\/ scaffold:route-imports/m);
  assert.match(index, /^ {2}\/\/ scaffold:routes/m);
  assert.match(readFileSync(path.join(REPO_ROOT, 'src/pages.js'), 'utf8'), /^ {2}\/\/ scaffold:pages/m);
});

test("kind t in this checkout gives its reason once, though both the owned-prefix and kind-folder checks catch it (Task 9a item 10)", () => {
  const problems = kindPrefixProblems(REPO_ROOT, '/t/', 't');
  assert.equal(problems.length, 1, problems.join(' | '));
  assert.match(problems[0], /\/t\/ belongs to the translation kind; pick another name$/);
});
