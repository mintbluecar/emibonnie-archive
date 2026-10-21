# Archive Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two repos:
- **`fan-archive`:** a reusable, fandom-neutral archive engine and template, containing the database, tweet intake, an owner command to add tweets, and every public reading page, all driven by one `site/` folder.
- **`emibonnie-archive`:** the first site built on it, deployed.

Translations are the first item kind. The engine is shaped so later kinds (photos, YouTube, lyrics, milestones) and hubs (projects) are added through recipes, not rewrites.

**Architecture:**
- **Layers with a pure core:** a pure **domain** (parsing, speaker resolution, event matching, drafting an item); **adapters** (tweet sources, and repositories per table group); **services** (ingest, search, presenters); thin **HTTP handlers** in `api/`.
- **Browser side:** plain ES modules, with small pure render components, per-kind **sections**, and page modules.
- **Site settings** are read from `site/`, both at runtime on the server and through a build step that publishes the public part to `public/site/`.
- **Dependencies** (`db`, `fetchImpl`, `now`, `site`) are passed in explicitly.

**Tech Stack:** Node 22+ (local is 26), `node --test`, `@neondatabase/serverless`, `@electric-sql/pglite` (tests and local dev), ESLint (flat config), TypeScript as a **checker only** (`checkJs`), Vercel Hobby, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-21-translation-archive-design.md` in `emibonnie-archive`. Mockups are in `docs/superpowers/specs/mockups/` in the same repo. Read both, especially "Reusable template" and "Items and item kinds". The spec's text wins over a mockup.

**Repos and folders.** Both are sibling folders under the same parent:
- `fan-archive/` (new; **Tasks 1–18 work here**). Its remote is `git@github.com:mintbluecar/fan-archive.git`.
- `emibonnie-archive/` (exists; holds this plan, the spec, mockups and real example tweets; **Tasks 19–20 work here**). Its remote is `git@github.com:mintbluecar/emibonnie-archive.git`.

**Later plans (not this one):** sign-in and the add flow (Plan 2); admin, bulk import and Actions jobs (Plan 3); further item kinds and projects (later plans). Each task's **Produces** names the seams they plug into.

## Global Constraints

- **Identity.** Commit as `car <bluerotcar@gmail.com>`. Each repo's `origin` points at `mintbluecar/…`, which sets this identity through the owner's git config. Run `git config user.email` before the first commit in each repo, and stop if it isn't `bluerotcar@gmail.com`. **Never push** unless the owner says so in that moment.
- No real name, no personal GitHub account, and no `/Users/...` paths in any committed file of either repo.
- **The engine is fandom-neutral.** Nothing outside `site/` in `fan-archive` may contain a fandom's names, handles, emoji defaults, colours, or hashtags. The engine-purity test (Task 2) enforces this.
- **The template contains no real translations.** Engine tests use **synthetic fixtures** (Task 3). The real example tweets stay in `emibonnie-archive` only. Executors may *read* them for structure but must not copy their text into `fan-archive`.
- Secrets (`DATABASE_URL`, Vercel token) live only in env vars and GitHub/Vercel secrets. `.env*` is gitignored.
- Translator text is stored and shown **verbatim**. Formatting is a view on top of it.
- **Settings drive behaviour:**
  - Display names are lowercase when `site.lowercaseNames` is true.
  - Known people are always shown with their **standard emoji** from the people table.
  - Generic roles (`host`, `fan`, `speaker`, `crowd`) keep the translator's own emoji.
  - Translator-facing copy says "remove", never "hide".
  - Entries have no titles, and "clip by @…" is always shown.
- Removed or opted-out content never appears in any public response.
- **Tweet sources:** syndication `https://cdn.syndication.twimg.com/tweet-result?id={id}&lang=en&token={token}`, with token `((Number(id)/1e15)*Math.PI).toString(36).replace(/(0+|\.)/g,'')`; FxTwitter `https://api.fxtwitter.com/2/status/{id}`.
- Live-event window: same person + same platform + date within **±1 day**.
- **Time zones:**
  - Moments are `timestamptz`. Calendar dates are plain `date`s in the **site time zone** (`site.timezone`, an IANA name). All "which day" logic uses the site time zone, never UTC or the viewer's.
  - Dates display as stored. Exact times display as "<viewer time> <viewer city> · <site time> <site city>" (one value if the zones match).

## Architecture and code rules

These rules apply to every task. A reviewer rejects a task that breaks them.

**Layers.** Imports may only point downward:

```
api/*.js              thin HTTP adapters: parse input → call a service → return JSON. No SQL, no business rules.
src/http/             handler wrapper, errors, query parsing
src/services/         orchestration: ingest, search, presenters. May use repo/, tweets/, domain/, site/.
src/repo/             all SQL, one module per table group. May use db/ and domain/types only.
src/tweets/           all network access to tweet sources (registry in sources/index.js)
src/db/               connection + numbered migrations
src/site/             loading and validating site/ settings and copy (no fandom values in code)
src/domain/           PURE: no I/O, no clock, no imports from other layers
public/js/core/       browser utilities (api client, esc, dom, format, site)
public/js/components/ pure render(props) → string, plus optional bind(el, props)
public/js/sections/   one module per item kind: render that kind's list on hub pages; registry in index.js
public/js/pages/      one module per page: fetch data, compose components/sections, wire events
site/                 the ONLY folder an archive owner edits
```

**Rules:**
1. **One source of truth for each rule.**
   - Visibility is the `visibleItem` SQL fragment in `src/repo/visibility.js`.
   - Engine constants are in `src/domain/constants.js`. Fandom values are in `site/site.json`.
   - Shared data shapes are JSDoc typedefs in `src/domain/types.js`.
   - All user-facing wording is in `src/site/copyDefaults.json`, overridable by `site/copy.json`.
2. **No god modules.** ESLint enforces `max-lines: 200` (skipping blank lines and comments), `max-lines-per-function: 50`, `complexity: 10`, `max-params: 4`. Tests are exempt from the size rules.
3. **Dependency injection.** Services and handlers receive `deps = { db, fetchImpl, now, site }`. `src/deps.js` builds the production defaults. There's no module-level mutable state and no test hooks.
4. **Pure core.** `src/domain/` is deterministic and tested without mocks.
5. **Hubs and item kinds.**
   - Events and people (later projects) are hubs. Translations are an item kind.
   - Behaviour shared by all kinds (visibility, removal, opt-out, placement, ordering, people) lives on `items` and in `src/repo/items.js`.
   - Kind-specific behaviour lives in that kind's table, repo, domain module, and section.
   - Code that branches on `kind` happens only through the section registry and the per-kind modules, never in an `if/else` chain.
6. **Extend, don't edit.** Every extension point has a recipe in `CONTRIBUTING.md` and, where it fits, a scaffold (`npm run new <kind> <name>`). If a feature needs a new kind of extension, add its recipe and template in the same pull request.
7. **Schema changes are new migrations** (`src/db/migrations/NNN_*.sql`). Never edit an applied migration.
8. **Parameterised SQL only.**
9. **Escape at the edge.** Components and sections escape every interpolated value with `esc()`. HTML strings are built only in `components/` and `sections/`.
10. **Type-checked JS.** `// @ts-check` in every file. `npm run check` runs `tsc --noEmit` plus ESLint, and must pass before each commit.
11. **Database conventions** (Task 9, ADR 0006): every entity table has bookkeeping columns and soft delete; the audit log is automatic; `meta` jsonb is for display-only extras; repeated values are lookups or tags; relations are join tables.
12. **Naming.**
    - Files are `camelCase.js`. Functions are verbs, and pure transforms are named for their output.
    - SQL is `snake_case`, and repos map rows to camelCase at the boundary.

### Extension points

| To add… | Where | Recipe / scaffold |
|---|---|---|
| A JSON endpoint | `api/<name>.js`: `run` + `default handler(run)` | `npm run new endpoint <name>` |
| A page | `public/<name>.html` + `public/js/pages/<name>.js` (`start()`) + rewrite in `vercel.json` | `npm run new page <name>` |
| A UI piece | `public/js/components/<name>.js` (`render`, optional `bind`) | `npm run new component <name>` |
| A table/column | `src/db/migrations/NNN_<desc>.sql`. **First ask:** is it display-only? Then use `meta` (no migration). New entity tables copy the common columns and get added to the trigger list. | `npm run new migration <desc>` |
| Queries for a table group | `src/repo/<name>.js` | `npm run new repo <name>` |
| Orchestration | `src/services/<name>.js` | `npm run new service <name>` |
| A pure rule/parser | `src/domain/<name>.js` | `npm run new domain <name>` |
| **A new item kind** (photo, youtube, lyrics, milestone…) | migration (kind table) + `src/repo/<kind>s.js` + `src/domain/<kind>.js` + `public/js/sections/<kind>.js` + one line in `SECTIONS` + one line in `KINDS` (`src/domain/kinds.js`) | `npm run new kind <name>` |
| A tweet source | `src/tweets/sources/<name>.js` + register in `sources/index.js` | recipe |
| A platform, category, or client | insert a row (data, not schema): `platforms`, or through `lookups.ensureCategory/ensureClient` | recipe |
| A live platform pattern, role, or engine constant | `src/domain/constants.js` (or `site.json` `extraPlatforms` for one site only) | recipe |
| A site setting | `src/site/schema.js` (with a default, or a clear setup error) + `site/README.md` + `CHANGELOG.md` | recipe |
| A background job (Plan 3) | `jobs/<name>.js` (`run(deps)`) + workflow | recipe added in Plan 3 |

## Review Focus

1. **Tweet text containing HTML** (`<`, `&`, `"`) renders as text. Tested in Task 14.
2. **Searching Thai**, e.g. `ครบ`, finds the matching synthetic entry. Tested in Task 12.
3. **Lines with an empty marker**, e.g. `: Luna, I have something to tell you`, render as plain text and aren't dropped. Tested in Task 4.
4. **Keyword variations:** "SOLLUNA AT STARFEST " vs "solluna at starfest" match the same event; an ignored hashtag alone never matches. Tested in Task 7.
5. **A broken or partial `site.json`** (missing featured people, bad colour, unknown default-marker handle) fails `npm run setup` with a message naming the field, rather than crashing at runtime. Tested in Task 2.

Deleted tweets (tombstone → archived text kept, `/api/video` 404, page note) are covered in Tasks 3, 13 and 15.

---

## File structure (fan-archive)

```
package.json  vercel.json  eslint.config.js  jsconfig.json  CHANGELOG.md  README.md
CONTRIBUTING.md  docs/architecture.md  docs/start-your-own.md  docs/decisions/  docs/video-check.md
.github/pull_request_template.md  .github/workflows/ci.yml
site/site.json  site/theme.css  site/copy.json  site/logo.svg  site/README.md  site/seed/   (example pair)
scripts/dev.js  scripts/build.js  scripts/setup.js  scripts/add.js  scripts/seedDev.js  scripts/new.js  scripts/templates/
src/deps.js
src/site/schema.js  loadSite.js  copy.js  copyDefaults.json
src/domain/types.js  constants.js  kinds.js  lines.js  header.js  speakers.js  events.js  draft.js
src/tweets/url.js  normalize.js  fetchTweet.js  sources/index.js  sources/syndication.js  sources/fx.js
src/db/client.js  migrate.js  migrations/001_initial.sql
src/repo/visibility.js  rows.js  people.js  accounts.js  events.js  items.js  translations.js  speakerMemory.js  settings.js
src/services/ingest.js  search.js  views.js  seedFromSite.js
src/http/handler.js  errors.js  query.js
api/home.js  event.js  item.js  search.js  person.js  account.js  video.js
public/*.html  public/css/*.css  public/js/core/*  public/js/components/*  public/js/sections/index.js  public/js/sections/translation.js
public/js/state/searchState.js  public/js/pages/*
public/site/   (generated by build; gitignored)
test/…  test/fixtures/tweets/ (synthetic)  test/fixtures/site/ (a second, deliberately different site for purity tests)
```

---

### Task 1: Engine repo, guardrails, dev server, video spike

**Files** (in a new sibling folder `fan-archive/`):
- Create: `package.json`, `vercel.json`, `eslint.config.js`, `jsconfig.json`, `.gitignore`, `README.md`, `CHANGELOG.md`, `docs/architecture.md`, `CONTRIBUTING.md` (skeleton), `docs/decisions/0000-template.md` … `0005-*.md`, `.github/pull_request_template.md`, `scripts/dev.js`, `scripts/videoCheck.mjs`, `public/soon.html`, `test/dev.test.js`, `test/fixtures/static/event.html`, `test/fixtures/api/ping.js`, `docs/video-check.md`

**Interfaces:**
- Produces:
  - `npm test` runs `node --test`. `npm run check` runs `tsc --noEmit -p jsconfig.json && eslint .`. `npm run dev` runs `node scripts/build.js && node scripts/dev.js` (`build.js` arrives in Task 2; until then, `dev` runs only the server).
  - `createServer({ root, apiDir, rewrites }) → http.Server`.

- [ ] **Step 1: Create the repo.** From the parent folder: `mkdir fan-archive && cd fan-archive && git init -b main && git remote add origin git@github.com:mintbluecar/fan-archive.git`. Then run `git config user.email`. **Expected:** `bluerotcar@gmail.com`. If not, stop and ask the owner.
- [ ] **Step 2: `.gitignore`:** `node_modules/`, `.env*`, `.vercel/`, `.devdb/`, `public/site/`, `.superpowers/`.
- [ ] **Step 3: `package.json`** — `"type":"module"`, `"private":true`, `"engines":{"node":">=22"}`. Scripts: `test`, `check`, `dev`, `build` (`node scripts/build.js`), `setup` (`node scripts/setup.js`), `migrate` (`node src/db/migrate.js`), `add` (`node scripts/add.js`). Dependency: `@neondatabase/serverless`. Dev dependencies: `@electric-sql/pglite`, `eslint`, `@eslint/js`, `globals`, `typescript`. Run `npm install`.
- [ ] **Step 4: `eslint.config.js`.**
  - Size and complexity rules as listed in "Architecture and code rules".
  - `no-restricted-imports`: `src/domain/**` may not import `repo`, `tweets`, `db`, `services`, `http`, `site`; `api/**` may not import `src/repo/**` or `src/db/**`; `public/js/**` may not import `src/**` (tests excepted).
  - Node globals for `src`, `api`, `scripts`, `test`; browser globals for `public/js`.
- [ ] **Step 5: `jsconfig.json`** — `checkJs`, `strict`, `module: nodenext`, `target: es2022`, `noEmit`. Include `src`, `api`, `public/js`, `scripts`.
- [ ] **Step 6: Contributor docs.**
  - `docs/architecture.md`: copy "Architecture and code rules" (with Extension points) and the file-structure tree from this plan.
  - `CONTRIBUTING.md` skeleton:
    - **Setup:** `npm install`, `npm run setup`, `npm run dev`, `npm test`, `npm run check`.
    - **Workflow:** branch → small commits → check and test → PR with the template.
    - **Recipes:** headings only; Task 18 fills them in.
    - **Testing conventions:** `test/` mirrors source; domain tests use fixtures and no mocks; services get injected `deps`; components are tested as strings.
    - **Commit style:** imperative subject ≤ 72 characters.
    - **"Engine vs site":** never put fandom values outside `site/`.
  - `docs/decisions/` (Context / Decision / Consequences, 5–15 lines each, with reasons from the spec):
    - `0000-template.md`
    - `0001-plain-js-no-framework.md`
    - `0002-layered-architecture-and-di.md`
    - `0003-two-tweet-sources.md`
    - `0004-migrations-not-schema-edits.md`
    - `0005-template-repo-and-site-folder.md`
  - `.github/pull_request_template.md` checklist:
    - [ ] Followed a recipe in CONTRIBUTING.md, or added one.
    - [ ] Layer rules respected.
    - [ ] No duplicated rule.
    - [ ] No fandom values outside `site/`.
    - [ ] Tests added, and `npm run check && npm test` pass.
    - [ ] Schema changes are a new migration.
    - [ ] New site settings have defaults and a CHANGELOG note.
    - [ ] No secrets, real names, or local paths.
  - `README.md`: one paragraph on what the engine is, plus a link to `docs/start-your-own.md` (written in Task 18).
- [ ] **Step 7: `vercel.json`.** `"buildCommand": "npm run build"`, `"outputDirectory": "public"`. Rewrites: `/e/:slug → /event.html`, `/t/:id → /item.html`, `/p/:ig → /person.html`, `/tl/:handle → /account.html`, `/search → /search.html`, `/add → /soon.html`, `/me → /soon.html`.
- [ ] **Step 8: Write the failing test** `test/dev.test.js`

```js
test('dev server applies vercel rewrites and routes /api', async () => {
  const srv = createServer({ root: 'test/fixtures/static', apiDir: 'test/fixtures/api',
    rewrites: [{ source: '/e/:slug', destination: '/event.html' }] });
  const base = await listen(srv); // listen on port 0
  assert.match(await (await fetch(base + '/e/anything')).text(), /EVENT PAGE/);
  assert.deepEqual(await (await fetch(base + '/api/ping?x=1')).json(), { ok: '1' });
  assert.equal((await fetch(base + '/nope.html')).status, 404);
  srv.close();
});
```

- [ ] **Step 9: Run `npm test`. Expected: FAIL.** Then implement `scripts/dev.js` with `node:http`: `:param` → regex, `/api/<name>` → `import()` with a cache-buster, plus the `res.status`/`res.json` helpers. When run directly it uses `public`, `api`, the `vercel.json` rewrites, and `127.0.0.1:3000`. **Run `npm test && npm run check`. Expected: PASS.**
- [ ] **Step 10: Video spike.** `scripts/videoCheck.mjs <path-to-syndication-json>`:
  - Picks the smallest mp4 variant, requests it with `Referer: https://example.com/` and `Range: bytes=0-1023`, and prints the status and content-type.
  - Writes `public/video-check.html` with a `<video controls playsinline>`.

  Run it against `../emibonnie-archive/test/fixtures/tweets/2030321729902641632.syn.json`, which is read only and never copied. Run `npm run dev` and open `http://127.0.0.1:3000/video-check.html`. **Expected:** a 200/206 response, and the video plays.
  - Record the status, the result, and the date in `docs/video-check.md`, with no tweet text.
  - Delete `public/video-check.html`.
  - **If it doesn't play, stop and tell the owner** (the spec's fallback changes Task 15).
- [ ] **Step 11: Commit** — `git add -A && git commit -m "Engine scaffold with guardrails, contributor docs, dev server"`

---

### Task 2: Site settings, copy, build step, and engine purity

**Files:**
- Create:
  - `site/site.json`, `site/theme.css`, `site/copy.json`, `site/logo.svg`, `site/README.md` (the example pair)
  - `src/site/schema.js`, `src/site/loadSite.js`, `src/site/copy.js`, `src/site/copyDefaults.json`
  - `scripts/build.js`, `src/deps.js` (initial)
  - `test/site/*.test.js`, `test/fixtures/site/` (a second, different site: `site.json`, `copy.json`), `test/fixtures/site-badcopy/copy.json`
  - `test/purity.test.js`

**Interfaces:**
- Produces:

```js
/** @typedef {{ igHandle: string, displayName: string, emoji: string, colour: string }} FeaturedPerson */
/** @typedef {{ name: string, wordmark: { accent: string, rest: string }, tagline: string, ownerXUserId: string,
 *   sourceLanguage: string, lowercaseNames: boolean, featuredPeople: FeaturedPerson[],
 *   defaultMarkers: Record<string, { personHandle: string } | { role: 'host'|'fan'|'speaker'|'crowd' }>,
 *   ignoredHashtags: string[], types: string[], extraPlatforms: { name: string, pattern: string }[], timezone: string }} Site */
```

  - `validateSite(raw: unknown) → { ok: true, site: Site } | { ok: false, errors: string[] }`. Each error names the field path, e.g. `featuredPeople[1].colour: must be a #rrggbb colour`. It applies defaults for optional fields (`lowercaseNames: false`, `extraPlatforms: []`, `types: ['show / interview','fan meet / fan day','live','shared story']`). IG handles are lowercased with `@` stripped. Every `defaultMarkers[*].personHandle` must be a featured person. `timezone` is required and must be a valid IANA zone, checked with `new Intl.DateTimeFormat('en', { timeZone })` inside try/catch (error: `timezone: unknown time zone "<value>"`).
  - `loadSite(dir = 'site') → Site`: reads `site.json` and throws `SiteConfigError` with all errors joined.
  - `loadCopy(dir = 'site') → Record<string,string>`: `copyDefaults.json` overlaid by `<dir>/copy.json`. Unknown keys are an error (`unknown copy key: <k>`), which catches typos.
  - `formatName(site, name) → string`: lowercases when `site.lowercaseNames`.
  - `scripts/build.js` writes `public/site/site.js` as `export default {name, wordmark, tagline, lowercaseNames, timezone, copy}` (no owner ID, no secrets), and copies `site/theme.css` and `site/logo.*` into `public/site/`.
  - `deps.site` = `loadSite()`.
  - **Example site** (`site/`): name "solluna archive", wordmark `{accent:'solluna', rest:'archive'}`, tagline "fan translations, kept". Featured people: `{igHandle:'solsunny', displayName:'sol', emoji:'☀️', colour:'#f2a93b'}` and `{igHandle:'lunamoon', displayName:'luna', emoji:'🌙', colour:'#7a6cf0'}`. `defaultMarkers`: `{'☀️':{personHandle:'solsunny'}, '🌙':{personHandle:'lunamoon'}, '🗣️':{role:'crowd'}, '💬':{role:'fan'}}`. `ignoredHashtags: ['solluna']`, `lowercaseNames: true`, `sourceLanguage: 'th'`, `timezone: 'Asia/Bangkok'`, `ownerXUserId: '0'`.
  - `site/theme.css` defines every design token (from the spec's "Visual design": paper, card, line, ink, muted, the brand gradient pair, fonts), each with a dark-mode value. The engine CSS only ever uses `var(--…)`.
  - `copyDefaults.json` holds every UI string used by later tasks (tagline fallback, tab labels, FAN-MADE, empty states, `sourceGone` = "Original tweet is no longer available. Translation kept below.", `accountOptedOut` = "this translator has opted out", `showN` = "show {n} translations", and so on). Later tasks add keys here; components read copy, never literals.
- [ ] **Step 1: Write the failing tests**

```js
test('valid example site loads with defaults', () => {
  const r = validateSite(readJson('site/site.json'));
  assert.equal(r.ok, true);
  assert.equal(r.site.featuredPeople[0].igHandle, 'solsunny');
});
test('errors name the field', () => {
  const raw = readJson('site/site.json');
  raw.featuredPeople[1].colour = 'purple'; raw.defaultMarkers['⭐'] = { personHandle: 'nobody' };
  const r = validateSite(raw);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.startsWith('featuredPeople[1].colour')));
  assert.ok(r.errors.some(e => e.includes('defaultMarkers') && e.includes('nobody')));
});
test('missing featuredPeople is an error, not a crash', () => {
  const raw = readJson('site/site.json'); delete raw.featuredPeople;
  assert.ok(validateSite(raw).errors.some(e => e.startsWith('featuredPeople')));
});
test('copy overrides and rejects unknown keys', () => {
  assert.equal(loadCopy('test/fixtures/site').tagline, 'a different tagline');
  assert.throws(() => loadCopy('test/fixtures/site-badcopy'), /unknown copy key/);
});
test('formatName', () => assert.equal(formatName({ lowercaseNames: true }, 'Sol'), 'sol'));
test('timezone must be a real IANA zone', () => {
  const raw = readJson('site/site.json'); raw.timezone = 'Mars/Olympus';
  assert.ok(validateSite(raw).errors.some(e => e.startsWith('timezone')));
});
```

  `test/purity.test.js` collects banned strings from **both** `site/site.json` and `test/fixtures/site/site.json` (people handles, display names, the wordmark accent, ignored hashtags). It also adds the real-world names `emi`, `bonnie`, `emiamily`, `beonnnie` and `emibonnie` as whole words, case-insensitive. It then fails if any file under `src/`, `api/`, `public/js/`, `public/css/` or `scripts/` (excluding `scripts/templates/`) contains one of them.
- [ ] **Step 2: Run `npm test`. Expected: FAIL.** — [ ] **Step 3: Implement**, splitting `schema.js` into small field validators to stay within the lint limits. — [ ] **Step 4: Run `npm run build && npm test && npm run check`. Expected: PASS**, and `public/site/site.js` exists.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "Site settings, copy, build step, engine purity test"`

---

### Task 3: Tweet sources and synthetic fixtures

**Files:**
- Create: `src/domain/types.js` (start with `Tweet`), `src/tweets/url.js`, `src/tweets/sources/syndication.js`, `src/tweets/sources/fx.js`, `src/tweets/sources/index.js`, `src/tweets/normalize.js`, `src/tweets/fetchTweet.js`, `test/fixtures/tweets/build.mjs` + its generated JSON, `test/helpers/fixtures.js`, `test/helpers/fakeFetch.js`, `test/tweets/*.test.js`

**Synthetic fixtures.**
- `build.mjs` writes `<id>.syn.json` and `<id>.fx.json` in the **same structure** as real responses. Copy the shape (keys and nesting) from `../emibonnie-archive/test/fixtures/tweets/*.json`, **but write all text, handles, and IDs fresh**.
- Commit both the script and its output. Each fixture is named by a constant exported from `test/helpers/fixtures.js`:

| Const | ID | Author (id) | Must contain |
|---|---|---|---|
| `LONG` | `1900000000000000001` | `tl_alpha` (`9001`) | keyword line `SOLLUNA AT STARFEST`, `#SolLunaStarfest`, markers `🦁 🌧️ 🐶 🐱 🗣️` (first appearance in that order), a line `🐱: We hug all the time.`, a Thai line containing `ครบ`, footnotes `* …` and `** …`; ≥ 2,400 characters. Syndication has `note_tweet` and **truncated** text; fx has the full text. It quotes `1900000000000000000`. |
| `EVENT_A` | `1900000000000000002` | `tl_beta` (`9002`) | `SOLLUNA HAPPY DAY`, `#SLHappyDay2026`, markers `☀️ 🌙`; video whose `expanded_url` is `https://x.com/clipper_one/status/1800000000000000001/video/1`; four mp4 variants at 632000/950000/2176000/10368000 bps |
| `EVENT_B` | `1900000000000000003` | `tl_gamma` (`9003`) | same keyword and hashtag plus ignored `#SolLuna`; an empty-marker line `: Luna, I have something to tell you`; `🌙` lines |
| `LIVE` | `1900000000000000004` | `tl_alpha` | first line `#lunamoon TikTok live [260212]`, markers `💬 🐱` |
| `SHARED` | `1900000000000000005` | `tl_alpha` | first line `#SolLuna #starguest`, markers `💬 🪇` |
| `TOMB` | `1900000000000000006` | – | `{"__typename":"TweetTombstone",…}`; no fx file |

**Interfaces:**
- Produces:

```js
/** @typedef {{ url: string, bitrate: number, contentType: string }} VideoVariant */
/** @typedef {{ id: string, status: 'live'|'deleted'|'unavailable', authorId: string|null, authorHandle: string|null,
 *   authorName: string|null, createdAt: string|null, text: string, textSource: 'syndication'|'fx'|null,
 *   video: { variants: VideoVariant[], durationMs: number } | null, clipSource: { handle: string, url: string } | null,
 *   quotedId: string|null, replyToId: string|null }} Tweet */
```

  - `parseTweetId(input) → string|null` and `extractTweetIds(text) → string[]`.
  - `synToken(id)`, `fetchSyndication(deps, id)`, `fetchFx(deps, id)`: each returns `object|null`, treating any non-OK response, error, or 5 s timeout as `null`.
  - `SOURCES = [{ name:'syndication', fetch: fetchSyndication }, { name:'fx', fetch: fetchFx }]`.
  - `normalize(id, { syndication, fx }) → Tweet` is pure. Text comes from fx when syndication has `note_tweet` or is null. Only the trailing media `t.co` URL is removed. Variants are mp4 only, sorted ascending. `clipSource` comes from `mediaDetails[0].expanded_url`.
  - `fetchTweet(deps, id)` runs all `SOURCES` in parallel, then calls `normalize`.
- [ ] **Step 1: Write `build.mjs` and run it, then write the failing tests:**
  - **`parseTweetId`:**
    - x.com, twitter.com, `?s=`, and `/video/1` URLs give the ID.
    - A bare ID is accepted as-is.
    - A profile URL gives `null`.
  - **`extractTweetIds`:** a chat-like text with a duplicate link returns the IDs deduped, in order.
  - **`LONG`:**
    - `textSource` is `'fx'`, the length is at least 2,400, and the text contains `We hug all the time.`
    - `quotedId` is `'1900000000000000000'` and `authorHandle` is `'tl_alpha'`.
  - **`EVENT_A`:**
    - `clipSource` is `{ handle: 'clipper_one', url: … }`.
    - Every variant is mp4, sorted ascending.
  - **`LIVE`:** `textSource` is `'syndication'`.
  - **`TOMB`:** `status` is `'deleted'`. Both sources null gives `'unavailable'`.
  - **`fetchTweet`:** when fx is null it still returns `'live'` (using `fakeFetch`).
- [ ] **Step 2: Run `npm test`. Expected: FAIL.** — [ ] **Step 3: Implement.** — [ ] **Step 4: Run `npm test && npm run check`. Expected: PASS** (the purity test still passes; the synthetic handles aren't in any site file).
- [ ] **Step 5: Commit** — `git add -A && git commit -m "Tweet sources registry, normalisation, synthetic fixtures"`

---

### Task 4: Lines and markers

**Files:** Create `src/domain/lines.js`, `test/domain/lines.test.js`. Modify `src/domain/types.js` (add `Line`, `Marker`).

**Interfaces:**
- Produces:
  - `isSpeechLine(line) → boolean`
  - `splitLines(text) → Line[]`
  - `findMarkers(lines) → Marker[]` (by count descending; `example` = first text)

```js
/** @typedef {{kind:'speech', marker:string, text:string} | {kind:'plain', text:string} | {kind:'footnote', mark:string, text:string}} Line */
/** @typedef {{ marker: string, count: number, example: string }} Marker */
```

  **Marker rule:** before the first `:` (within 12 characters), the line holds whole emoji grapheme clusters (`Intl.Segmenter` + `\p{Extended_Pictographic}`), or a 1–3 character label. The text after `: ` is the speech text.
  - `*`/`**` followed by a space marks a footnote.
  - A leading `:` makes the line **plain**.
  - Blank lines are skipped. Everything else is kept verbatim.
- [ ] **Step 1: Write the failing tests** (using the fixture constants):
  - `LONG` markers are exactly `{🦁, 🌧️, 🐶, 🐱, 🗣️}`, and the 🐱 line text is `We hug all the time.`
  - `LONG` has 2 footnotes, the first with `mark '*'`.
  - `EVENT_B` has a plain line starting `: Luna, I have something to tell you` and a speech line with marker `🌙`.
  - `LONG`'s first line is `{kind:'plain', text:'SOLLUNA AT STARFEST'}`.
  - `'E: hi'` → `{kind:'speech', marker:'E', text:'hi'}`.
  - The number of lines equals the number of non-blank source lines.
- [ ] **Step 2: FAIL** → **Step 3: implement** → **Step 4: `npm test && npm run check` PASS** → **Step 5: Commit** — `"Split text into speaker lines and markers"`

---

### Task 5: Engine constants, kinds registry, header parsing

**Files:** Create `src/domain/constants.js`, `src/domain/kinds.js`, `src/domain/dates.js`, `src/domain/header.js`, `test/domain/dates.test.js`, `test/domain/header.test.js`. Modify `types.js` (add `Header`).

**Interfaces:**
- Produces:
  - `constants.js`, engine-level only (no fandom values):
    - `ROLES = ['host','fan','speaker','crowd']`
    - `PLATFORMS = [{name:'tiktok live', pattern:/tiktok\s*live/i}, {name:'ig live', pattern:/\b(ig|instagram)\s*live/i}, {name:'youtube live', pattern:/youtube\s*live/i}, {name:'x space', pattern:/\b(x|twitter)\s*space/i}]`
    - `LIVE_WINDOW_DAYS = 1`
    - `PLACEMENTS = ['event','shared_story','unsorted']`
  - `kinds.js`: `KINDS = [{ name: 'translation', table: 'translations', urlPrefix: '/t/' }]`, and `kindByName(name)`. This is the one list later kinds append to.
  - `dates.js` (pure; uses `Intl.DateTimeFormat` with `timeZone`, no libraries):
    - `localDate(instantIso, tz) → 'YYYY-MM-DD'`
    - `daysBetween(dateA, dateB) → number` (calendar days, no time-of-day)
    - `localYear(instantIso, tz) → number`
  - `parseHeader(text, { ignoredHashtags, personHandles, platforms, postedAt?, timezone }) → Header`, where `platforms` = `PLATFORMS` plus the site's `extraPlatforms` (compiled to RegExp by the caller).

```js
/** @typedef {{ keyword: string|null, hashtags: string[], personTags: string[], unknownHandleTags: string[],
 *   live: { platform: string, date: string|null } | null, context: string|null }} Header */
```

  - **Header lines:** those before the first `isSpeechLine`.
  - **keyword:** the first header line with at least 2 words and at least 70% uppercase letters.
  - **hashtags:** original case, minus ignored and person tags (case-insensitive).
  - **personTags:** lowercase matches of `personHandles`.
  - **unknownHandleTags:** lowercase `#tag`s matching `/^[a-z0-9._]{3,30}$/` that are neither person tags nor ignored.
  - **live:** the first platform match. The date comes from `[YYMMDD]`, or `d/m` with the year from `localYear(postedAt, timezone)` (current year if missing). Header dates are already site-local and are never converted.
  - **context:** the first header line starting with `[`.

  Keep `findKeyword`, `splitHashtags`, `detectLive` and `parseLiveDate` as small private functions.
- [ ] **Step 1: Write the failing tests** (`opts = { ignoredHashtags:['solluna'], personHandles:['solsunny','lunamoon'], platforms: PLATFORMS }`):
  - `EVENT_A` → keyword `'SOLLUNA HAPPY DAY'`, hashtags `['#SLHappyDay2026']`.
  - `EVENT_B` → hashtags `['#SLHappyDay2026']` (ignored `#SolLuna` dropped).
  - `LIVE` → personTags `['lunamoon']`, live `{platform:'tiktok live', date:'2026-02-12'}`, keyword `null`.
  - `'luna tiktok live 12/2'` with `postedAt '2026-02-13T01:00:00Z'` → date `'2026-02-12'`.
  - `SHARED` → keyword `null`, live `null`, unknownHandleTags `['starguest']`.
  - An extra platform `{name:'weverse live', pattern:/weverse\s*live/i}` passed in `platforms` is detected.
  - **dates:** `localDate('2026-02-12T17:30:00Z', 'Asia/Bangkok') === '2026-02-13'` (00:30 in Bangkok). `localDate('2026-02-12T16:59:00Z', 'Asia/Bangkok') === '2026-02-12'`. `daysBetween('2026-02-12','2026-02-13') === 1`. A New Year's Eve instant gives the right `localYear`.
- [ ] **Step 2: FAIL** → **Step 3: implement** → **Step 4: PASS** → **Step 5: Commit** — `"Engine constants, kinds registry, header parsing"`

---

### Task 6: Speaker resolution

**Files:** Create `src/domain/speakers.js`, `test/domain/speakers.test.js`. Modify `types.js` (add `Person`, `SpeakerTarget`, `SpeakerMap`).

**Interfaces:**
- Produces:

```js
/** @typedef {{ id: number, igHandle: string, displayName: string, emoji: string, colour: string, extraHashtags: string[], featured: boolean }} Person */
/** @typedef {{ person: number } | { role: 'host'|'fan'|'speaker'|'crowd' }} SpeakerTarget */
/** @typedef {Record<string, SpeakerTarget>} SpeakerMap */
```

  - `resolveSpeakers({ defaults, people, remembered = {}, chosen = {} }) → SpeakerMap`. `defaults` is `site.defaultMarkers`, with handles resolved to IDs through `people` (unknown handles are skipped). Layers are applied in the order defaults → remembered → chosen, and later layers win. **This is the only place they're combined** (ingest here, the add flow in Plan 2, the import in Plan 3).
  - `missingMarkers(markers, map) → Marker[]`
  - `personIdsFrom(map, markers) → number[]` (people actually used, unique and sorted)
- [ ] **Step 1: Write the failing tests:**
  - Defaults `{☀️ → solsunny, 🌙 → lunamoon, 🗣️ → crowd}` resolve to IDs.
  - `remembered {'🐶':{person:1}}` is added.
  - `chosen` overrides `remembered` for the same marker.
  - `missingMarkers` returns only the unmapped markers.
  - `personIdsFrom` ignores mapped markers that don't appear in the text.
- [ ] **Step 2: FAIL** → **3: implement** → **4: PASS** → **5: Commit** — `"Speaker map resolution"`

---

### Task 7: Event matching

**Files:** Create `src/domain/events.js`, `test/domain/events.test.js`. Modify `types.js` (add `Event`, `EventProposal`, `EventMatch`).

**Interfaces:**
- Produces:

```js
/** @typedef {{ id: number, slug: string, name: string, date: string, type: string|null, clientMedia: string|null,
 *   keywords: string[], hashtags: string[], livePersonId: number|null, livePlatform: string|null }} Event */
/** @typedef {Omit<Event,'id'|'type'|'clientMedia'>} EventProposal */
/** @typedef {{ match: Event|null, suggestions: Event[], proposal: EventProposal|null, placement: 'event'|'shared_story'|'unsorted' }} EventMatch */
```

  - `normKeyword`, `slugify`.
  - `matchEvent({ header, postedAt, events, people, formatName, timezone }) → EventMatch`. The entry's date is `header.live.date`, else `localDate(postedAt, timezone)`. All date comparisons use `daysBetween`. Rules in order:
    1. Keyword (normalised) or hashtag (case-insensitive) match.
    2. A live with exactly one person tag: same person + platform, with `|Δdate| ≤ LIVE_WINDOW_DAYS`.
    3. Otherwise, a proposal when there's a keyword, an event hashtag, or a live. If not, `shared_story` when `unknownHandleTags` is non-empty, else `unsorted`.
    4. Suggestions: events within ±`LIVE_WINDOW_DAYS`, excluding the match, newest first, at most 5.
  - `proposeEvent({ header, postedAt, people, formatName, timezone }) → EventProposal|null`. Name = keyword, or `formatName(displayName) + ' ' + platform`. Slug = `${slugify(name)}-${date}`.
- [ ] **Step 1: Write the failing tests:**
  - `'solluna  at starfest '` matches the event with keyword `'SOLLUNA AT STARFEST'`.
  - An empty header gives `placement 'unsorted'`.
  - A luna tiktok live on `2026-02-13` matches the event dated `2026-02-12`. On `2026-02-15` it proposes `{slug:'luna-tiktok-live-2026-02-15', name:'luna tiktok live', date:'2026-02-15', keywords:[], hashtags:[], livePersonId: LUNA, livePlatform:'tiktok live'}`.
  - `unknownHandleTags ['starguest']` gives `'shared_story'`.
  - **Midnight:** a luna tiktok live header with no date, posted `2026-02-12T17:30:00Z` (00:30 on the 13th in Bangkok), with `timezone 'Asia/Bangkok'`, proposes date `2026-02-13`. With `timezone 'UTC'` it proposes `2026-02-12`.
- [ ] **Step 2: FAIL** → **3: implement** → **4: PASS** → **5: Commit** — `"Event matching and proposals"`

---

### Task 8: Drafting a translation item (pure)

**Files:** Create `src/domain/draft.js`, `test/domain/draft.test.js`. Modify `types.js` (add `DraftContext`, `Draft`).

**Interfaces:**
- Consumes: `splitLines`/`findMarkers`, `parseHeader`, `resolveSpeakers`/`missingMarkers`/`personIdsFrom`, `matchEvent`/`proposeEvent`.
- Produces:

```js
/** @typedef {{ site: Site, people: Person[], events: Event[], ignoredHashtags: string[], remembered: SpeakerMap, chosen?: SpeakerMap,
 *   overrides?: { placement?: 'event'|'shared_story', eventId?: number, newEvent?: boolean, type?: string, clientMedia?: string } }} DraftContext */
/** @typedef {{ tweet: Tweet, header: Header, lines: Line[], markers: Marker[], speakerMap: SpeakerMap, missing: Marker[],
 *   placement: 'event'|'shared_story'|'unsorted', eventMatch: EventMatch, eventId: number|null, proposal: EventProposal|null,
 *   type: string|null, clientMedia: string|null, personIds: number[], sharingPersonId: number|null, aboutPersonIds: number[] }} Draft */
```

  `draftTranslation(tweet, ctx) → Draft` holds everything that decides what a translation item *is*. Ingest persists it; the add flow (Plan 2) previews it. Rules:
  - Person handles = `igHandle` plus `extraHashtags`. Platforms = `PLATFORMS` plus `site.extraPlatforms`. `timezone` = `site.timezone`, passed to `parseHeader`, `matchEvent` and `proposeEvent`.
  - **Overrides:** `placement`, `eventId`, and `newEvent` (gives `eventId = null` and a fresh proposal).
  - **Shared story:** `type = 'shared story'`, no event or proposal. `sharingPersonId` = the person whose handle matches the first person tag or unknown handle tag, if they exist. `aboutPersonIds` = `personIds` minus the sharer.
  - `type` = `overrides.type`, else the matched event's type.
- [ ] **Step 1: Write the failing tests:**
  - `LONG` with no memory gives missing `🦁 🌧️ 🐶 🐱` and a proposal named `'SOLLUNA AT STARFEST'`.
  - With all markers chosen, `missing` is empty and `personIds` includes sol and luna.
  - `EVENT_B` with events `[happyDay]` gives `eventId === happyDay.id`.
  - `SHARED` with `chosen {'🪇':{role:'speaker'}}` gives placement `'shared_story'`, type `'shared story'`, and `eventId null`.
  - `overrides.newEvent` on `EVENT_B` gives `eventId null` and a proposal.
- [ ] **Step 2: FAIL** → **3: implement** as a short pipeline → **4: PASS** → **5: Commit** — `"draftTranslation: pure interpretation of a tweet"`

---

### Task 9: Database, repositories, and seeding from the site

Read `docs/decisions/0006-data-model-conventions.md` (written in Step 1) before anything else. The schema is designed to need **few future migrations**:
- Every entity table carries the same bookkeeping columns.
- Small display-only extras go in `meta`.
- Many-to-many relations are normalised into join tables.
- Repeated strings become lookup rows.
- Things already known to be coming (projects, reports, the edit log, users, review state, other platforms) have their tables now.

**Files:** Create `docs/decisions/0006-data-model-conventions.md`, `src/db/client.js`, `src/db/migrate.js`, `src/db/migrations/001_initial.sql`, `src/repo/{visibility,rows,people,accounts,events,tags,lookups,items,itemPeople,itemSources,translations,speakers,speakerMemory}.js`, `src/services/seedFromSite.js`, `scripts/setup.js`, `test/helpers/db.js`, `test/db/*.test.js`, `test/repo/*.test.js`, `test/services/seedFromSite.test.js`. Modify `src/deps.js` (add `db`), `docs/architecture.md` (add a "Database conventions" section linking the ADR).

**Database conventions** (the ADR's content; also add them as rule 11 in `docs/architecture.md`):
1. **Every entity table** has `id bigint generated always as identity primary key` (lookup tables use `smallint`), plus `created_at`, `updated_at`, `created_by`, `updated_by`, `deleted_at`, `deleted_by` and `meta jsonb not null default '{}'`.
   - `updated_at` is maintained by one shared trigger.
   - `created_by`/`updated_by`/`deleted_by` reference `users(id)`.
   - Join tables carry only `created_at` and `created_by`.
2. **Soft delete only.** Rows are never hard-deleted by the app. "Gone" means `deleted_at is not null`, with a `deleted_reason` where it matters (items).
3. **Audit log, automatic.** One generic trigger writes every insert, update and soft delete on entity tables to `audit_log`, including the actor from `current_setting('app.actor', true)`. `db.transaction(fn, { actor })` sets `set local app.actor`. Nobody writes audit rows by hand. This is the Plan 2 edit log for free.
4. **`meta` is for display-only extras** (a venue's address, a lyric's composer). Anything filtered, joined, sorted, searched or unique gets a real column, added by a migration. The recipe in `CONTRIBUTING.md` explains the choice.
5. **Normalise repeated values.** Platforms, item kinds, categories (types) and clients are lookup rows referenced by id. Tags (hashtags and keywords) are stored once and joined. Accounts are stored once and referenced.
6. **Relations are join tables, not arrays or JSON:** people on items, tags on items and events, sources on items, links between items, and translation speakers.
7. **Lookups are extended by inserting rows** (a new platform or category is data, not schema). New item kinds still need a migration for their own table.
8. **Timestamps are `timestamptz`.** Calendar days are `date` in the **site time zone** (no per-row time zone). All text is UTF-8, stored verbatim.

**Interfaces:**
- Produces:
  - `createDb({ url?, dir? }) → Db`, where `Db = { query(sql, params?), transaction(fn: (tx: Db) => Promise<T>, { actor }) }`. Neon `Pool` when `url` is given; otherwise PGlite (`dir`, or in-memory) with `pg_trgm` (`@electric-sql/pglite/contrib/pg_trgm`).
  - `migrate(db, { dir }) → string[]`: uses `schema_migrations` and applies new `NNN_*.sql` files in order, one transaction each.
  - `visibleItem(alias='i')` is the SQL: `${alias}.deleted_at is null and ${alias}.review_state = 'published' and not exists (select 1 from accounts a where a.id = ${alias}.credited_account_id and a.opted_out_at is not null)`. Used by **every** read that returns items or counts.
  - **Repos** (`db` first; domain shapes out, so the domain types from Tasks 5–8 don't change):
    - `people`:
      - `listPeople()` → `Person[]`, where `igHandle` comes from the linked Instagram account and `extraHashtags` from `person_aliases`.
      - `addPerson({igHandle, displayName, emoji, colour}, {lowercaseNames, actor})`: creates the person and their Instagram account in one transaction.
      - `upsertFeatured(fp, {actor})` and `getPersonByHandle(ig)`.
    - `accounts`: `upsertAccount({platform, externalId, handle, displayName}, {actor}) → id` (matched by platform + external ID, or by platform + lowercase handle when there's no external ID), `getAccount(id)`, `getAccountByHandle(platform, handle)`.
    - `events`: `listEvents()` (with tags as `keywords`/`hashtags`), `createEvent(proposal, {actor}) → Event`, `getEventBySlug`, `listEventsWithCounts()`.
    - `tags`: `ensureTags([{kind:'hashtag'|'keyword', text}]) → ids` (dedupes on `(kind, norm)`), `ignoredHashtags()`, `setIgnored(texts)`.
    - `lookups`: `idOf(table, code) → number` (cached per `Db`), `ensureCategory(name)`, `ensureClient(name)`, `categories()`.
    - `items`: `itemState({platform, externalId}) → 'none'|'visible'|'removed'`, `insertItem(row, {actor}) → id`, `neighbours(itemId)`, `listVisibleItems({eventId?, personId?, accountId?, kind?})`.
    - `itemPeople`: `setItemPeople(itemId, [{personId, role}])`.
    - `itemSources`: `addSources(itemId, [{platform, externalId, url, role, position, accountId, startSeconds}])`.
    - `translations`: `insertTranslation(itemId, {body, textEnteredManually})`, `getVisibleTranslation({platform:'x', externalId})`, `listVisibleTranslations(filter)`.
    - `speakers`: `setSpeakers(itemId, SpeakerMap)` and `getSpeakers(itemId) → SpeakerMap` (converts rows to and from the domain `SpeakerMap`).
    - `speakerMemory`: `recall(accountId) → SpeakerMap` and `remember(accountId, SpeakerMap)`.
  - `seedFromSite(deps) → { people, hashtags, categories }`. It upserts featured people (with their Instagram accounts), sets the ignored hashtags, and ensures the site's types exist as categories. It's idempotent, and its actor is `'system'`.
  - `scripts/setup.js`: `loadSite` (exits 1 with errors), then `migrate`, then `seedFromSite`, then a summary.

  **`001_initial.sql`.** No fandom data. Write it with a helper block at the top that defines the two triggers, then apply `updated_at` and audit triggers to every entity table at the bottom (a `do $$ … foreach … $$` loop over the entity table names, so new tables only need adding to that list).

```sql
create extension if not exists pg_trgm;

-- shared triggers
create function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create table audit_log (
  id bigint generated always as identity primary key, table_name text not null, row_id bigint, row_key text,
  action text not null check (action in ('insert','update','delete')), actor text, at timestamptz not null default now(),
  before jsonb, after jsonb);
create index audit_log_row on audit_log (table_name, row_id);
create function write_audit() returns trigger language plpgsql as $$
begin
  insert into audit_log (table_name, row_id, action, actor, before, after)
  values (tg_table_name, coalesce((to_jsonb(new)->>'id')::bigint, (to_jsonb(old)->>'id')::bigint),
          lower(tg_op), current_setting('app.actor', true),
          case when tg_op <> 'INSERT' then to_jsonb(old) end, case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

-- users (Plan 2 links auth users here; 'system' does CLI/jobs)
create table users (
  id text primary key, display_name text, role text not null default 'member' check (role in ('owner','member','system')),
  blocked_at timestamptz, meta jsonb not null default '{}',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz);
insert into users (id, display_name, role) values ('system', 'system', 'system');

-- lookups (extend by inserting rows)
create table platforms (id smallint primary key, code text unique not null);
insert into platforms values (1,'x'),(2,'instagram'),(3,'tiktok'),(4,'youtube'),(5,'weverse'),(6,'telegram');
create table item_kinds (id smallint primary key, code text unique not null);
insert into item_kinds values (1,'translation');
create table categories (id smallint generated always as identity primary key, name text unique not null,
  created_at timestamptz not null default now(), deleted_at timestamptz);
create table clients (id smallint generated always as identity primary key, name text unique not null,
  created_at timestamptz not null default now(), deleted_at timestamptz);

-- macro for the common columns (written out in each table):
--   created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
--   created_by text references users(id), updated_by text references users(id),
--   deleted_at timestamptz, deleted_by text references users(id), meta jsonb not null default '{}'

create table people (
  id bigint generated always as identity primary key,
  display_name text not null, emoji text not null, colour text not null check (colour ~ '^#[0-9a-f]{6}$'),
  featured boolean not null default false, /* common columns */ ...);
create table person_aliases (person_id bigint not null references people(id), alias text primary key check (alias = lower(alias)),
  created_at timestamptz not null default now(), created_by text references users(id));

create table accounts (
  id bigint generated always as identity primary key,
  platform_id smallint not null references platforms(id), external_id text, handle text not null, display_name text,
  person_id bigint references people(id), opted_out_at timestamptz, /* common columns */ ...);
create unique index accounts_platform_external on accounts (platform_id, external_id) where external_id is not null;
create unique index accounts_platform_handle on accounts (platform_id, lower(handle)) where external_id is null and deleted_at is null;
create index accounts_person on accounts (person_id);

create table projects (
  id bigint generated always as identity primary key, slug text unique not null, name text not null,
  starts_on date, ends_on date, category_id smallint references categories(id), /* common columns */ ...);

create table events (
  id bigint generated always as identity primary key, slug text unique not null, name text not null,
  occurred_on date not null,            -- calendar date in the site time zone
  starts_at timestamptz,                -- exact start, when known
  project_id bigint references projects(id), category_id smallint references categories(id), client_id smallint references clients(id),
  live_person_id bigint references people(id), live_platform_id smallint references platforms(id),
  needs_review boolean not null default true, /* common columns */ ...);
create index events_occurred on events (occurred_on desc) where deleted_at is null;

create table tags (
  id bigint generated always as identity primary key, kind text not null check (kind in ('hashtag','keyword')),
  display text not null, norm text not null, ignored boolean not null default false,
  created_at timestamptz not null default now(), unique (kind, norm));
create table event_tags (event_id bigint not null references events(id), tag_id bigint not null references tags(id),
  created_at timestamptz not null default now(), primary key (event_id, tag_id));
create index event_tags_tag on event_tags (tag_id);

create table items (
  id bigint generated always as identity primary key,
  kind_id smallint not null references item_kinds(id),
  placement text not null check (placement in ('event','shared_story','unsorted')),
  event_id bigint references events(id), category_id smallint references categories(id), client_id smallint references clients(id),
  credited_account_id bigint references accounts(id), occurred_on date, posted_at timestamptz,
  added_via text not null check (added_via in ('submit','notion','paste','cli','telegram')),
  review_state text not null default 'published' check (review_state in ('pending','published','rejected')),
  sort_key double precision, deleted_reason text check (deleted_reason in ('removed_by_account','hidden_by_owner','duplicate','spam')),
  /* common columns */ ...);
create index items_event on items (event_id, sort_key) where deleted_at is null;
create index items_account on items (credited_account_id);
create index items_posted on items (posted_at desc) where deleted_at is null;

create table item_people (item_id bigint not null references items(id), person_id bigint not null references people(id),
  role text not null check (role in ('present','sharing','about')), created_at timestamptz not null default now(),
  primary key (item_id, person_id, role));
create index item_people_person on item_people (person_id);
create table item_tags (item_id bigint not null references items(id), tag_id bigint not null references tags(id),
  created_at timestamptz not null default now(), primary key (item_id, tag_id));
create index item_tags_tag on item_tags (tag_id);
create table item_sources (
  id bigint generated always as identity primary key, item_id bigint not null references items(id),
  platform_id smallint not null references platforms(id), external_id text, url text not null,
  role text not null check (role in ('primary','follow_up','media','quoted','full_video')),
  position smallint not null default 0, account_id bigint references accounts(id), start_seconds int,
  status text not null default 'live' check (status in ('live','deleted','unavailable')), checked_at timestamptz,
  created_at timestamptz not null default now());
create unique index item_sources_primary on item_sources (platform_id, external_id) where role = 'primary';
create index item_sources_item on item_sources (item_id);
create table item_links (from_item_id bigint not null references items(id), to_item_id bigint not null references items(id),
  relation text not null check (relation in ('follows_on')), created_at timestamptz not null default now(),
  primary key (from_item_id, to_item_id, relation));

create table translations (
  item_id bigint primary key references items(id), body text not null, text_entered_manually boolean not null default false);
create index translations_body_trgm on translations using gin (body gin_trgm_ops);
create table translation_speakers (
  item_id bigint not null references translations(item_id), marker text not null,
  person_id bigint references people(id), role text check (role in ('host','fan','speaker','crowd')),
  check ((person_id is null) <> (role is null)), primary key (item_id, marker));
create index translation_speakers_person on translation_speakers (person_id);
create table speaker_memory (
  account_id bigint not null references accounts(id), marker text not null,
  person_id bigint references people(id), role text check (role in ('host','fan','speaker','crowd')),
  check ((person_id is null) <> (role is null)), updated_at timestamptz not null default now(),
  primary key (account_id, marker));

create table reports (
  id bigint generated always as identity primary key, target_table text not null, target_id bigint not null,
  reason text not null, status text not null default 'open' check (status in ('open','resolved','dismissed')),
  /* common columns */ ...);

-- then: do $$ declare t text; begin foreach t in array array['users','people','accounts','projects','events','items','reports'] loop
--   execute format('create trigger %I_updated before update on %I for each row execute function set_updated_at()', t, t);
--   execute format('create trigger %I_audit after insert or update or delete on %I for each row execute function write_audit()', t, t);
-- end loop; end $$;
```

  Write out the `/* common columns */ ...` placeholders in full in the real file (the `--` comment above lists them). Join tables, lookups and `translation_speakers` are covered by their parent's audit: the repo touches the parent's `updated_at` in the same transaction. The search index is **trigram only** (no stored tsvector); trigram covers English words and Thai substrings, and it halves the text storage.

- [ ] **Step 1: Write `0006-data-model-conventions.md`** (the 8 conventions above, with the why: fewer migrations, space, other platforms and kinds, a free edit log). Add rule 11 to `docs/architecture.md`.
- [ ] **Step 2: Write the failing tests** (`freshDb()` = in-memory PGlite with migrations):
  - **migrate:**
    - Applies `['001_initial.sql']`, then `[]`.
    - A temp dir with `001` + `002` applies in order; adding `003` applies only that.
  - **triggers:**
    - Updating a person changes `updated_at`.
    - `db.transaction(fn, {actor:'system'})` that inserts an event writes one `audit_log` row with `action 'insert'` and `actor 'system'`.
    - A soft delete (`set deleted_at`) writes an `update` row whose `after.deleted_at` is not null.
  - **seedFromSite:**
    - The example site yields sol and luna, each with an Instagram account (`listPeople()[0].igHandle === 'solsunny'`).
    - The second fixture site updates colours, adds its people, and swaps the ignored tags.
    - Running it twice adds nothing: same row counts in `people`, `accounts` and `tags`.
  - **people:** `addPerson` with `'@Leo_X'`/`'Leo'` stores alias-free `leo_x` and the name `'leo'` when lowercase. Adding the same IG handle twice throws `duplicate person`.
  - **accounts:**
    - Upserting X account `externalId '9001'` twice with different handles gives one row with the new handle.
    - Instagram accounts without an external ID are matched by lowercase handle.
  - **tags:** `ensureTags` on `#SLHappyDay2026` and `#slhappyday2026` gives one row. `setIgnored(['solluna'])` makes `ignoredHashtags()` return `['solluna']`.
  - **items:**
    - `itemState` goes `'none' → 'visible'` after inserting an item with a primary X source, then `'removed'` after setting `deleted_at` + `deleted_reason 'removed_by_account'`.
    - Inserting a second item with the same primary source throws.
  - **visibility:** opted-out accounts' items and `review_state 'pending'` items are absent from `listVisibleItems` and the `listEventsWithCounts` counts.
  - **speakers:** `setSpeakers(id, {'🐶':{person:1}, '🌧️':{role:'speaker'}})` then `getSpeakers(id)` round-trips. A row with both `person` and `role` set is rejected by the check.
  - **speakerMemory:** `remember`/`recall` round-trips, and a second `remember` of the same marker overwrites it.
  - **Space sanity:** after ingest-style inserts of the same hashtag on 3 items, `tags` has 1 row and `item_tags` has 3.
- [ ] **Step 3: Run `npm test`. Expected: FAIL.** — [ ] **Step 4: Implement**, one repo per file, each under the lint limits.
- [ ] **Step 5: Run `npm test && npm run check`, then `PGLITE_DIR=.devdb npm run setup`.** **Expected:** `migrated 001_initial.sql`, `seeded 2 people`.
- [ ] **Step 6: Commit** — `"Data model ADR, audited soft-delete schema, normalised repositories, setup from site"`

---

### Task 10: Ingest service and owner CLI

**Files:** Create `src/services/ingest.js`, `scripts/add.js`, `test/services/ingest.test.js`

**Interfaces:**
- Produces: `ingestTranslation(deps, input: string|Tweet, { chosen?, overrides?, addedBy, addedVia }) → Promise<IngestResult>`

```js
/** @typedef {{ status: 'added'|'duplicate'|'removed'|'opted_out'|'deleted'|'unavailable'|'needs_speakers',
 *   sourceId: string, itemId?: number, eventId?: number|null, missing?: Marker[], draft?: Draft }} IngestResult */
```

  **Flow:** small private steps, so the function reads as this list:
  1. `itemState({platform:'x', externalId})` → **duplicate** / **removed**.
  2. `fetchTweet` (unless given a `Tweet`) → **deleted** / **unavailable**.
  3. The account has opted out → **opted_out**.
  4. Load the context (`deps.site`, people, events, ignored hashtags, `recall`), then `draftTranslation`.
  5. Anything missing → **needs_speakers** (with `missing` and `draft`).
  6. Create the event from the proposal if needed.
  7. In one `db.transaction(…, { actor: addedBy })`:
     - `upsertAccount` for the translator (`x`, author ID).
     - Create the event if needed (tags via `ensureTags`).
     - `insertItem` (category and client via `lookups`).
     - `addSources`: primary; follow-ups; media, with the clip-source account upserted by handle; quoted.
     - `setItemPeople` (`present` for mapped people, plus `sharing`/`about` for shared stories).
     - Item tags, `insertTranslation({ body: tweet.text })`, `setSpeakers`, `remember`.

     Each mapping lives in a small private `to…Rows(draft)` function.
  8. **added**.

  `scripts/add.js <url|id> [--map '🐶=solsunny,🐱=lunamoon,🦁=role:host'] [--shared-story] [--event <slug>] [--new-event]` is argument parsing plus one call, with no logic. On `needs_speakers` it prints each missing marker (count + example) and exits with code 2.
- [ ] **Step 1: Write the failing tests** (deps: `freshDb()` seeded from the example site, `fakeFetch` over the fixtures, a fixed `now`, `site = loadSite()`):

```js
test('needs speakers → added → memory carries to the next tweet by the same translator', async () => {
  assert.equal((await ingestTranslation(deps, LONG, { addedBy: 't', addedVia: 'cli' })).status, 'needs_speakers');
  const host = await addPerson(deps.db, { igHandle: 'host_x', displayName: 'host x', emoji: '🦁', colour: '#2fa89a' }, { lowercaseNames: true });
  const chosen = { '🐶': { person: SOL }, '🐱': { person: LUNA }, '🦁': { person: host.id }, '🌧️': { role: 'speaker' } };
  assert.equal((await ingestTranslation(deps, LONG, { chosen, addedBy: 't', addedVia: 'cli' })).status, 'added');
  const r = await ingestTranslation(deps, LIVE, { addedBy: 't', addedVia: 'cli' });
  assert.ok(!(r.missing ?? []).some(m => m.marker === '🐱'));
});
test('two translators land in one event', async () => {
  await ingestTranslation(deps, EVENT_A, { addedBy: 't', addedVia: 'cli' });
  assert.equal((await ingestTranslation(deps, EVENT_B, { addedBy: 't', addedVia: 'cli' })).status, 'added');
  assert.equal((await deps.db.query('select count(distinct event_id)::int n from items')).rows[0].n, 1);
  assert.equal((await deps.db.query("select count(*)::int n from tags where norm = '#slhappyday2026'")).rows[0].n, 1);
});
```

  Plus:
  - **duplicate**, **removed** and **opted_out** cases.
  - `SHARED` with `{'🪇':{role:'speaker'}}` stores `placement 'shared_story'`, `event_id null`, and category `'shared story'`.
  - A failure inside the transaction (inject a db whose `insertTranslation` throws) leaves no orphan `items` row and no `audit_log` row.
  - `EVENT_A` stores a `media` source with account `clipper_one`, and the `audit_log` actor for the new item is `'t'`. Add `'t'` as a user in the test setup.
- [ ] **Step 2: FAIL** → **3: implement** → **4: PASS** → **5: Commit** — `"Ingest service and owner add CLI"`

---

### Task 11: Presenters

**Files:** Create `src/services/views.js`, `test/services/views.test.js`

**Interfaces:**
- Produces (pure):
  - `toPreview(item, peopleById) → Preview`, where `Preview = { kind, sourceId, url, preview: string[], personIds, accountHandle, hasVideo, followsOnFrom }`. `url` comes from `kindByName(kind).urlPrefix`. For translations, `preview` is the first 2 speech lines as `"<emoji> <text>"`, using standard emoji for mapped people and the marker otherwise. If there are no speech lines, it's the first 2 non-header plain lines.
  - `toTranslationView(item, peopleById, site) → { …public fields, lines, cast }`, where `CastItem = {kind:'person', id, name, emoji, colour} | {kind:'role', role, marker}`. Cast is in first-appearance order, without crowd, and names go through `formatName(site, …)`.
  - `toSections(items, peopleById) → [{ kind, items: Preview[] }]`, in `KINDS` order, omitting empty kinds.
  - `groupByEvent(items, eventsById) → [{ event|null, placement, sections }]`.
- [ ] **Step 1: Write the failing tests:**
  - The `LONG` preview starts with `'🦁 '` when host x's emoji is 🦁, and a mapped `🐱` shows luna's standard `🌙`.
  - The `LONG` cast is `[host x, speaker(🌧️), sol, luna]` (first-appearance order), with no crowd.
  - `toSections` yields `[{kind:'translation', …}]`.
  - `groupByEvent` gives shared stories their own group with `event: null`.
- [ ] **Step 2: FAIL** → **3: implement** → **4: PASS** → **5: Commit** — `"Presenters with per-kind sections"`

---

### Task 12: Search service

**Files:** Create `src/services/search.js`, `test/services/search.test.js`

**Interfaces:**
- Produces: `search(deps, { q='', people=[], peopleMode='any', types=[], kinds=['translation'], eventSlug, accountHandle, clientMedia, from, to, limit=50, offset=0 }) → { count, results: Result[] }`
  - `Result = { kind, sourceId, url, event: {slug,name,date}|null, placement, postedAt, accountHandle, personIds, matchLines }`
  - **Clause builders:** `textClause`, `peopleClause`, `typeClause`, `eventClause`, `accountClause`, `clientClause`, `dateClause` each return `{sql, params}` and are combined by `buildWhere`, which **always** adds `visibleItem('i')`.
  - **Text matching** (translations): `t.body ilike '%'||$n||'%'` (served by the trigram index), or a keyword/hashtag tag whose `norm` contains `lower($n)`. Later kinds add their own text clause through their repo, so search stays open for extension.
  - **People:** `'any'` is `exists (select 1 from item_people ip where ip.item_id = i.id and ip.person_id = any($n))`; `'all'` is `(select count(distinct ip.person_id) from item_people ip where ip.item_id = i.id and ip.person_id = any($n)) = cardinality($n)`.
  - **matchLines:** up to 2 lines containing `q`. With no `q`, the first 2 speech lines.
  - **Count only:** `limit=0`.
- [ ] **Step 1: Write the failing tests** (seed: all 5 live fixtures ingested with full maps):
  - `q:'hug'` finds `LONG`.
  - `q:'ครบ'` puts `LONG` first, with a match line containing `ครบ`.
  - With `people [SOL, LUNA]`, `'all'` gives no more results than `'any'`, and more than zero.
  - `types:['shared story']` gives `[SHARED]`.
  - `limit 0` returns the count with empty results.
  - Removed and opted-out items never appear.
  - `q:"'; drop table items; --"` gives count 0, and the table still exists.
  - `review_state 'pending'` items never appear.
- [ ] **Step 2: FAIL** → **3: implement** → **4: PASS** → **5: Commit** — `"Search service"`

---

### Task 13: HTTP layer and public API

**Files:** Create `src/http/{handler,errors,query}.js`, `api/{home,event,item,search,person,account,video}.js`, `test/api/*.test.js`

**Interfaces:**
- Produces:
  - `handler(run, { cache='no-store' }={}) → (req,res)`: `NotFound` → 404, `BadRequest` → 400, anything else → 500 (logged). Success is 200 JSON with the `Cache-Control` header.
  - `query.js`: `str`, `int`, `list`, `ints`.
  - Each `api/*.js` file has `export async function run({ query }, deps)` (under 30 lines; no SQL) and `export default handler(run, …)`.
  - **Endpoints:**
    - `home`: `{ months: [{ month:'YYYY-MM', events:[{slug,name,date,hashtag,count}] }] }` (`s-maxage=60`).
    - `event?slug=`: `{ event, accountCount, sections }`. 404 if not found.
    - `item?id=` (source ID): `toTranslationView & { prev, next }`. 404 if missing or removed.
    - `search?…`: the `search()` output.
    - `person?ig=`: `{ person, counts:{items, events, sharedStories}, groups }`.
    - `account?handle=`: `{ account:{handle, optedOut}, counts?, groups? }`. When opted out, it returns only the `account` part.
    - `video?id=`: `{ variants }`. 404 unless the tweet is live with a video (`s-maxage=600`).
- [ ] **Step 1: Write the failing tests:**
  - **`run` called directly with test deps:**
    - `home` groups 2026 events by month.
    - `event` returns `sections[0].kind === 'translation'`.
    - `item` for a removed item throws `NotFound`.
    - `account` for an opted-out handle returns the opted-out shape only.
    - `video` for `TOMB` throws `NotFound`.
  - **`handler` with a fake `res`:** maps 404 and 500 correctly.
- [ ] **Step 2: FAIL** → **3: implement** → **4: PASS** → **5: Commit** — `"HTTP layer and public API"`

---

### Task 14: Front-end core, components, sections

**Files:** Create `public/css/{base,layout,cards,bubbles,search}.css`, `public/js/core/{esc,api,dom,format,site}.js`, `public/js/components/{header,tabBar,bubbles,cast,eventCard,previewCard,resultCard,chips,personHeader}.js`, `public/js/sections/{index,translation}.js`, `test/components/*.test.js`, `test/sections/*.test.js`

**Interfaces:**
- Produces:
  - **core:**
    - `esc`.
    - `getJson(path, params?)`, which throws `ApiError{status}` on a non-OK response.
    - `mount(el, html)` and `on(el, selector, event, fn)`.
    - `monthLabel('2026-10') → 'october 2026'` and `dayLabel('2026-10-14') → '14 Oct 2026'`. Dates are never converted.
    - `timePair(instantIso, siteTz, viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone) → string`: `'4:00 pm paris · 10:00 pm bangkok'`. The city is the last part of the IANA name, lowercased, with `_` becoming a space. If both zones are the same, it returns a single value (`'10:00 pm bangkok'`).
    - `site.js` re-exports `/site/site.js` (name, wordmark, tagline, lowercaseNames, copy) and `t(key, vars?)` for copy with `{n}` placeholders.
  - **components:** each exports `render(props) → string`. They're pure, escape everything, never fetch, and take all wording from `t()`.
    - `header.render({ compact, site })`: logo `/site/logo.*`, wordmark (accent in the gradient), tagline, FAN-MADE.
    - `tabBar.render({ active })`.
    - `bubbles.render({ lines, speakerMap, peopleById })`:
      - A person line becomes a `.msg` with their standard emoji, name, and `style="--c:<colour>"`.
      - A role line keeps the marker and uses the role name.
      - Crowd becomes `.crowd`.
      - Same speaker consecutively becomes `.msg.cont`.
      - Plain lines become `.plain`, and footnotes collect in `.notes`.
    - `cast`, `eventCard`, `previewCard`, `resultCard` (escape, then `<mark>` the case-insensitive `q`), `chips`, `personHeader`.
  - **sections:**
    - `sections/index.js` exports `SECTIONS = { translation }` and `renderSections(sections, ctx) → string`, which looks up each section's `kind` and skips unknown kinds rather than throwing.
    - `sections/translation.js` exports `render({ items, peopleById })`.
  - **CSS:** only `var(--…)` tokens, which come from `/site/theme.css`. Classes only; the one inline style is `--c`.
- [ ] **Step 1: Write the failing tests:**
  - `esc` escapes `& < > " '`.
  - `timePair('2026-02-12T15:00:00Z', 'Asia/Bangkok', 'Europe/Paris')` gives `'4:00 pm paris · 10:00 pm bangkok'`. With the same zone twice, it gives one value.
  - **Bubbles:** standard emoji (`🌙` replaces `🐱`), formatted names, one `.msg.cont`, `.crowd`, and `<script>` escaped. A role keeps the translator's emoji. Plain and footnotes are kept verbatim.
  - **resultCard:** escapes before highlighting.
  - **header:** renders the wordmark accent from the passed `site`, plus FAN-MADE.
  - **renderSections:** ignores an unknown kind.
  - **Purity:** components contain no literal UI strings that exist in `copyDefaults.json`. A test scans the component sources for each default copy value longer than 3 characters.
- [ ] **Step 2: FAIL** → **3: implement**, matching `../emibonnie-archive/docs/superpowers/specs/mockups/screens-v2.html`, `speaker-style-v2.html` and `search-v2.html` → **4: PASS** → **5: Commit** — `"Front-end core, components, per-kind sections"`

---

### Task 15: Home, event, and item pages

**Files:** Create `public/{index,event,item,soon}.html`, `public/js/components/videoPlayer.js`, `public/js/pages/{home,event,item}.js`, `scripts/seedDev.js`, `site/seed/` (the example site's dev seed: copies of the synthetic fixtures plus `maps.json`), `test/components/videoPlayer.test.js`

**Interfaces:**
- Produces:
  - `videoPlayer.pickVariant(variants, isSmall)`: the smallest when `isSmall`, otherwise the largest at or below 2,200,000 bps (or the smallest).
  - `videoPlayer.render` and `bind(el, {sourceId})`: fetches `/api/video`; on a 404 or `error` it swaps in `t('sourceGone')`.
  - Each page module exports `start()` (read URL → `getJson` → compose → `mount` → bind). Page modules contain no HTML strings.
  - `scripts/seedDev.js`: `setup`, then ingest every `site/seed/tweets/*.syn.json` offline (through `fakeFetch`), using `site/seed/maps.json` (`{ "<sourceId>": { "chosen": {...}, "overrides": {...}, "createPeople": [...] } }`, where person references are IG handles resolved at seed time).
- [ ] **Step 1: Failing test for `pickVariant`** (632k / 950k / 2176k / 10368k: small gives 632k, large gives 2176k) → **FAIL** → implement → **PASS**.
- [ ] **Step 2: Seed.** Run `PGLITE_DIR=.devdb node scripts/seedDev.js`. **Expected:** `seeded 5`. `npm run dev` uses `PGLITE_DIR=.devdb` when `DATABASE_URL` is unset.
- [ ] **Step 3: Pages.**
  - **Home:** header, search box (goes to `/search`), filter icon (goes to `/search?filters=1`), month groups, event cards.
  - **Event:**
    - Back link, name, meta line (`dayLabel · N translations · M translators`), pills.
    - People chips and an account filter, plus a search icon linking to `/search?event=<slug>`.
    - `renderSections(sections)`, a "newest first" toggle, and Report (goes to `/soon.html`).
  - **Item (translation):**
    - **Under 860px:** sticky `.vid` at the top.
    - **860px and wider:** a two-column grid with the sticky video and prev/next on the left; credits (`tl @handle · clip by @source · date`), pills, cast and bubbles on the right.
    - The posted time uses `timePair`.
    - Footer: original tweet, original media, follows on from, added by, Copy link, Report.
    - "show original" opens a `<pre>` with the escaped verbatim text.
- [ ] **Step 4: Check in the browser** at 390px and 1280px, with screenshots attached to the task report via the `run` or `browse` skill. **Expected:**
  - Pages show the example site's name, logo and colours.
  - Bubbles show ☀️/🌙.
  - The video stays put while the text scrolls.
  - `npm run check` passes.
- [ ] **Step 5: Commit** — `"Home, event, and item pages"`

---

### Task 16: Search page

**Files:** Create `public/search.html`, `public/js/state/searchState.js`, `public/js/components/filterSheet.js`, `public/js/pages/search.js`, `test/state/searchState.test.js`, `test/components/filterSheet.test.js`

**Interfaces:**
- Produces:
  - `searchState`: `parseState`, `toQuery`, `filterCount` (excludes `q`), `withFilter`, `withoutFilter` (all immutable). `State = { q, people, peopleMode, types, event, account, client, from, to }`. **The URL is the single source of truth.** Scoped search is just a link.
  - `filterSheet.render({ state, people, types, events, accounts, count })` (the "who's in it" any-of/all-of switch, type chips, selects, and `t('showN', {n})`) and `bind(el, { state, onChange })`.
- [ ] **Step 1: Write the failing tests:**
  - **searchState:** a round trip; empty values omitted; `filterCount({people:[2], types:['live']}) === 2`; `withoutFilter` removes a single value; `peopleMode` defaults to `'any'`.
  - **filterSheet:** renders the count text for `count: 3`, and marks selected chips `.on`.
- [ ] **Step 2: FAIL** → **3: implement** the module, then the page:
  - Autofocused box, filter icon with badge, removable chips, "clear all".
  - Empty state with recent searches (`localStorage` behind try/catch, last 8) and quick chips.
  - Changes go through `history.replaceState`, then re-fetch. The count uses `limit=0`.
  - Person, account and event pages link to their scoped URL.
- [ ] **Step 4: PASS, then check in the browser:**
  - `/search?q=ครบ` finds `LONG`.
  - Picking luna + live shows a `2` badge.
  - Removing a chip updates the URL and the results.
- [ ] **Step 5: Commit** — `"Search page with filter sheet and scoped search"`

---

### Task 17: Person and account pages

**Files:** Create `public/{person,account}.html`, `public/js/pages/{person,account}.js`

- [ ] **Step 1: Person page.**
  - `personHeader` (in their colour).
  - A segmented control: by event / all, newest / with… ("with…" goes to `/search?people=<a>,<b>&peopleMode=all`).
  - Groups rendered through `renderSections`, with shared stories labelled. A search icon goes to `/search?people=<id>`.
- [ ] **Step 2: Account (translator) page.**
  - Handle, "open profile ↗", totals, and groups.
  - When opted out, it shows only `t('accountOptedOut')`.
- [ ] **Step 3: Check in the browser.**
  - `/p/lunamoon` lists `LONG`, `LIVE` and `SHARED`.
  - `/tl/tl_alpha` lists 3 items.
  - After opting out `tl_gamma` in `.devdb`, `/tl/tl_gamma` shows only the opted-out line, and the HAPPY DAY event counts 1.
  - `npm run check` passes.
- [ ] **Step 4: Commit** — `"Person and account pages"`

---

### Task 18: Contributor framework: scaffolder, recipes, start-your-own guide, CI

**Files:** Create `scripts/new.js`, `scripts/templates/{endpoint,page,component,repo,service,domain,migration,kind}/…`, `test/scripts/new.test.js`, `docs/start-your-own.md`, `.github/workflows/ci.yml`. Modify `CONTRIBUTING.md`, `site/README.md`, `package.json` (add `"new"`), `docs/architecture.md`, `CHANGELOG.md`.

**Interfaces:**
- Produces: `scaffold({ kind, name, root='.' }) → string[]` and the CLI `npm run new <kind> <name>`.
  - **Kinds and what they create:**
    - `endpoint`: `api/<name>.js` + test
    - `page`: html + page module, and prints the `vercel.json` rewrite to add
    - `component`: component + test
    - `repo`: repo + test
    - `service`: service + test
    - `domain`: domain module + test
    - `migration`: `<next NNN>_<name>.sql`
    - **`kind`:** a migration (inserts the `item_kinds` row and creates a `<name>s` table with `item_id bigint primary key references items(id)`), `src/repo/<name>s.js`, `src/domain/<name>.js`, `public/js/sections/<name>.js`, and tests. It prints the two registry lines to add (`KINDS`, `SECTIONS`).
  - **Name rules:** `name` must match `^[a-z][a-zA-Z0-9]*$`, or `^[a-z0-9_]+$` for migrations. It refuses to overwrite and exits 1 with a message.
  - **Templates** are minimal, passing, rule-following examples: `// @ts-check`, `handler(run)`, `render(props)` with `esc` and `t()`, `deps` first, and green tests. Placeholders are `__name__`/`__Name__`.
- [ ] **Step 1: Write the failing tests** (in a temp copy of the repo):
  - `component badge` creates 2 files with `export function render(`.
  - `migration add_reports` creates `002_add_reports.sql`.
  - `kind photo` creates the 4 source files, plus tests and a migration.
  - Scaffolding a name twice throws `already exists`.
  - `Bad-Name` throws.
- [ ] **Step 2: FAIL** → **3: implement** → **4: PASS.**
- [ ] **Step 5: Prove every template is green in the real repo.**
  - For each kind, run `npm run new <kind> zzCheck` (`zz_check` for migrations). For `kind`, also add the printed registry lines.
  - Then run `npm run check && npm test`. **Expected:** PASS. Then remove everything generated and confirm a clean `git status`.
- [ ] **Step 6: `CONTRIBUTING.md` recipes.** One per row of the Extension points table, each with: when to use it, the command, the steps after scaffolding, a real file to copy from, and what review checks. Worked examples:
  - **"Add 'weverse live' as a platform":** one line in `PLATFORMS` and one header test, or `extraPlatforms` in one site's `site.json`.
  - **"Add a `youtube` item kind":** `npm run new kind youtube`, fill the domain parser, add the registry lines, add a section. It shows that translations code is untouched.
- [ ] **Step 7: Site owner docs.**
  - `site/README.md`: every `site.json` field (type, required/default, example), `theme.css` tokens, `copy.json` keys (generated list), and `seed/`.
  - `docs/start-your-own.md`, for a fan comfortable following steps:
    1. Use this template on GitHub (keep the repo private until ready).
    2. Edit `site/` (name, people, colours, logo, copy).
    3. Create a Neon project (free, directly at neon.com).
    4. Create a Vercel project without Git, `vercel link`, token.
    5. Create the X developer app and Google OAuth client (Plan 2).
    6. Add the secrets.
    7. `npm run setup` against Neon.
    8. Add a deploy workflow (copy from the emibonnie example in `docs/deploy-workflow.example.yml`).
    9. Push to deploy.
    10. Pull updates: `git remote add upstream git@github.com:mintbluecar/fan-archive.git`, then `git pull upstream main`.

    Include a troubleshooting list for `setup` errors.
  - `docs/deploy-workflow.example.yml`: the same workflow as Task 20.
  - `CHANGELOG.md`: a `0.1.0` entry.
- [ ] **Step 8: CI.** `.github/workflows/ci.yml` runs `npm ci && npm run build && npm run check && npm test` on pull requests and pushes. The template has **no deploy workflow**; deploying belongs to each site.
- [ ] **Step 9: Run `npm run check && npm test`. Expected: PASS. Commit** — `"Contributor framework: scaffolder incl. item kinds, recipes, site docs, CI"`

---

### Task 19: The emibonnie site

**Work in `emibonnie-archive/`.**

**Files:**
- Merge in the engine.
- Create `site/site.json`, `site/theme.css`, `site/copy.json`, `site/logo.png`, `site/seed/` (the real example tweets moved from `test/fixtures/tweets/`, plus `maps.json`).

- [ ] **Step 1: Bring in the engine.** `git remote add upstream ../fan-archive` for now (later `git@github.com:mintbluecar/fan-archive.git`), then `git pull upstream main --allow-unrelated-histories`. Resolve by keeping `emibonnie-archive`'s `docs/superpowers/` and taking everything else from upstream. Check `git config user.email`: **expected** `bluerotcar@gmail.com`.
- [ ] **Step 2: Replace the example `site/`** with emibonnie's values from the spec:
  - **name:** "emibonnie archive", wordmark `{accent:'emibonnie', rest:'archive'}`, tagline "fan translations, kept", `lowercaseNames: true`, `sourceLanguage: 'th'`, `timezone: 'Asia/Bangkok'`.
  - **featuredPeople:**
    - `{igHandle:'emiamily', displayName:'emi', emoji:'🧡', colour:'#ff8a3d'}`
    - `{igHandle:'beonnnie', displayName:'bonnie', emoji:'💜', colour:'#9b6cff'}`
  - **defaultMarkers:** `{'💜':{personHandle:'beonnnie'}, '🧡':{personHandle:'emiamily'}, '🗣️':{role:'crowd'}, '💬':{role:'fan'}}`.
  - **ignoredHashtags:** `['emibonnie','namtanfilm']`.
  - **ownerXUserId:** `'1957464086339534848'` (the owner's fan X account from the sign-in test).
  - **theme.css:** paper `#f6efe3`, card `#fffdf8`, line `#eadfce`, ink `#2b2233`, muted `#8a7f8f`, gradient `#ff6a2b → #e03a85`, Nunito + IBM Plex Sans Thai.
  - **logo.png:** from `docs/superpowers/specs/mockups/logo.png`.
- [ ] **Step 3: Seed.** Move `test/fixtures/tweets/*.json` to `site/seed/tweets/`. Write `site/seed/maps.json` for the 6 real tweets, using the spec's mappings: @vacantvolcanic 🐰 → beonnnie, 🦊 → emiamily, 🦁 → leo, 🌧️ → role speaker, 🪇 → role speaker; @danaNYB and @SugarHoneyz13 use the defaults. **Leo:** `createPeople: [{igHandle:'leo_saussay', displayName:'leo', emoji:'🦁', colour:'#2fa89a'}]`.
- [ ] **Step 4: Verify.**
  - `npm run build && npm test && npm run check` pass. **The engine's purity test passes**, because emibonnie's names now appear only inside `site/` and `docs/`; the purity test scans engine folders only.
  - `PGLITE_DIR=.devdb node scripts/seedDev.js` prints `seeded 6`.
  - `npm run dev` at 390px and 1280px matches `docs/superpowers/specs/mockups/screens-v2.html`: 🧡/💜 bubbles, the logo, FAN-MADE, the paper colour.
- [ ] **Step 5: Commit** in `emibonnie-archive` — `"emibonnie site on the fan-archive engine"`

---

### Task 20: Deploy emibonnie (needs the owner)

**Work in `emibonnie-archive/`. Files:** create `.github/workflows/deploy.yml` (from `docs/deploy-workflow.example.yml`), `docs/deploy.md`.

**Owner steps.** Pause, ask the owner to do these in their **fan accounts**, and confirm before continuing:
1. Create a Neon project directly at neon.com (free) and copy the connection string.
2. Create a Vercel project (Hobby) **without** Git, run `vercel link` locally, and create a token.
3. Create the private GitHub repos `mintbluecar/fan-archive` and `mintbluecar/emibonnie-archive`.
4. Add the `emibonnie-archive` repo secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, and `DATABASE_URL` in the Vercel env (Production and Preview).

**Interfaces:**
- Produces: `deploy.yml`. On push to `main`, it runs `npm ci && npm run build && npm run check && npm test`, then `vercel pull --yes --environment=production`, `vercel build --prod`, and `vercel deploy --prebuilt --prod`, each with `--token=${{ secrets.VERCEL_TOKEN }}`. On pull requests it does the same with `preview`.

- [ ] **Step 1: Write `deploy.yml` and `docs/deploy.md`** (the owner steps and `DATABASE_URL=… npm run setup`).
- [ ] **Step 2: Set up the database:** `DATABASE_URL=… npm run setup`. **Expected:** `migrated 001_initial.sql`, then `seeded 2 people`.
- [ ] **Step 3: Load the data:** `DATABASE_URL=… npm run add -- <id> --map …` for the 6 real tweets. **Expected:** `added` ×6.
- [ ] **Step 4: Commit. Ask the owner whether to push**, both `fan-archive` and `emibonnie-archive` (then switch `upstream` to the GitHub URL). Push only on a yes. After pushing, check that Actions is green and open the production URL on a phone. **Expected:** home lists the events, and an entry's video plays and stays pinned while scrolling.

---

## Self-review notes

- **Spec coverage in this plan:**
  - Items and item kinds (translation first; shared fields, kind table, sections, kinds registry).
  - Events (keyword/hashtag, lives ±1 day, separate-event override at the draft level), shared stories, people (IG identity, person hashtags, lowercase via setting), roles.
  - Two-source fetch, speaker display, search with filters and scoped search, all public pages, video with the deleted fallback, visual design via `site/theme.css`.
  - Reusable template (`site/`, setup, copy, purity test, synthetic fixtures, start-your-own guide, upstream updates).
  - Contributor framework (recipes, scaffolder including item kinds, ADRs, PR template, CI).
  - Deploy via Actions, Neon direct, removed/opted-out exclusion.
- **Data model:** audited soft deletes, `meta`, lookups, tags, join tables, multi-platform accounts and sources, and `projects`, `reports`, `users` and `review_state` all exist from migration 001. Plans 2–3 should need few or no schema migrations: auth tables come from the auth library, plus possibly a jobs table.
- **Seams for later plans:**
  - `draftTranslation` and `resolveSpeakers` serve the add-flow preview (Plan 2) and the import mapping (Plan 3).
  - `ingestTranslation` is the single write path.
  - `visibleItem` covers remove/opt-out for every kind.
  - `KINDS` and `SECTIONS` registries plus `npm run new kind` cover photos, YouTube, lyrics and milestones.
  - Projects arrive as a migration (a `projects` table and `events.project_id`), a repo, and a hub page.
- **Deferred to Plan 2:** sign-in, add-flow UI (event picker, separate event, inline new-event setup), me page, remove/restore/opt-out UI, reports, translator welcome, edit log, blocking, approval switch.
- **Deferred to Plan 3:** admin, Notion/paste import with per-translator mapping, Actions jobs (import worker, health check, private backup), alerts.
