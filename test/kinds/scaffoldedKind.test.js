// @ts-check
/**
 * The proof that kinds are plugins (Plan 1b Task 8): in a throwaway copy
 * of this checkout (never this tree -- `npm test`'s posttest hash check
 * guards `src/` and `public/`), `npm run new kind zzcheck` must produce a
 * kind that builds, migrates, sets up, lints, type-checks and passes its
 * own tests, and whose item -- ingested through the real ingest path --
 * shows up in an event page's sections, in a kind-filtered search and on
 * a person's page, with the core untouched: the only changes in the
 * copy are the kind's own folders and its migration. What the build
 * regenerates from them (the kind's rewrite in vercel.json, new bundle
 * hashes in public/*.html) is gitignored.
 *
 * The scaffolded template already is the "minimal domain: one text field"
 * (`body`), so nothing is filled in by hand here.
 *
 * Two builds, a PGlite setup, lint and tsc in the copy: about 8 s on a
 * laptop. It runs in every PGlite `npm test`, and so once in CI: it is
 * skipped in the Postgres pass (`TEST_DATABASE_URL` set), because the
 * copy always uses its own PGlite anyway. `npm run test:kind` runs it alone.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const KIND = 'zzcheck';
const SLUG = 'zzcheck-proof-2026-10-01';
const WORD = 'quokkaproof';
/** Never a real database: the copy's scripts get PGlite in a temp dir, whatever this shell has set. */
const SAFE_ENV = { ...process.env, DATABASE_URL: '', VERCEL: '', TEST_DATABASE_URL: '', SITE_DIR: 'site' };
// node --test marks its child processes with NODE_TEST_CONTEXT, which would make the copy's own
// `node --test` report to this runner instead of printing; the nested run must be a plain one.
delete SAFE_ENV.NODE_TEST_CONTEXT;

/** @type {string} */ let scratch;
/** @type {string} */ let copy;
/** @type {any} */ const proof = {};

/** @param {string} cmd @param {string[]} args @param {Record<string, string>} [env] */
function run(cmd, args, env = {}) {
  return execFileSync(cmd, args, { cwd: copy, env: { ...SAFE_ENV, ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
/** @param {string[]} args */
const git = (args) => run('git', ['-c', 'user.name=scaffold-proof', '-c', 'user.email=scaffold-proof@example.invalid', '-c', 'commit.gpgsign=false', ...args]);

/** Copies every tracked or unignored file of this checkout (as it stands now) into `copy`. */
function copyCheckout() {
  const listed = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: REPO_ROOT, encoding: 'utf8' });
  for (const rel of listed.split('\0').filter(Boolean)) {
    const from = path.join(REPO_ROOT, rel);
    if (!existsSync(from)) continue; // deleted in the working tree
    mkdirSync(path.dirname(path.join(copy, rel)), { recursive: true });
    cpSync(from, path.join(copy, rel));
  }
  symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(copy, 'node_modules'), 'dir');
}

/** The driver runs in its own process, so it loads the copy's modules (and its generated registries), not ours. */
const DRIVER = `
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [root, dir] = process.argv.slice(2);
const imp = (rel) => import(pathToFileURL(path.join(root, rel)).href);
const { createDb } = await imp('src/db/client.js');
const { loadSite } = await imp('src/site/loadSite.js');
const { ingestItem } = await imp('src/services/ingest.js');
const { createEvent } = await imp('src/repo/events.js');
const { createHandler } = await imp('src/http/handler.js');
const { routes } = await imp('src/routes/index.js');
const db = createDb({ dir });
const site = loadSite(path.join(root, 'site'));
const now = () => new Date('2026-10-21T00:00:00.000Z');
const post = { text: 'zzcheck proof line about @lunamoon\\nsecond ${WORD} line', postedAt: '2026-10-01T05:00:00.000Z',
  author: { id: '42', handle: 'zz_writer', name: 'zz writer' } };
const fetchImpl = async (url) => (url === 'https://example.com/api/posts/zz1.json' ? Response.json(post) : new Response('', { status: 404 }));
const event = await db.transaction((tx) => createEvent(tx, { slug: '${SLUG}', name: 'zzcheck proof', occurredOn: '2026-10-01' }), { actor: 'system' });
const added = await ingestItem({ db, site, fetchImpl, now },
  { kind: '${KIND}', input: 'https://example.com/posts/zz1', overrides: { eventId: event.id }, addedVia: 'cli', actor: 'system' });
const handle = createHandler({ routes, makeDeps: () => ({ db: { ...db, end: async () => {} }, site, fetchImpl, now }),
  waitUntil: () => {}, log: (line) => console.error(line), env: {} });
const get = async (p) => { const res = await handle(new Request('https://archive.example' + p)); return { status: res.status, body: await res.json() }; };
const out = {
  added,
  event: await get('/api/event/${SLUG}'),
  search: await get('/api/search?q=${WORD}&kinds=${KIND}'),
  person: await get('/api/person/lunamoon'),
  item: await get('/api/item/${KIND}/zz1'),
};
await db.end();
console.log(JSON.stringify(out));
`;

/** Once per CI run is enough: the copy never touches the test database (see the header). */
const SKIP = process.env.TEST_DATABASE_URL ? 'runs in the PGlite pass only (TEST_DATABASE_URL is set)' : false;

describe('a scaffolded kind plugs in without touching the core', { skip: SKIP }, () => {
  before(async () => {
    scratch = mkdtempSync(path.join(tmpdir(), 'fan-archive-kind-proof-'));
    copy = path.join(scratch, 'repo');
    copyCheckout();
    run('node', ['scripts/initSite.js']);
    run('npm', ['run', 'build']);
    git(['init', '-q']);
    appendFileSync(path.join(copy, '.git/info/exclude'), '/node_modules\n');
    git(['add', '-A']);
    git(['commit', '-qm', 'baseline']);

    proof.migration = run('npm', ['run', 'new', 'kind', KIND]).match(/wrote (src\/db\/migrations\/\d{3}_zzcheck\.sql)/)?.[1];
    run('npm', ['run', 'build']);
    const pglite = { PGLITE_DIR: path.join(scratch, 'db') };
    proof.setup = run('npm', ['run', 'setup'], pglite);
    proof.migrate = run('npm', ['run', 'migrate'], pglite);
    run('npm', ['run', 'check']);
    proof.ownTests = run('node', ['--test', '--test-reporter=tap', `test/kinds/${KIND}/`]);
    writeFileSync(path.join(scratch, 'driver.mjs'), DRIVER);
    proof.api = JSON.parse(run('node', [path.join(scratch, 'driver.mjs'), copy, pglite.PGLITE_DIR]));
  });

  after(() => {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  });

  test('setup applies the kind migration; migrate then has nothing left to do', () => {
    assert.ok(proof.migration, 'the scaffolder wrote the kind migration');
    assert.ok(proof.setup.includes(`migrated engine/${proof.migration.split('/').pop()}`), proof.setup);
    assert.match(proof.migrate, /migrations: up to date/);
  });

  test("the scaffolded kind's own tests pass (lint and tsc already passed in the copy)", () => {
    assert.match(proof.ownTests, /# fail 0/);
    assert.doesNotMatch(proof.ownTests, /# pass 0\b/);
  });

  test('ingest adds the item through the real write path', () => {
    assert.equal(proof.api.added.status, 'added');
  });

  test("it is in GET /api/event/:slug's sections", () => {
    const { status, body } = proof.api.event;
    assert.equal(status, 200);
    const section = body.sections.find((/** @type {any} */ s) => s.kind === KIND);
    assert.ok(section, 'a zzcheck section');
    assert.equal(section.total, 1);
    assert.deepEqual(section.items[0].lines.map((/** @type {any} */ l) => l.text), ['zzcheck proof line about @lunamoon', `second ${WORD} line`]);
    assert.equal(body.counts[KIND], 1);
  });

  test('it is found by /api/search?q=<its text>&kinds=zzcheck, with its matching line', () => {
    const { status, body } = proof.api.search;
    assert.equal(status, 200);
    assert.equal(body.count, 1);
    assert.equal(body.results[0].kind, KIND);
    assert.equal(body.results[0].url, `/${KIND}/zz1`);
    assert.deepEqual(body.results[0].matchLines, [`second ${WORD} line`]);
  });

  test('it is on the person page of the person it names', () => {
    const { status, body } = proof.api.person;
    assert.equal(status, 200);
    assert.ok(body.sections.some((/** @type {any} */ s) => s.kind === KIND && s.items.some((/** @type {any} */ i) => i.sourceId === 'zz1')));
  });

  test('its item page renders through the kind presenter', () => {
    assert.equal(proof.api.item.status, 200);
    assert.equal(proof.api.item.body.kind, KIND);
    assert.equal(proof.api.item.body.bubbles.length, 2);
  });

  test('the core is untouched: only the kind folders and its migration changed (the rebuilt pages and vercel.json are gitignored)', () => {
    const changed = git(['status', '--porcelain', '--untracked-files=all']).split('\n').filter(Boolean).map((line) => line.slice(3));
    const own = [`src/kinds/${KIND}/`, `public/js/kinds/${KIND}/`, `test/kinds/${KIND}/`];
    assert.ok(changed.includes(proof.migration));
    assert.deepEqual(changed.filter((p) => !own.some((dir) => p.startsWith(dir)) && p !== proof.migration), []);
    const kindRewrite = { source: `/${KIND}/:id`, destination: `/api/meta/${KIND}/:id` };
    const vercel = JSON.parse(readFileSync(path.join(copy, 'vercel.json'), 'utf8'));
    assert.deepEqual(vercel.rewrites.filter((/** @type {any} */ r) => r.source === kindRewrite.source), [kindRewrite], 'the build still adds the kind\'s rewrite');
  });
});
