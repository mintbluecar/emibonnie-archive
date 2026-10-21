# Plan 1a: Engine Foundations

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The `fan-archive` engine, minus its pages. It has:
- a site-settings system and the example site
- tweet sources
- the parsing and matching domain
- an audited, normalised Postgres schema
- the item-kind plugin system, with `translation` as the first kind
- ingest, search, and a JSON API behind one router function, with an owner CLI to add tweets

All of it is tested, against PGlite and real Postgres. **Plan 1b** (`2026-10-21-1b-pages-and-launch.md`) builds the pages and the contributor framework on top, then launches emibonnie.

**Architecture:**
- **Layers:** a pure **domain**, **adapters** (sources, repos), **services**, then **routes** behind a single `api/[...route].js` function.
- **Kinds:** each item kind is a self-contained **kind module** (`src/kinds/<kind>/`) registered through a generated registry. Core code loops over kinds and never names one.
- **Site settings** live in `site/`. The template ships an example in `examples/solluna/`, and the build turns settings into a statically imported module.
- **Dependencies:** `{ db, fetchImpl, now, site }` are built per request and passed explicitly.

**Tech stack:**
- Node 22+ (`.nvmrc` pins 22), `node --test`.
- `@neondatabase/serverless` (Pool), `@electric-sql/pglite` with the `pg_trgm` contrib.
- `esbuild` (build only), ESLint flat config with `eslint-plugin-import`, TypeScript `checkJs` (checker only).
- A `postgres:17` service in CI.
- Vercel Hobby, region `sin1`.

**Spec:** `docs/superpowers/specs/2026-10-21-translation-archive-design.md` (in `emibonnie-archive`). Read it fully, especially:
- Items and item kinds
- Data model principles
- Time zones
- Deleted tweets
- Trust, safety and privacy
- Technical setup
- Reusable template

The mockups are in `docs/superpowers/specs/mockups/`. The spec's text wins over any mockup.

**Repos:**
- `fan-archive/`: a new sibling folder. All tasks in this plan work here. Its origin is `git@github.com:mintbluecar/fan-archive.git`.
- `emibonnie-archive/`: holds the spec, the mockups, and the real example tweets (`test/fixtures/tweets/`). Treat it as **read-only** during this plan.

## Global Constraints

- **Identity:**
  - Commit as `car <bluerotcar@gmail.com>`. Before the first commit, check `git config user.email`. If it isn't that address, stop.
  - **Never push** unless the owner says so at that moment.
  - No real names, no personal account names, and no `/Users/...` paths in any committed file.
- **The engine stays fandom-neutral:**
  - Outside `site/` and `examples/`, nothing may contain a fandom's names, handles, emoji defaults, colours, or hashtags. The purity test enforces this.
  - The template never contains real translations. Tests use **synthetic fixtures**. Executors may *read* the real ones in `../emibonnie-archive/test/fixtures/tweets/` for their structure, but must never copy their text.
- **Secrets** live only in env vars and in GitHub or Vercel secrets. Never log request headers.
- **Translator text is stored verbatim.** Credit goes only to an author ID returned by a source.
- **Settings drive behaviour:**
  - `lowercaseNames`
  - standard emoji for known people
  - generic roles (`host`, `fan`, `speaker`, `crowd`) keep the translator's own emoji
  - "remove", not "hide", in any copy a translator sees
  - entries have no titles
  - "clip by @…" is always shown
- **Visibility.** Content that is removed, pending, rejected, from an opted-out account, or from a blocked submitter never appears in **any** public response: items, counts, neighbours, filters, video, or meta tags. An event whose visible items are all gone is hidden too.
- **Time zones:**
  - Moments are stored as `timestamptz`.
  - Calendar dates are `date` values in `site.timezone` (an IANA name).
  - Every "which day" computation uses the site time zone, through `src/domain/dates.js` in code and `(ts at time zone $tz)::date` in SQL. Never use a bare `::date`.
  - Dates come back from the database as `'YYYY-MM-DD'` strings, never as JS `Date` objects.
- **Tweet sources:**
  - Syndication: `https://cdn.syndication.twimg.com/tweet-result?id={id}&lang=en&token={token}`, where the token is `((Number(id)/1e15)*Math.PI).toString(36).replace(/(0+|\.)/g,'')`.
  - FxTwitter: `https://api.fxtwitter.com/2/status/{id}`.
  - IDs must match `^\d{1,20}$`. Use `redirect: 'error'` and a 3 s timeout.
  - Never fetch a URL a user supplied.
- **Live-event window:** the same person, the same platform, and dates within **±1 day**.
- **Caching:**
  - Every public GET sends `Cache-Control: public, s-maxage=300, stale-while-revalidate=86400, stale-if-error=86400`, with no `Set-Cookie` and no `Vary: Cookie`.
  - Video uses `s-maxage=600`.
  - Writes send `no-store`.

## Architecture and code rules

A reviewer rejects any task that breaks these rules.

```
api/[...route].js        the ONLY Vercel function: builds deps per request, dispatches via src/routes/index.js
src/routes/              one module per endpoint: export const route = { method, path, cache, run({ query, body, params, user }, deps) }
src/http/                router, handler wrapper (errors, cache headers, Origin check for writes), query parsing, contracts.js (response typedefs)
src/services/            orchestration across repos/sources/kinds (ingest, search, hub views, seedFromSite). Never names a kind.
src/kinds/<kind>/        one folder per item kind: index.js (defineKind), domain.js (pure), repo.js, presenter.js, search.js
src/kinds/_registry.js   GENERATED by the build from the folder list (static imports)
src/repo/                SQL for core tables, one module per table group
src/sources/             network access to external sources (registry in index.js); offlineFetch.js for seeds/tests
src/db/                  client (per-request pool, date parser, transactions with actor), migrations runner, migrations/
src/site/                settings schema/validation, copy, generated.js (GENERATED: static import of site config)
src/domain/              PURE: no I/O, no clock, no imports from other layers
public/js/…              Plan 1b
site/                    a site's own folder (gitignored in the template); examples/solluna/ is the template example
```

**Rules:**
1. **One source of truth for each fact:**
   - Visibility: `visibleItem()` in `src/repo/visibility.js`.
   - Engine constants: `src/domain/constants.js`.
   - Fandom values: `site/site.json`.
   - Response shapes: `src/http/contracts.js`.
   - Wording: `src/site/copyDefaults.json`, with keys namespaced (`translation.showN`). Each kind's own copy lives in `src/kinds/<k>/copy.json`, merged at build.
   - A test checks that constants match the SQL check constraints and lookup rows: `KINDS` ↔ `item_kinds`, `ROLES` ↔ the `speaker_role` domain, `PLACEMENTS`, `REVIEW_STATES`.
2. **No god modules.**
   - ESLint: `max-lines` 200 (blank lines and comments skipped), `max-lines-per-function` 50, `complexity` 10, `max-params` 4. Tests are exempt.
   - Typedefs live next to the code that produces them, not in one types file.
3. **Enforced layers.**
   - `no-restricted-imports` per layer:
     - `domain` imports nothing.
     - `repo` may not import services, sources, http, routes or kinds.
     - `services` may not import http or routes.
     - `routes` may not import repo or db directly.
     - `kinds/*/domain.js` follows the domain rules.
   - `import/no-cycle` is an error.
4. **Dependency injection.**
   - `deps = { db, fetchImpl, now, site }`, built per request by `withDeps()` and closed in `finally`.
   - No module-level mutable state, except memoised pure lookups keyed by the `db` instance.
5. **Kinds are plugins.** Adding a kind means:
   - a new `src/kinds/<k>/` folder
   - a migration (its table, plus a row in `item_kinds`)
   - a `public/js/kinds/<k>/` folder (Plan 1b)

   Nothing else changes. `setup` and a test check that the registry matches the `item_kinds` rows.
6. **Schema changes are new migrations.**
   - Engine migrations live in `src/db/migrations/NNN_*.sql`. A site's own migrations live in `site/migrations/`, tracked separately.
   - Migrations are checksummed: editing an applied one fails.
   - Use expand/contract: never drop or rename in the same release that adds the replacement.
7. **Parameterised SQL only.** The actor is set with `set_config('app.actor', $1, true)`.
8. **Type-checked JS.** Every file starts with `// @ts-check`. `npm run check` runs tsc, eslint, and the cycle check.
9. **Database conventions:** ADR 0006 (Task 7).
10. **Naming:**
    - Files are `camelCase.js`. Functions are verbs. Pure transforms are named after what they return.
    - SQL is `snake_case`. Repos map rows to camelCase.

## Review Focus

1. **The audit log under a text primary key.** A `users` insert after migration must succeed and log `row_key 'x'`. Tested in Task 7.
2. **Thai trigram extraction.** `show_trgm('ครบถ้วน')` must return trigrams on both PGlite and Postgres 17, and Thai search must use the index (checked with `EXPLAIN`). Tested in Tasks 2 and 11.
3. **Dates near midnight in the site time zone.** A post at 00:30 Bangkok time lands on the Bangkok date. DB dates come back as strings. Tested in Tasks 5 and 7.
4. **Opt-out reaches every endpoint.** One test calls every registered route for an opted-out fixture account and asserts that its handle, text, and IDs never appear. Tested in Task 12.
5. **A broken `site.json`** fails `setup` and `doctor` with field-named errors and never crashes at runtime. Tested in Task 3.

---

## File structure (fan-archive, after Plan 1a)

```
package.json  package-lock.json  .nvmrc  .editorconfig  LICENSE (MIT)  README.md  CHANGELOG.md  SECURITY.md
eslint.config.js  jsconfig.json  vercel.json (GENERATED)  robots.txt
CONTRIBUTING.md  docs/architecture.md  docs/decisions/0000…0009  docs/spikes.md
.github/pull_request_template.md  .github/ISSUE_TEMPLATE/{bug,kind-proposal}.md  .github/workflows/ci.yml  .github/dependabot.yml
examples/solluna/{site.json,theme.css,copy.json,logo.svg,seed/}
scripts/{dev,build,setup,doctor,initSite,add,seedDev}.js
api/[...route].js
src/http/{router,handler,errors,query,origin,contracts}.js
src/routes/{index,home,event,item,search,filters,person,account,video,meta}.js
src/services/{ingest,search,hubs,seedFromSite}.js
src/kinds/translation/{index,domain,repo,presenter,search,copy.json}.js  src/kinds/_registry.js (GENERATED)  src/kinds/defineKind.js
src/repo/{visibility,rows,people,accounts,events,tags,lookups,settings,items,itemPeople,itemSources,itemLinks,speakerMemory}.js
src/sources/{index,url,normalize,fetchTweet,syndication,fx,offlineFetch}.js
src/db/{client,migrate}.js  src/db/migrations/001_initial.sql
src/site/{schema,loadSite,copy,copyDefaults.json,generated.js (GENERATED)}
src/domain/{constants,dates,lines,header,speakers,events,text}.js
test/…  (mirrors src)  test/fixtures/{tweets (synthetic), site-alt, site-badcopy}
```

---

### Task 1: Engine repo and guardrails

**Files:**
- Create: `package.json`, `.nvmrc` (`22`), `.editorconfig`, `.gitignore`, `LICENSE` (MIT, "Copyright (c) 2026 fan-archive contributors"), `README.md`, `CHANGELOG.md` (`## Unreleased`), `SECURITY.md`, `eslint.config.js`, `jsconfig.json`, `robots.txt`
- Create: `CONTRIBUTING.md` (skeleton), `docs/architecture.md`, `docs/decisions/0000-template.md`…`0005`, `.github/pull_request_template.md`, `.github/ISSUE_TEMPLATE/{bug,kind-proposal}.md`, `.github/dependabot.yml`
- Create: `scripts/dev.js`, `src/http/router.js`, `test/http/router.test.js`, `test/dev.test.js`

**Interfaces:**
- Produces:
  - `npm test` → `node --test`.
  - `npm run check` → `tsc --noEmit -p jsconfig.json && eslint .`.
  - `npm run dev` → `node scripts/build.js && node scripts/dev.js` (the build script arrives in Task 3; until then dev just serves).
  - `matchRoute(routes, method, pathname) → { route, params } | null`. Path patterns use `:param`. It is shared by the Vercel function and the dev server.
  - `createServer({ root, routes, rewrites, handle }) → http.Server`. It serves static files from `root`, applies page rewrites, and sends `/api/*` to `handle(request: Request) → Response`.

- [ ] **Step 1: Create the repo.**
  - From the parent folder: `mkdir fan-archive && cd fan-archive && git init -b main && git remote add origin git@github.com:mintbluecar/fan-archive.git`.
  - Run `git config user.email`. **Expected:** `bluerotcar@gmail.com`. If you get anything else, stop and ask the owner.
- [ ] **Step 2: Base files.**
  - `.gitignore`: `node_modules/`, `.env*`, `.vercel/`, `.devdb/`, `public/site/`, `public/build/`, `site/`, `src/site/generated.js`, `src/kinds/_registry.js`, `.superpowers/`.
    - The template ignores `site/`. A site's repo removes that line (documented in Plan 1b).
  - `package.json`:
    - `"type":"module"`, `"private":true`, `"engines":{"node":">=22"}`, `"version":"0.1.0"`, `"license":"MIT"`.
    - Scripts: `test`, `check`, `dev`, `build`, `setup`, `doctor`, `migrate`, `add`, `init-site`, `seed-dev`.
    - Dependency: `@neondatabase/serverless`.
    - Dev dependencies: `@electric-sql/pglite`, `esbuild`, `eslint`, `@eslint/js`, `globals`, `eslint-plugin-import`, `typescript`.
    - Run `npm install` to create the lockfile.
  - `SECURITY.md`: report privately through GitHub Security Advisories on the repo, so no personal contact address appears.
  - `robots.txt`: `User-agent: *`, `Disallow: /api/`, `Disallow: /search`.
- [ ] **Step 3: Guardrails.**
  - `eslint.config.js`: the rule set from "Architecture and code rules", with layer restrictions written as `no-restricted-imports` patterns per file glob, plus `import/no-cycle: error`.
  - `jsconfig.json`: `checkJs`, `strict`, `module: nodenext`, `target: es2022`, `noEmit`; includes `src`, `api`, `scripts`, `public/js`.
  - `.github/dependabot.yml`: npm and github-actions, weekly.
- [ ] **Step 4: Contributor docs (skeleton).**
  - `docs/architecture.md`: copy this plan's "Architecture and code rules" and the file tree.
  - `CONTRIBUTING.md`, with these sections: Setup; Workflow (branch, small commits, `npm run check && npm test`, PR); Recipes (headings only; filled in Plan 1b); Testing conventions; Engine vs site; Releases (semver tags, CHANGELOG "Upgrade steps").
    - Keep owner-specific identity rules out of it.
  - ADRs (Context / Decision / Consequences, 5–15 lines each, reasons taken from the spec):
    - `0001-plain-js-no-framework`
    - `0002-layered-architecture-and-di`
    - `0003-two-tweet-sources`
    - `0004-migrations-checksummed-expand-contract`
    - `0005-template-repo-examples-and-site-folder`
  - PR template checklist:
    - [ ] Recipe followed or added.
    - [ ] Layers respected.
    - [ ] No duplicated rule.
    - [ ] No fandom values outside `site/` or `examples/`.
    - [ ] Tests added, and check and test pass.
    - [ ] Migration is new, with expand/contract.
    - [ ] New settings have defaults plus a CHANGELOG note.
    - [ ] Accessibility checked (labels, contrast, `lang`).
    - [ ] Privacy checked (visibility rules, no new personal data without a note).
    - [ ] No secrets, names, or local paths.
  - Issue templates: `bug` and `kind-proposal`.
- [ ] **Step 5: Write the failing tests.**

```js
test('matchRoute extracts params and method', () => {
  const routes = [{ method: 'GET', path: '/api/event/:slug' }, { method: 'POST', path: '/api/report' }];
  assert.deepEqual(matchRoute(routes, 'GET', '/api/event/abc-2026-01-01').params, { slug: 'abc-2026-01-01' });
  assert.equal(matchRoute(routes, 'GET', '/api/report'), null);
});
test('dev server: rewrites, api dispatch, 404', async () => {
  const handle = async (req) => Response.json({ path: new URL(req.url).pathname });
  const srv = createServer({ root: 'test/fixtures/static', rewrites: [{ source: '/e/:slug', destination: '/event.html' }], handle });
  const base = await listen(srv);
  assert.match(await (await fetch(base + '/e/x')).text(), /EVENT PAGE/);
  assert.deepEqual(await (await fetch(base + '/api/ping')).json(), { path: '/api/ping' });
  assert.equal((await fetch(base + '/nope.html')).status, 404);
  srv.close();
});
```

- [ ] **Step 6: Run `npm test`. Expected: FAIL.** Implement `router.js` and `scripts/dev.js` using `node:http`, converting between Node requests and Web `Request`/`Response`. **Run `npm test && npm run check`. Expected: PASS.**
- [ ] **Step 7: Commit:** `git add -A && git commit -m "Engine repo, guardrails, contributor skeleton, router and dev server"`

---

### Task 2: Spikes (needs the owner): video, deploy, Thai trigrams, PGlite parity

Purpose: prove the riskiest assumptions **before** building on them. Record the results in `docs/spikes.md`: date, outcome, numbers. Never include tweet text.

**Owner steps.** Pause here and ask the owner to do these using their **fan accounts**, following the spec's identity checklist (fan email signup, no "Continue with GitHub", no card). Confirm each one before continuing.
1. **Neon:** create a project at neon.com, region **AWS Singapore**, autoscaling max **0.25 CU**. Copy the connection string.
2. **Vercel (owner decision, 2026-10-21: manual CLI deploys from the owner's machine, with no Actions deploy and no token):** use the already-logged-in fan Vercel CLI. The executor runs `vercel link --yes --project fan-archive-spike` in `fan-archive/`, which creates the project.
3. **GitHub:** the private repo `mintbluecar/fan-archive` already exists (created 2026-10-21). Ask before pushing anything.

- [ ] **Step 1: Video.** `scripts/spikes/video.mjs <syn.json path>`:
  - Pick the smallest mp4 from `../emibonnie-archive/test/fixtures/tweets/2030321729902641632.syn.json`.
  - Request it with `Referer: https://example.com/` and `Range: bytes=0-1023`, then print the status and content-type.
  - Write `public/spike-video.html` with `<video controls playsinline referrerpolicy="no-referrer">`.
  - Open it via `npm run dev`. **Expected:** 200 or 206, and the video plays.
  - Delete the html file afterwards.
  - **If it doesn't play, stop and tell the owner.** The X-embed fallback changes Plan 1b, Task 5.
- [ ] **Step 2: Thai trigrams and PGlite parity.** `scripts/spikes/db.mjs` runs the same probes on PGlite and on Neon (`DATABASE_URL`):
  - `select show_trgm('ครบถ้วน')` must return a non-empty array.
  - A table with a GIN `gin_trgm_ops` index plus 5,000 rows, where `explain select … where body ilike '%ครบ%'` shows a **Bitmap Index Scan**.
  - `select pg_typeof(1::bigint)` round-trip: record whether the driver returns int8 as a string or a number.
  - `select '2026-02-12'::date` comes back as a string when the date parser is registered (Task 7 registers it; here, just record what the raw value is).
  - `select set_config('app.actor','x',true)` inside a transaction, and confirm `current_setting('app.actor', true)` returns `''` afterwards on the same session.
  - **If Thai produces no trigrams**, record it, and switch search to a `pg_trgm`-independent fallback: an indexed lowercase `body` with `ilike` and a sequential scan. Mark it as a known limit in `docs/spikes.md` and tell the owner.
- [ ] **Step 3: Deploy hello-world (manual CLI).**
  - In a temp folder, create a `public/index.html` saying "spike" and a `vercel.json` with `"regions":["sin1"]`. Run `vercel deploy` (preview, not `--prod`). This is a deploy to the owner's Vercel account, so **ask the owner first**.
  - Confirm the URL serves "spike" and that the `x-vercel-id` response header contains `sin1`. Record the result, then remove the spike deployment with `vercel remove fan-archive-spike --yes` (after asking).
  - No GitHub push is needed for this check.
- [ ] **Step 4: Commit:** `git add -A && git commit -m "Spikes: video playback, Thai trigrams, PGlite parity, deploy path"`

---

### Task 3: Site settings, copy, example site, build, init-site, doctor

**Files:**
- Create: `examples/solluna/{site.json,theme.css,copy.json,logo.svg,seed/README.md}`
- Create: `src/site/{schema,loadSite,copy}.js`, `src/site/copyDefaults.json`, `src/styles/tokens.css` (engine default tokens)
- Create: `scripts/{build,initSite,doctor}.js`, `test/site/*.test.js`, `test/fixtures/site-alt/`, `test/fixtures/site-badcopy/`, `test/purity.test.js`, `docs/site-settings.md`

**Interfaces:**
- Produces:

```js
/** @typedef {{ igHandle: string, displayName: string, emoji: string, colour: string, otherAccounts?: { platform: string, handle: string }[] }} FeaturedPerson */
/** @typedef {{ code: string, platformCode: string, pattern: string }} LivePattern */
/** @typedef {{ name: string, wordmark: { accent: string, rest: string }, tagline: string, ownerXUserId: string,
 *   sourceLanguage: string, timezone: string, region: string, lowercaseNames: boolean, featuredPeople: FeaturedPerson[],
 *   defaultMarkers: Record<string, { personHandle: string } | { role: string }>, ignoredHashtags: string[],
 *   categories: string[], extraLivePatterns: LivePattern[], contactUrl: string }} Site */
```

  - `validateSite(raw) → { ok: true, site } | { ok: false, errors: string[] }`. Every error names the field path. Rules:
    - `timezone` must be a real IANA zone, checked with `Intl.DateTimeFormat` inside try/catch.
    - Colours must be `#rrggbb`, and each featured colour must reach a **contrast ratio ≥ 3:1** against the default card colour (`#fffdf8`) and against the dark card colour.
    - `defaultMarkers` handles must belong to featured people, and roles must be in `ROLES`.
    - `region` must be a Vercel region code (default `sin1`).
    - `contactUrl` is required. It's the one public contact (a form or profile link, never a personal email).
    - Defaults: `lowercaseNames:false`, `extraLivePatterns:[]`, `categories:['show / interview','fan meet / fan day','live']`.
  - `loadSite(dir = process.env.SITE_DIR ?? 'site') → Site` throws `SiteConfigError` with every error. `loadCopy(dir) → Record<string,string>` merges engine defaults, then every kind's `copy.json`, then the site's `copy.json`. An unknown key is an error.
  - `formatName(site, name)`.
  - **`scripts/build.js`:**
    - Writes `src/site/generated.js`: `export const site = {…}; export const copy = {…}`. It's statically importable, so Vercel bundles it. There are no runtime `fs` reads in functions.
    - Writes `src/kinds/_registry.js` from the `src/kinds/*/` folders (static imports, sorted).
    - Writes `public/site/site.js` with the public subset (no `ownerXUserId`).
    - Copies `src/styles/tokens.css` and the site's `theme.css` (which only overrides tokens) into `public/site/`.
    - Copies the logo.
    - Writes `vercel.json` from the route table plus page rewrites (Plan 1b), with `"regions": [site.region]`, the security headers from the spec, and `"buildCommand": "npm run build"`.
    - **Fails** if any of these doesn't hold: `site.json` is valid; every token used in engine CSS exists in `tokens.css`; every `t('key')` used in code exists in the merged copy.
  - **`scripts/initSite.js`** copies `examples/solluna/` to `site/` if `site/` doesn't exist. Otherwise it refuses.
  - **`scripts/doctor.js`** reports, one line per check with ✓/✗ and a fix hint:
    - Node version vs `.nvmrc`
    - `site/` exists
    - settings are valid
    - pending migrations
    - missing env vars (`DATABASE_URL`, and in Plan 2 the auth secrets)
    - local engine version vs the latest `upstream` tag, if reachable

    It exits 1 on any ✗.
- **The example site, "solluna archive":**
  - Featured people:
    - `{igHandle:'solsunny', displayName:'sol', emoji:'☀️', colour:'#c47a12'}`
    - `{igHandle:'lunamoon', displayName:'luna', emoji:'🌙', colour:'#6a5cd6'}`
  - `defaultMarkers`: `{'☀️':solsunny, '🌙':lunamoon, '🗣️':role crowd, '💬':role fan}`.
  - `ignoredHashtags ['solluna']`, `timezone 'Asia/Bangkok'`, `region 'sin1'`, `lowercaseNames true`, `sourceLanguage 'th'`, `ownerXUserId '0'`.
  - `contactUrl 'https://github.com/mintbluecar/fan-archive/issues'`.
- `copyDefaults.json` holds every engine string. Keys are namespaced (`nav.home`, `badge.fanMade`, `item.sourceGone`, `account.optedOut`, `footer.unofficial`, …).
- [ ] **Step 1: Write the failing tests:**
  - The example site validates.
  - Errors name the field: bad colour, low contrast, unknown marker handle, missing `featuredPeople`, `timezone 'Mars/Olympus'`, missing `contactUrl`.
  - Copy overrides apply. `site-badcopy` throws `unknown copy key`.
  - `formatName`.
  - `initSite` copies once and refuses a second time.
  - **The build fails** when the engine CSS uses `var(--missing)`, and when code uses `t('nope.key')`.
  - `doctor` on a temp dir with no `site/` prints `✗ site/ missing — run npm run init-site` and exits 1.
  - **`purity.test.js`:**
    - Collect banned strings from `examples/solluna/site.json` and `test/fixtures/site-alt/site.json` (handles, display names, wordmark accent, ignored hashtags).
    - Fail if any of them appears under `src/` (except `src/site/generated.js`), `api/`, `scripts/`, `public/js/` or `src/styles/`.
    - Don't hardcode any real fandom names in the test.
- [ ] **Step 2: Run the tests. Expected: FAIL.** Then implement, with the field validators split into small functions. **Run `npm run init-site && npm run build && npm test && npm run check`. Expected: PASS.**
- [ ] **Step 3: Write `docs/site-settings.md`.** Document every field, generated from the schema's descriptions where practical.
- [ ] **Step 4: Commit:** `git add -A && git commit -m "Site settings, copy, example site, build, init-site, doctor"`

---

### Task 4: Sources and synthetic fixtures

**Files:**
- Create: `src/sources/{index,url,normalize,fetchTweet,syndication,fx,offlineFetch}.js`, `test/fixtures/tweets/build.mjs` plus the JSON it generates, `test/helpers/fixtures.js`, `test/sources/*.test.js`

**Synthetic fixtures.** `build.mjs` writes `<id>.syn.json` and `<id>.fx.json` in the **same structure** as the real responses: copy the keys and nesting from `../emibonnie-archive/test/fixtures/tweets/`, but write all text, handles and IDs fresh. Both the script and its output get committed.

| Const | ID | Author (id) | Must contain |
|---|---|---|---|
| `LONG` | `1900000000000000001` | `tl_alpha` (`9001`) | keyword line `SOLLUNA AT STARFEST`, `#SolLunaStarfest`, markers `🦁 🌧️ 🐶 🐱 🗣️` (first appearance in that order), a line `🐱: We hug all the time.`, a Thai line containing `ครบ`, footnotes `* …` and `** …`, and ≥ 2,400 chars total. Syndication has `note_tweet` and **truncated** text; fx has the full text. It quotes `1900000000000000000`. Its video has 4 mp4 variants at 632000/950000/2176000/10368000 bps. |
| `EVENT_A` | `…002` | `tl_beta` (`9002`) | `SOLLUNA HAPPY DAY`, `#SLHappyDay2026`, markers `☀️ 🌙`; video `expanded_url` `https://x.com/clipper_one/status/1800000000000000001/video/1` |
| `EVENT_B` | `…003` | `tl_gamma` (`9003`) | the same keyword and hashtag, plus the ignored tag `#SolLuna`; the line `: Luna, I have something to tell you`; `🌙` lines; a line containing `<b>&amp;</b>` (for escaping tests) |
| `LIVE` | `…004` | `tl_alpha` | first line `#lunamoon TikTok live [260212]`; markers `💬 🐱` |
| `JOINT_LIVE` | `…007` | `tl_beta` | first line `#solsunny #lunamoon IG live [260301]`; markers `☀️ 🌙` |
| `SHARED` | `…005` | `tl_alpha` | first line `#SolLuna #starguest`; markers `💬 🪇` |
| `TOMB` | `…006` | – | `{"__typename":"TweetTombstone",…}`; no fx file |
| `POST` | `…008` | `tl_beta` | **quotes** tweet `…010` by `solsunny_x` (author id `8001`; sol's X account) whose text is a Thai sentence **and which carries one photo** on `pbs.twimg.com`; the translation text has no speaker markers. The syndication `quoted_tweet` includes the text. |
| `THREAD` | `…011` | `tl_beta` | markers `🌙`; fx `/2/thread/…011` lists `…011` and a same-author follow-up `…012` (`replying_to …011`, text "The list in the pic: …"), plus a reply `…013` by a **different** author (must be excluded) |
| `PHOTO` | `…009` | `tl_alpha` | two photos (`type: 'photo'`, `media_url_https` on `pbs.twimg.com`, with width/height); first line `#solsunny`; markers `☀️` |

**Interfaces:**
- Produces:
  - `Tweet` typedef (in `normalize.js`): `{ id, status, authorId, authorHandle, authorName, createdAt, text, textSource, video: {variants, durationMs, width, height}|null, images: {url, width, height}[], quoted: {id, authorId, authorHandle, authorName, text, createdAt, images, video}|null, followUps: {id, text, createdAt}[], clipSource: {handle,url}|null, quotedId, replyToId }`.
  - `parseTweetId(input) → string|null`. It accepts x.com, twitter.com and mobile URLs, `?s=` query strings, `/video/1` suffixes, and bare IDs. It returns the ID only if it matches `^\d{1,20}$`.
  - `extractTweetIds(text) → string[]` returns unique IDs, in order.
  - `SOURCES = [{ name, fetch(deps, id) → object|null }]` lists syndication and fx. Each source uses `redirect:'error'` and `AbortSignal.timeout(3000)`, and returns `null` on any failure.
  - `normalize(id, results) → Tweet` is pure. Text comes from fx when syndication has `note_tweet` or is null. It strips only the trailing media `t.co` URL. It keeps only mp4 variants **whose host is `video.twimg.com`**, sorted ascending. It keeps `clipSource` only if its URL is `https://x.com/…` or `https://twitter.com/…`.
  - `fetchTweet(deps, id)` checks the ID, then queries every source in parallel and calls `normalize`.
  - `offlineFetch(dir) → fetchImpl` serves the fixture files by ID. It is used by `seedDev` and tests, not by test helpers in production code.
- [ ] **Step 1: Run `build.mjs`, then write the failing tests:**
  - **URL parsing:** the URL forms above. A profile URL gives null. `'123abc'` gives null.
  - **ID extraction:** ID order is preserved and duplicates removed.
  - **`LONG`:**
    - The text comes from fx, is ≥ 2,400 characters, and contains the 🐱 line.
    - `quotedId` is set.
    - A variant on a non-twimg host is dropped.
  - **`EVENT_A` clip source:** `clipSource` is `clipper_one`.
  - **Images and quotes:** `PHOTO` gives 2 images, both on `pbs.twimg.com`; a non-pbs host is dropped. `POST` gives `quoted.authorHandle === 'solsunny_x'`, `quoted.text` with the Thai sentence, and `quoted.images.length === 1`.
  - **Threads:** `fetchThread(deps, id) → { id, text, createdAt }[]` reads fx `/2/thread/{id}` and returns only follow-ups by the **same author** that reply within the chain, in order. For `THREAD` it returns `[…012]`; it excludes `…013` (another author) and returns `[]` on failure. `fetchTweet` includes them as `followUps`.
  - **Video shape:** `video.width`/`height` come from `mediaDetails[0].original_info`. Make the `LIVE` fixture's video **vertical** (720×1280), and assert that it reads back as such.
  - **`LIVE` source:** the text comes from syndication.
  - **Missing tweets:** `TOMB` is `deleted`, and nothing at all from either source is `unavailable`.
  - **Failures and fetch safety:**
    - If fx fails, `fetchTweet` is still `live`.
    - A source that redirects is treated as `null`.
    - `fetchTweet('../etc')` throws `BadRequest` before any fetch.
- [ ] **Step 2: Run the tests. Expected: FAIL.** Then implement. **Run `npm test && npm run check`. Expected: PASS.**
- [ ] **Step 3: Commit:** `"Sources registry, normalisation with host allowlist, synthetic fixtures"`

---

### Task 5: Domain: constants, dates, text, lines, header

**Files:**
- Create: `src/domain/{constants,dates,text,lines,header}.js`, `test/domain/*.test.js`

**Interfaces:**
- Produces:
  - **`constants.js`** (engine-only values):
    - `ROLES = ['host','fan','speaker','crowd']`
    - `PLACEMENTS = ['event','shared_story','post','unsorted']`
    - `REVIEW_STATES = ['pending','published','rejected']`
    - `LIVE_WINDOW_DAYS = 1`
    - `LIVE_PATTERNS = [{code:'tiktok live', platformCode:'tiktok', pattern:/tiktok\s*live/i}, {code:'ig live', platformCode:'instagram', pattern:/\b(ig|instagram)\s*live/i}, {code:'youtube live', platformCode:'youtube', pattern:/youtube\s*live/i}, {code:'x space', platformCode:'x', pattern:/\b(x|twitter)\s*space/i}]`. A site's `extraLivePatterns` are compiled and appended by the caller.
    - JSDoc unions are derived from these lists (`/** @typedef {typeof ROLES[number]} Role */`).
  - **`dates.js`:** `localDate(instantIso, tz) → 'YYYY-MM-DD'`, `localYear(instantIso, tz)`, `daysBetween(a, b)`. Uses `Intl.DateTimeFormat`, no libraries.
  - **`text.js`:**
    - `norm(s) → string`: NFC, then `toLowerCase()`, then trim and collapse whitespace. It's the **only** way to compute `tags.norm`, so JS and SQL never disagree.
    - `cleanDisplayName(s) → string`: NFKC, removes bidi and zero-width characters, removes a leading `@`, trims to 40 characters.
  - **`lines.js`:**
    - `isSpeechLine`, `splitLines(text) → Line[]`, `findMarkers(lines) → Marker[]`.
    - `Line = {kind:'speech',marker,text}|{kind:'plain',text}|{kind:'footnote',mark,text}`.
    - Markers are whole emoji grapheme clusters (`Intl.Segmenter` and `\p{Extended_Pictographic}`), or a 1–3 character label, found within 12 characters before `:`.
    - A leading `:` makes a line plain. A leading `*`/`**` plus a space makes it a footnote. Blank lines are skipped.
  - **`header.js`:**
    - `parseHeader(text, { ignoredHashtags, personHandles, livePatterns, postedAt?, timezone }) → Header`.
    - `Header = { keyword, hashtags, personTags, unknownHandleTags, live: {code, platformCode, date}|null, context }`.
    - **Header lines** are the lines before the first speech line.
    - **keyword:** the first header line with ≥ 2 words and ≥ 70% uppercase letters.
    - **personTags:** every match among person handles. There can be several, for joint lives.
    - **Live date:** from `[YYMMDD]`, or from `d/m` using `localYear(postedAt, timezone)`.
- [ ] **Step 1: Write the failing tests:**
  - **Lines:**
    - `LONG` markers are exactly `{🦁 🌧️ 🐶 🐱 🗣️}`.
    - It has 2 footnotes.
    - The `EVENT_B` empty-marker line is plain.
    - `'E: hi'` is speech.
    - The line count equals the number of non-blank lines.
  - **Header:**
    - `EVENT_A` keyword and hashtag.
    - `EVENT_B` drops the ignored `#SolLuna`.
    - `LIVE`: `personTags ['lunamoon']`, live `{code:'tiktok live', platformCode:'tiktok', date:'2026-02-12'}`.
    - `JOINT_LIVE`: `personTags ['solsunny','lunamoon']` and `code 'ig live'`.
    - `SHARED`: `unknownHandleTags ['starguest']`.
    - A site extra pattern (`weverse live` → `weverse`) is detected.
    - `'luna tiktok live 12/2'` with `postedAt '2026-02-12T17:30:00Z'` and `tz 'Asia/Bangkok'` gives `date '2026-02-12'` (the header date is used as written).
  - **Dates:**
    - `localDate('2026-02-12T17:30:00Z','Asia/Bangkok') === '2026-02-13'`.
    - `localDate('2026-02-12T16:59:00Z','Asia/Bangkok') === '2026-02-12'`.
    - `daysBetween` across a month boundary.
    - New Year's Eve `localYear`.
  - **Text:**
    - `norm('#ＳＬHappy  Day')` collapses the spaces and lowercases. Document the NFC vs NFKC choice in the test name.
    - `cleanDisplayName('@‮tl_alpha​')` gives `'tl_alpha'`.
- [ ] **Step 2: Run the tests. Expected: FAIL.** Then implement. **Run the tests. Expected: PASS.** Commit: `"Domain: constants, dates, text normalisation, lines, header"`

---

### Task 6: Domain: speakers and events; the translation kind's draft

**Files:**
- Create: `src/domain/{speakers,events}.js`, `src/kinds/defineKind.js`, `src/kinds/translation/{index,domain,copy.json}.js`, `test/domain/{speakers,events}.test.js`, `test/kinds/translation/domain.test.js`

**Interfaces:**
- Produces:
  - **`speakers.js`:**
    - `resolveSpeakers({ defaults, people, remembered = {}, chosen = {} }) → SpeakerMap`. It applies, in order: defaults with handles resolved to ids (unknown handles are skipped), then remembered, then chosen. This is the **only** place these are merged.
    - `missingMarkers(markers, map)`.
    - `personIdsFrom(map, markers)`.
    - `SpeakerMap = Record<string, {person:number}|{role:Role}>`.
  - **`events.js`:**
    - `Event = { id, slug, name, occurredOn, categoryId, clientId, keywords, hashtags, livePeopleIds: number[], livePlatformCode: string|null }`.
    - `matchEvent({ header, postedAt, events, people, formatName, timezone, postAuthorId? }) → EventMatch`.
      - The entry date is the header's live date, else `localDate(postedAt, tz)`.
      - **Rules, in order:**
        1. A keyword (`norm`) or hashtag (`norm`) matches.
        2. A live whose **set** of person tags equals the event's `livePeopleIds` set, on the same platform, with `daysBetween` ≤ 1.
        3. Otherwise, a proposal when there's a keyword, an event hashtag or a live.
        4. If none applies: **`post`** when `postAuthorId` is given (the caller found the quoted or media source's account linked to a known person); else `shared_story` when there are unknown handle tags; else `unsorted`.
      - **Suggestions:** events within ±1 day, excluding the match, at most 5.
    - `proposeEvent(...) → EventProposal`.
      - Name: the keyword, or the people's formatted names joined with `" & "`, then the live code (`"sol & luna ig live"`).
      - Slug: `slugify(name) + '-' + date`, matching `^[a-z0-9-]+$`.
  - **`defineKind(spec) → Kind`** validates the contract and freezes it:

```js
/** @typedef {{ name: string, table: string, urlPrefix: string,
 *   matchesUrl(url: string): string|null,                       // returns source id or null
 *   draft(input: unknown, ctx: object): object,                  // pure (from domain.js)
 *   persist(tx: Db, draft: object, meta: object): Promise<number>,
 *   loadDetails(db: Db, itemIds: number[]): Promise<Map<number, object>>,
 *   present: { preview(item, details, ctx): Preview, detail(item, details, ctx): object },
 *   search: { textClause(paramIndex: number): string, matchLines(details, q): string[] } }} Kind */
```

  - **`kinds/translation/domain.js`:** `draftTranslation(tweet, ctx) → Draft`. It does everything that decides what a translation item *is*:
    - Parse lines and header, resolve speakers, match the event.
    - Apply overrides: `placement`, `eventId`, `newEvent`.
    - **Shared story:** placement `shared_story`, no event and no proposal, a sharing person from the first person tag or unknown tag that resolves, and the about-people.
    - **Post:** `ctx.personAccounts` (`[{platform, handle, personId}]`) is matched against `tweet.quoted.authorHandle`, then `clipSource.handle`. A match gives placement `post`, `people` including `{personId, role:'author'}`, and no event.
    - `ctx.personAccounts` comes from the accounts linked to people (Task 8).
    - `occurredOn` is the live date, else `localDate(postedAt, tz)`.
  - **`kinds/translation/index.js`:** `export default defineKind({ name:'translation', table:'translations', urlPrefix:'/t/', matchesUrl: parseTweetId, draft: draftTranslation, … })`. `persist`, `loadDetails`, `present` and `search` are completed in Tasks 10–11. Stub them now to throw `not implemented`.
- [ ] **Step 1: Write the failing tests:**
  - **speakers:**
    - The layering order.
    - Unknown default handles are skipped.
    - `missingMarkers`.
    - `personIdsFrom` ignores markers that aren't used.
  - **events:**
    - Keyword with mixed case and spacing.
    - An empty header gives `unsorted`.
    - A luna tiktok live within 1 day matches; at 3 days it proposes a new event.
    - A **joint live** matches only an event with both people.
    - A shared story.
    - **Midnight:** a no-date live posted `2026-02-12T17:30:00Z` proposes `2026-02-13` in Bangkok and `2026-02-12` in UTC.
  - **draft:**
    - `LONG` with no memory gives missing `🦁 🌧️ 🐶 🐱` and a proposal.
    - With everything chosen, nothing is missing.
    - `EVENT_B` matches an existing event.
    - `SHARED` gives placement `shared_story`.
    - `POST` with `personAccounts [{platform:'x', handle:'solsunny_x', personId: SOL}]` gives placement `post`, with sol as `author`, and nothing missing (no markers).
    - `PHOTO` gives placement `post` when sol's handle is the media source, else an event or unsorted per the header.
    - `newEvent` forces a proposal.
  - **defineKind:**
    - It rejects a spec that's missing `search.textClause`.
    - It rejects `name` values that aren't `^[a-z][a-z0-9_]*$`.
- [ ] **Step 2: Run the tests. Expected: FAIL.** Then implement. **Run the tests. Expected: PASS.** Commit: `"Domain speakers and events; kind contract; translation draft"`

---

### Task 7: Database core: client, migrations, schema, triggers (ADR 0006)

**Files:**
- Create: `docs/decisions/0006-data-model-conventions.md`, `src/db/{client,migrate}.js`, `src/db/migrations/001_initial.sql`, `test/helpers/db.js`, `test/db/*.test.js`

**Database conventions** (ADR 0006; also rule 9 in `docs/architecture.md`):
1. **Common columns on every entity table:**
   - `id bigint generated always as identity` (lookups use `smallint` or text codes)
   - `created_at`, `updated_at`, `created_by`, `updated_by`, `deleted_at`, `deleted_by`
   - `meta jsonb not null default '{}'`

   `users` keeps a text `id`. Join tables carry only `created_at` and `created_by`.
2. **Soft delete only.** The app never hard-deletes, except for owner erasure scripts (Plan 3) and join-table rewrites.
3. **The audit log is automatic and stores diffs:**
   - A BEFORE trigger sets `updated_at`, plus `created_by`/`updated_by` from `app.actor`. It **raises** if `app.actor` is missing or empty.
   - An AFTER trigger writes `audit_log` with: `row_key` (text) from the column named in `tg_argv[0]` (default `id`); `action`; `actor`; `changes` (inserts: null; updates: only the changed columns' old values, ignoring `updated_at` and `updated_by`, and **skipping the write entirely when nothing changed**; deletes: the full old row).
   - It's attached to entity tables **and** to join and kind tables, keyed by their parent (`item_id`, `event_id`, `person_id`).
   - The app role gets no `UPDATE` or `DELETE` on `audit_log`. The trigger function is `SECURITY DEFINER`.
4. **`meta` is only for extras that are display-only.** Anything filtered, joined, sorted, searched or unique gets a real column.
5. **Values that will grow are lookup rows,** with text codes as primary keys so no join is needed to read them:
   - `platforms`, `item_kinds`, `source_roles`, `added_via`, `deleted_reasons`, `link_relations`, `item_person_roles`.
   - Closed sets stay as checks: `placement`, `review_state`, `status`, `action`.
   - Roles use a `speaker_role` domain.
6. **Relations are join tables.**
7. **Slugs are unique forever, including on deleted rows,** so permalinks are never reused. Other unique keys are partial on `deleted_at is null`, and repos **restore** a soft-deleted row instead of inserting a duplicate.
8. **Timestamps are `timestamptz`; days are `date` in the site time zone.** SQL derives a day only via `(ts at time zone $tz)::date`.
9. **`generated always` ids:** restoring from a dump needs `pg_restore`, which handles identities. A manual JSON import would need `overriding system value` plus `setval`, so document that.

**Interfaces:**
- Produces:
  - `createDb({ url?, dir? }) → Db`:
    - `{ query(sql, params?), transaction(fn, { actor }), end() }`.
    - With `url`, it uses a Neon `Pool`. `transaction` takes `client = await pool.connect()`, runs `begin`, then `select set_config('app.actor', $1, true)`, then `fn(tx)`, then commit or rollback, then `release`.
    - Without it, it uses PGlite (`dir` or in-memory) with `pg_trgm` loaded at construction, and the same transaction semantics.
    - **Date parser:** OID 1082 is returned as the raw `'YYYY-MM-DD'` string in both drivers.
    - **int8:** returned as numbers when ≤ `Number.MAX_SAFE_INTEGER` (verified by the Task 2 spike result). Both drivers produce the same shape.
    - Writes outside `transaction()` fail by design, through the actor trigger.
  - `migrate(db, { dirs: [{ namespace: 'engine', dir: 'src/db/migrations' }, { namespace: 'site', dir: 'site/migrations' }] }) → string[]`:
    - Takes `pg_advisory_xact_lock(hashtext('fan-archive-migrate'))`.
    - Records `(namespace, name, sha256, applied_at)` in `schema_migrations`.
    - **Fails** if an applied file's sha256 changed.
    - Applies new files in order, each in its own transaction with actor `'system'`.

**`001_initial.sql`.** Write it in full. It contains no fandom data, and it is ordered so foreign keys resolve.

```sql
create extension if not exists pg_trgm;
create domain speaker_role as text check (value in ('host','fan','speaker','crowd'));

-- users first (actors)
create table users (id text primary key, display_name text, role text not null default 'member' check (role in ('owner','member','system')),
  blocked_at timestamptz, meta jsonb not null default '{}', created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), created_by text, updated_by text, deleted_at timestamptz, deleted_by text);
insert into users (id, display_name, role, created_by) values ('system','system','system','system');

-- text-coded lookups (extend by inserting rows)
create table platforms (code text primary key);           insert into platforms values ('x'),('instagram'),('tiktok'),('youtube'),('weverse'),('telegram');
create table item_kinds (code text primary key);          insert into item_kinds values ('translation');
create table source_roles (code text primary key);        insert into source_roles values ('primary'),('follow_up'),('media'),('quoted'),('full_video');
create table added_via (code text primary key);           insert into added_via values ('submit'),('notion'),('paste'),('cli'),('telegram');
create table deleted_reasons (code text primary key);     insert into deleted_reasons values ('removed_by_account'),('hidden_by_owner'),('duplicate'),('spam'),('blocked_submitter'),('erased');
create table link_relations (code text primary key);      insert into link_relations values ('follows_on');
create table item_person_roles (code text primary key);   insert into item_person_roles values ('present'),('sharing'),('about'),('author');
create table categories (id smallint generated always as identity primary key, name text not null, deleted_at timestamptz, created_at timestamptz not null default now());
create unique index categories_name on categories (lower(name)) where deleted_at is null;
create table clients (like categories including all);     -- same shape

create table settings (key text primary key, value jsonb not null, updated_at timestamptz not null default now(), updated_by text references users(id));

-- people & accounts
create table people (id bigint generated always as identity primary key, display_name text not null, emoji text not null,
  colour text not null check (colour ~ '^#[0-9a-f]{6}$'), featured boolean not null default false, <common columns>);
create table person_aliases (person_id bigint not null references people(id), alias text not null check (alias = lower(alias)),
  created_at timestamptz not null default now(), created_by text references users(id), primary key (alias));
create table accounts (id bigint generated always as identity primary key, platform text not null references platforms(code),
  external_id text, handle text not null, display_name text, person_id bigint references people(id),
  is_identity boolean not null default false, user_id text references users(id), opted_out_at timestamptz, <common columns>);
create unique index accounts_external on accounts (platform, external_id) where external_id is not null;
create unique index accounts_handle_only on accounts (platform, lower(handle)) where external_id is null and deleted_at is null;
create index accounts_handle on accounts (platform, lower(handle));
create unique index accounts_identity on accounts (person_id) where is_identity and deleted_at is null;
create index accounts_user on accounts (user_id);

-- projects, events
create table projects (id bigint generated always as identity primary key, slug text unique not null check (slug ~ '^[a-z0-9-]+$'),
  name text not null, starts_on date, ends_on date check (ends_on is null or starts_on is null or ends_on >= starts_on),
  category_id smallint references categories(id), <common columns>);
create table events (id bigint generated always as identity primary key, slug text unique not null check (slug ~ '^[a-z0-9-]+$'),
  name text not null, occurred_on date not null, starts_at timestamptz, project_id bigint references projects(id),
  category_id smallint references categories(id), client_id smallint references clients(id),
  live_platform text references platforms(code), needs_review boolean not null default true, <common columns>);
create index events_occurred on events (occurred_on desc) where deleted_at is null;
create table event_people (event_id bigint not null references events(id), person_id bigint not null references people(id),
  role text not null default 'live' check (role in ('live','performer','guest')), created_at timestamptz not null default now(),
  created_by text references users(id), primary key (event_id, person_id, role));
create index event_people_person on event_people (person_id, event_id);

-- tags
create table tags (id bigint generated always as identity primary key, kind text not null check (kind in ('hashtag','keyword')),
  display text not null, norm text not null, ignored boolean not null default false, created_at timestamptz not null default now(),
  unique (kind, norm));
create table event_tags (event_id bigint not null references events(id), tag_id bigint not null references tags(id),
  created_at timestamptz not null default now(), created_by text references users(id), primary key (event_id, tag_id));
create index event_tags_tag on event_tags (tag_id);

-- items (shared by all kinds)
create table items (id bigint generated always as identity primary key, kind text not null references item_kinds(code),
  placement text not null check (placement in ('event','shared_story','post','unsorted')), event_id bigint references events(id),
  category_id smallint references categories(id), client_id smallint references clients(id),
  credited_account_id bigint references accounts(id), occurred_on date not null, posted_at timestamptz,
  added_via text not null references added_via(code),
  review_state text not null default 'published' check (review_state in ('pending','published','rejected')),
  sort_key double precision not null, deleted_reason text references deleted_reasons(code), <common columns>,
  unique (id, kind),
  check ((placement = 'event') = (event_id is not null)),
  check ((deleted_at is null) = (deleted_reason is null)));
create index items_event on items (event_id, sort_key, id) where deleted_at is null;
create index items_account on items (credited_account_id);
create index items_created_by on items (created_by);
create index items_posted on items (posted_at desc) where deleted_at is null;
create table item_people (item_id bigint not null references items(id), person_id bigint not null references people(id),
  role text not null references item_person_roles(code), created_at timestamptz not null default now(), created_by text references users(id),
  primary key (item_id, person_id, role));
create index item_people_person on item_people (person_id, item_id);
create table item_tags (item_id bigint not null references items(id), tag_id bigint not null references tags(id),
  created_at timestamptz not null default now(), created_by text references users(id), primary key (item_id, tag_id));
create index item_tags_tag on item_tags (tag_id);
create table item_sources (id bigint generated always as identity primary key, item_id bigint not null, kind text not null,
  platform text not null references platforms(code), external_id text, url text not null check (url ~ '^https://'),
  role text not null references source_roles(code), position smallint not null default 0, account_id bigint references accounts(id),
  start_seconds int, media jsonb, status text not null default 'live' check (status in ('live','deleted','unavailable')),
  created_at timestamptz not null default now(), created_by text references users(id),
  foreign key (item_id, kind) references items (id, kind));
create unique index item_sources_primary_per_kind on item_sources (kind, platform, external_id) where role = 'primary';
create unique index item_sources_one_primary on item_sources (item_id) where role = 'primary';
create index item_sources_item on item_sources (item_id);
create table source_checks (source_id bigint primary key references item_sources(id), checked_at timestamptz not null,
  consecutive_failures int not null default 0);                       -- NOT audited (health-check churn)
create table item_links (from_item_id bigint not null references items(id), to_item_id bigint not null references items(id),
  relation text not null references link_relations(code), created_at timestamptz not null default now(),
  created_by text references users(id), primary key (from_item_id, to_item_id, relation));

-- translation kind
create table translations (item_id bigint primary key, kind text not null default 'translation' check (kind = 'translation'),
  text_entered_manually boolean not null default false,
  foreign key (item_id, kind) references items (id, kind));
-- each tweet's text is its own part: position 0 = main tweet, 1..n = follow-ups (added at intake, by the manual
-- "check for follow-ups" button, or by attaching a pasted follow-up); parts are never rewritten, only added
create table translation_parts (item_id bigint not null references translations(item_id), position smallint not null,
  source_id bigint references item_sources(id), body text not null, created_at timestamptz not null default now(),
  created_by text references users(id), primary key (item_id, position));
create index translation_parts_body_trgm on translation_parts using gin (body gin_trgm_ops);
create table translation_speakers (item_id bigint not null references translations(item_id), marker text not null,
  person_id bigint references people(id), role speaker_role, check ((person_id is null) <> (role is null)),
  primary key (item_id, marker));
create index translation_speakers_person on translation_speakers (person_id);
create table speaker_memory (account_id bigint not null references accounts(id), marker text not null,
  person_id bigint references people(id), role speaker_role, check ((person_id is null) <> (role is null)),
  updated_at timestamptz not null default now(), primary key (account_id, marker));

-- system
create table reports (id bigint generated always as identity primary key,
  target_table text not null check (target_table in ('events','items','people','accounts')), target_id bigint not null,
  reason text not null check (length(reason) <= 2000), status text not null default 'open' check (status in ('open','resolved','dismissed')),
  <common columns>);
create table import_jobs (id bigint generated always as identity primary key, source text not null check (source in ('notion','paste','telegram')),
  status text not null default 'queued' check (status in ('queued','running','done','failed')), <common columns>);
create table import_rows (id bigint generated always as identity primary key, job_id bigint not null references import_jobs(id),
  platform text not null references platforms(code), external_id text not null, overrides jsonb not null default '{}',
  state text not null default 'queued' check (state in ('queued','fetched','needs_speakers','check','published','skipped','failed')),
  item_id bigint references items(id), error text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (job_id, platform, external_id));
create table audit_log (id bigint generated always as identity primary key, table_name text not null, row_key text not null,
  action text not null check (action in ('insert','update','delete')), actor text not null, at timestamptz not null default now(), changes jsonb);
create index audit_log_row on audit_log (table_name, row_key);
create index audit_log_at on audit_log using brin (at);

-- triggers: set_common() BEFORE INSERT/UPDATE (updated_at; created_by/updated_by from nullif(current_setting('app.actor', true), '') — raise if null)
--           write_audit() AFTER INSERT/UPDATE/DELETE, SECURITY DEFINER, key column from tg_argv[0], diff-only, skip empty diffs, return null
-- attach with a do-block loop over: entity tables (key 'id'): users, people, accounts, projects, events, items, reports, import_jobs, settings(key 'key')
--                                  child tables (parent key): person_aliases('person_id'), event_people('event_id'), event_tags('event_id'),
--                                  item_people('item_id'), item_tags('item_id'), item_sources('item_id'), item_links('from_item_id'),
--                                  translations('item_id'), translation_parts('item_id'), translation_speakers('item_id')
-- NOT audited: tags, lookups, source_checks, import_rows, speaker_memory, audit_log.
```

Expand `<common columns>` to `created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by text references users(id), updated_by text references users(id), deleted_at timestamptz, deleted_by text references users(id), meta jsonb not null default '{}'`.

- [ ] **Step 1: Write ADR 0006** with the 9 conventions and the reasons for each (fewer migrations, space, multi-platform and multi-kind, a free edit log, privacy-aware retention). Add rule 9 to `docs/architecture.md`.
- [ ] **Step 2: Write the failing tests** against `freshDb()` (in-memory PGlite plus migrations):
  - **migrate:**
    - The first run applies `['engine/001_initial.sql']`, and the second applies nothing.
    - Editing an applied file makes the next run throw `checksum mismatch`.
    - A `site` namespace `001_x.sql` applies independently of `engine/001`.
  - **Actor:**
    - An insert outside `transaction()` throws `app.actor not set`.
    - Inside `transaction(fn, {actor:'system'})` it succeeds, and the row's `created_by` is `'system'`.
  - **Audit:**
    - Inserting a user `'x'` logs `row_key 'x'`, `action 'insert'`, and `changes null`. This is the regression test for the text key.
    - Updating a person's colour logs `changes {colour: old}` only.
    - An update that changes nothing logs **nothing**.
    - Inserting an `item_people` row logs `table 'item_people'`, `row_key = item id`.
    - An app-role `delete from audit_log` is denied. In PGlite, create an `app` role and run the test as it.
  - **Dates:**
    - `select occurred_on` returns the string `'2026-02-13'`.
    - `select ('2026-02-12T17:30:00Z'::timestamptz at time zone 'Asia/Bangkok')::date` returns `'2026-02-13'`.
  - **Integrity:**
    - Placement `'event'` with a null `event_id` is rejected.
    - `deleted_reason` set without `deleted_at` is rejected.
    - A second primary source on the same item is rejected.
    - The same primary tweet under two kinds is allowed. Insert an `item_kinds` row `'zz'` in the test.
    - A `translations` row pointing at an item of another kind is rejected.
    - A second identity account for the same person is rejected.
    - A `translation_speakers` row with both `person_id` and `role` is rejected.
  - **Constants vs SQL:**
    - Read the check constraints and the `speaker_role` domain from `pg_constraint`, plus the rows of `item_kinds`.
    - Assert they equal `ROLES`, `PLACEMENTS`, `REVIEW_STATES`, and the registry's kind names.
- [ ] **Step 3: Run the tests. Expected: FAIL.** Then implement. **Run the tests, then run the same suite against Postgres:** `TEST_DATABASE_URL=… npm test`. `test/helpers/db.js` uses a fresh schema on that database when the variable is set. **Expected:** PASS on both.
- [ ] **Step 4: Commit:** `"Data model ADR; checksummed migrations; audited, normalised schema"`

---

### Task 8: Repositories: identity, lookups, tags, settings, events

**Files:**
- Create: `src/repo/{rows,people,accounts,lookups,tags,settings,events}.js`, `src/services/seedFromSite.js`, `scripts/setup.js`, `test/repo/*.test.js`, `test/services/seedFromSite.test.js`

**Interfaces:**
- Produces. Each function takes `db` (or `tx`) first, returns camelCase objects, and is grouped by table:
  - **people:**
    - `listPeople() → Person[]`. `Person = { id, displayName, emoji, colour, featured, igHandle, extraHashtags }`. `igHandle` comes from the identity account; `extraHashtags` from the aliases.
    - `addPerson(tx, { igHandle, displayName, emoji, colour }, { lowercaseNames }) → Person`. It creates the person plus an Instagram identity account. It throws `duplicate person` when the handle already identifies someone.
    - `getPersonByHandle(ig)`.
  - **accounts:**
    - `upsertAccount(tx, { platform, externalId?, handle, displayName? }) → id`.
    - **Merge rule:** with an `externalId`, update by `(platform, externalId)`. If no row has it, **adopt** a handle-only row with the same `(platform, lower(handle))` by setting its `external_id`. Otherwise insert. Without an `externalId`, match a handle-only row, or insert one.
    - `getAccount(id)` and `getAccountByHandle(platform, handle)`. The lookup prefers an external-id row, then the most recently updated.
  - **lookups:**
    - `ensureCategory(tx, name)` and `ensureClient(tx, name)`. Both match case-insensitively and **restore** a soft-deleted row before inserting a new one.
    - `listCategories()`.
  - **tags:**
    - `ensureTags(tx, [{ kind, display }]) → id[]`, where `norm` comes from `domain/text.norm`.
    - `ignoredHashtags() → string[]`.
    - `setIgnoredIfMissing(tx, list)`.
  - **settings:** `get(key)` and `set(tx, key, value)`.
  - **events:**
    - `listEvents()`, with `keywords`, `hashtags`, `livePeopleIds` and `livePlatformCode` joined in.
    - `createEvent(tx, proposal) → Event`. Writes the event, its tags and `event_people` (`live`). It takes `pg_advisory_xact_lock(hashtext(slug))` first, then returns the existing event if the slug already exists (handles a race between two ingests).
    - `getEventBySlug`.
    - `softDeleteEvent(tx, id)` moves the event's items to `unsorted` in the same transaction.
  - **`seedFromSite(deps) → { people, hashtags, categories }`.**
    - **Only fills in what's missing.** Featured people are created if their IG handle is unknown; existing people are left alone (admin edits win). Ignored hashtags and categories are added if missing.
    - Each featured person's `otherAccounts` (e.g. their X handle) are created as handle-only accounts linked to that person, with `is_identity` false.
    - `people.listPersonAccounts() → [{platform, handle, personId}]` feeds the post detection.
    - It stores `settings.timezone` on first run. On later runs it **refuses** to continue if `site.timezone` differs from the stored value, with an error that explains why: changing it would reinterpret every stored date.
    - The actor is `'system'`.
  - **`scripts/setup.js`:** `loadSite`, then `migrate` (both namespaces), then `seedFromSite`, then checks that the registry kinds equal the `item_kinds` rows (fails with a hint if not), then prints a summary.
- [ ] **Step 1: Write the failing tests:**
  - **people:**
    - `addPerson` with `'@Leo_X'`/`'Leo'` and lowercase on stores `leo_x`/`leo`.
    - Adding the same IG twice throws.
    - `listPeople` has `igHandle`.
  - **accounts:**
    - A handle-only clipper `clipper_one`, followed by `{externalId:'7001', handle:'clipper_one'}`, leaves **1 row** that has the external id.
    - A handle change by external id updates the row.
  - **lookups:** `ensureCategory('Live')` after the soft-deleted `'live'` restores it, with the same id.
  - **tags:** `#SLHappyDay2026` and `#slhappyday2026` give one row.
  - **events:**
    - Two concurrent `createEvent` calls with the same slug (`Promise.all` on two transactions) give 1 row.
    - A joint-live event has 2 `event_people` rows.
    - `softDeleteEvent` moves its items to `unsorted`.
  - **seedFromSite:**
    - It seeds the example site.
    - Run again after the owner changes a featured person's colour in the db, it does **not** overwrite the colour.
    - A changed `timezone` makes it throw `timezone changed`.
  - **setup:** with the kind registry containing a name with no `item_kinds` row, it fails with a hint.
- [ ] **Step 2: Run the tests. Expected: FAIL.** Then implement. **Run `npm test` (PGlite and Postgres) and `npm run check`. Expected: PASS.** Then run `PGLITE_DIR=.devdb npm run setup`. **Expected:** `migrated engine/001_initial.sql`, `seeded 2 people`.
- [ ] **Step 3: Commit:** `"Repositories for identity, lookups, tags, settings, events; seed-if-missing setup"`

---

### Task 9: Items core and visibility

**Files:**
- Create: `src/repo/{visibility,items,itemPeople,itemSources,itemLinks,speakerMemory}.js`, `test/repo/{items,visibility}.test.js`

**Interfaces:**
- Produces:
  - `visibleItem(alias='i') → string`. The condition is:

    ```sql
    i.deleted_at is null and i.review_state = 'published'
    and not exists (select 1 from accounts a where a.id = i.credited_account_id and a.opted_out_at is not null)
    and not exists (select 1 from users u where u.id = i.created_by and u.blocked_at is not null)
    ```

    `visibleEvent(alias='e')` is `e.deleted_at is null and exists (select 1 from items i where i.event_id = e.id and <visibleItem>)`.
  - **items:**
    - `sourceState(kind, platform, externalId) → 'none'|'visible'|'removed'|'pending'`.
    - `insertItem(tx, row) → id`. `sort_key` defaults to `extract(epoch from posted_at)` when it isn't given.
    - `neighbours(itemId) → { prev, next }`. Only visible items in the same event, ordered by `(sort_key, occurred_on, posted_at, id)`.
    - `listVisibleItemIds({ eventId?, personId?, accountId?, kind?, placement?, limit, offset }) → { kind, id }[]`.
    - `countsByEvent()`, `countsForPerson(id)`, `countsForAccount(id)`. All visible-only.
  - **itemPeople:** `setItemPeople(tx, itemId, [{ personId, role }])`. Replaces the set: deletes rows that are no longer present and inserts new ones, so each change shows up in the audit log as a delete or an insert.
  - **itemSources:**
    - `addSources(tx, itemId, kind, [{ platform, externalId, url, role, position, accountId, startSeconds, media }])`. `media` holds the stored video variants.
    - `primarySource(itemId)`.
    - `setStatus(tx, sourceId, status)`. Writes only when the status actually changes.
    - `touchCheck(sourceId)`. Writes `source_checks` only (unaudited).
  - **itemLinks:** `link(tx, from, to, relation)`.
  - **speakerMemory:** `recall(accountId) → SpeakerMap` and `remember(tx, accountId, map)`.
- [ ] **Step 1: Write the failing tests** (seed with small helper inserts inside `transaction`):
  - **Visibility:** for each of removed, pending, opted-out account and blocked submitter:
    - the item is absent from `listVisibleItemIds`, the counts, and `neighbours`
    - an event whose only item is hidden is absent from `visibleEvent`
  - **sourceState:** `'none' → 'visible' → 'removed'`.
  - **Neighbours:** ordering is stable when two items share a `sort_key`.
  - **`setItemPeople`:** changing `{1:present, 2:present}` to `{1:present}` logs exactly one `delete`.
  - **`setStatus`:** same-status calls write no audit rows. `touchCheck` writes zero audit rows.
- [ ] **Step 2: Run the tests. Expected: FAIL.** Then implement. **Run the tests. Expected: PASS.** Commit: `"Items core, visibility for every hidden state, unaudited check churn"`

---

### Task 10: Translation kind persistence and the ingest service

**Files:**
- Create: `src/kinds/translation/{repo,presenter}.js`, `src/services/ingest.js`, `scripts/add.js`, `scripts/seedDev.js`, `examples/solluna/seed/{maps.json,tweets/}` (copies of the synthetic fixtures), `test/services/ingest.test.js`
- Modify: `src/kinds/translation/index.js` (fill in `persist` and `loadDetails`)

**Interfaces:**
- Produces:
  - **The translation repo:**
    - `insertTranslation(tx, itemId, { textEnteredManually })`.
    - `addParts(tx, itemId, [{ sourceId, body }]) → positions[]`: appends after the current max position and never rewrites existing parts.
    - `partsOf(itemIds) → Map<id, {position, body}[]>`.
    - `setSpeakers(tx, itemId, map)`. Replaces the set, the same way as `setItemPeople`.
    - `loadDetails(db, itemIds) → Map<id, { parts: string[], body /* parts joined with a blank line */, speakers: SpeakerMap, sources }>`.
  - **`translation.persist(tx, draft, meta)`** writes the kind-specific rows:
    - the translation body
    - the speakers
    - item tags: keyword and hashtags
    - sources: primary, **follow-ups (one `follow_up` source per `tweet.followUps` entry, `position` 1…n)**, plus parts (part 0 is the main tweet text; parts 1…n are the follow-ups, each linked to its source), media (the clipper account upserted by handle, with `media` = the video variants **or** `{images:[…]}`), quoted (`media` = `{text, authorHandle, authorName, createdAt, images, video}`, so the original post survives deletion like the translation)
    - the follows-on link
    - speaker memory
  - **`ingestItem(deps, { kind, input, chosen?, overrides?, addedVia, actor }) → IngestResult`.** This is generic: **no kind is named.** The kind comes from the registry.

```js
/** @typedef {{ status: 'added'|'attached'|'pending'|'duplicate'|'removed'|'opted_out'|'deleted'|'unavailable'|'needs_speakers',
 *   sourceId: string, itemId?: number, eventId?: number|null, missing?: object[], draft?: object }} IngestResult */
```

  **Flow.** Each step is a private function:
  1. `sourceState` returns **duplicate**, **removed** or **pending**. A pasted ID that is already some item's `follow_up` source returns **attached**, with that item.
  1b. If the kind says the input is a follow-up (`kind.followUpOf(input) → {platform, externalId}|null`: for translations, `replyToId` with the same author as the archived item that owns that ID as a primary or follow-up source), append it to that item as a new part and source in one transaction, and return **attached**.
     - Add `followUpOf` to the Kind contract. It's optional; kinds without it skip this step.
  2. The kind fetches the source. A deleted or unavailable source returns **deleted** or **unavailable**.
  3. The credited account is opted out: return **opted_out**.
  4. Load the context (site, people, events, ignored tags, `recall`), then run `kind.draft`.
  5. Speakers are missing: return **needs_speakers**.
  6. Open **one** `deps.db.transaction(…, { actor })`:
     - `upsertAccount` (credited, by external id)
     - `createEvent` if there's a proposal
     - `ensureCategory`/`ensureClient`
     - `insertItem`. `review_state` is `pending` when `textEnteredManually` and the actor isn't the credited account's user. Otherwise it follows the `settings.approvalRequired` setting (default false).
     - `setItemPeople`
     - `kind.persist`
  7. Return **added**, or **pending**.

  - **`scripts/add.js <url|id> [--map …] [--shared-story] [--event <slug>] [--new-event] [--create-person ig:name:emoji:#colour]…`.** It parses arguments, creates people, calls `ingestItem` with actor `'system'`, and prints the result. On `needs_speakers` it lists the missing markers and exits 2. No business logic lives here.
  - **`scripts/seedDev.js [--site-dir site]`.** Runs `setup`, then reads `<site>/seed/maps.json`: `{ createPeople: [...], tweets: { "<id>": { chosen, overrides } } }`, where person references are IG handles. It ingests every `<site>/seed/tweets/*.syn.json` through `offlineFetch`, with actor `'system'`.
- [ ] **Step 1: Write the failing tests.** `deps` is `freshDb` + `setup`, then `offlineFetch`, a fixed `now`, and the example `site`.
  - **Speakers carry over between tweets:** `LONG` returns `needs_speakers`. Add `host_x` (🦁). After mapping, `LONG` returns `added`. `LIVE` by the same translator then doesn't list `🐱` as missing.
  - **Same event:** `EVENT_A` then `EVENT_B` land in 1 event, with 1 `tags` row for `#slhappyday2026` and 2 `item_tags`.
  - **Clipper account:** `EVENT_A` stores a `media` source whose account is `clipper_one`, with the stored variants, all on `video.twimg.com`.
  - **Joint live:** `JOINT_LIVE` creates an event with two `event_people`.
  - **Shared story:** `SHARED` with `{'🪇':{role:'speaker'}}` gives `placement 'shared_story'`, `event_id null`, and `item_people` with roles sharing/about where they resolve.
  - **Refusals:** duplicate, removed and opted_out.
  - **Manual text:** a manually entered text by a non-translator actor gives `pending`.
  - **Rollback:** a `persist` failure (inject a kind whose `persist` throws) leaves **no** `items`, `events` or `audit_log` rows.
  - **Posts:** `POST` stores placement `post`, sol as `author`, and a `quoted` source with the original text and its photo. `PHOTO` stores a media source with 2 images.
  - **Threads:** `THREAD` stores 1 `follow_up` source and 2 parts (positions 0, 1).
  - **Attach a pasted follow-up:**
    - Ingesting `…012` on its own after `THREAD` is archived returns **`attached`**, with the existing `itemId`. It adds no new item. Since `…012` is already a part, it's a no-op that returns `attached`.
    - A new same-author reply `…014` (add a fixture) is appended as part 2.
    - A reply by a different author is **not** attached; it goes through normal ingest.
  - **`checkFollowUps(deps, itemId, { actor }) → { added: number }`:** re-runs `fetchThread` for the primary source and adds missing same-author follow-ups as parts and sources. A second run adds 0. (Plan 2 puts this behind a button; there's no automatic checking.)
  - **Seeding:** `seedDev` on the example site prints `seeded 9`.
- [ ] **Step 2: Run the tests. Expected: FAIL.** Then implement. **Run the tests. Expected: PASS.** Commit: `"Translation kind persistence; generic ingest; add and seed-dev CLIs"`

---

### Task 11: Presenters, hub views, search

**Files:**
- Create: `src/kinds/translation/search.js`, `src/services/{hubs,search}.js`, `src/http/contracts.js`, `test/services/{hubs,search}.test.js`, `test/kinds/translation/presenter.test.js`
- Modify: `src/kinds/translation/{presenter,index}.js`

**Interfaces:**
- Produces:
  - **`src/http/contracts.js`:** JSDoc typedefs for every API response.
    - `Preview = { kind, sourceId, url, lines: BubbleVM[], people: PersonChip[], accountHandle, hasVideo, followsOnFrom }`.
    - `BubbleVM = { kind:'speech', emoji, name, colour?, text, cont } | { kind:'crowd', text } | { kind:'plain', text } | { kind:'note', mark, text }`.
    - **The server resolves names, emoji, colours and continuation**, so the client only renders. Names go through `formatName` on the server.
    - `PersonChip = { id, name, emoji, colour, igHandle }`.
  - **Translation presenter:**
    - `preview(item, details, ctx)`: the first 2 speech bubbles. If there are no speech lines, the first 2 plain lines that aren't part of the header.
    - `detail(item, details, ctx)`: `{ bubbles: BubbleVM[], cast: CastVM[], original: string, credits: { account, clipBy, postedAt, occurredOn }, sources, media: MediaVM|null }`.
    - `MediaVM = {type:'video', variants, width, height} | {type:'images', images:[{url,width,height}]} | {type:'quote', authorName, authorHandle, text, postedAt, inner: {type:'video',…}|{type:'images',…}|null}`.
    - Priority: the translator's own video, then the translator's own images, then the quote (with the quoted post's pictures or clip as `inner`).
    - Video and images are only included while their source's status is live. The quote card always shows, because its text is archived.
  - **`hubs.js`:**
    - `homeView(deps) → { months: [{ month, events: [{ slug, name, occurredOn, hashtag, counts: Record<kind, number> }] }] }`.
    - `eventView(deps, slug) → { event, accountCount, people, sections: [{ kind, items: Preview[] }] }`. Sections come in registry order, and empty kinds are left out.
    - `personView(deps, ig)` and `accountView(deps, handle)`. Handles that changed are resolved through `accounts`. If the requested handle isn't current, the view includes `redirectTo`.
    - `filterOptions(deps) → { people, categories, events: [{slug,name}] (recent 200), accounts: [{handle}] (visible only) }`.
  - **`search(deps, params)`:**
    - Params: `{ q, people, peopleMode, categories, placements, kinds, eventSlug, accountHandle, clientId, from, to, limit=50, offset=0 }`.
    - **Validation:** `q` is 2–100 characters after NFC, `offset ≤ 1000`, `limit ≤ 50`. Anything else throws `BadRequest`.
    - **Text clause:** each requested kind contributes `kind.search.textClause(n)`, OR-ed together. Tag matching on `tags.norm` also counts.
    - **People:**
      - `any` uses `exists(item_people … person_id = any($n))`.
      - `all` uses `i.id in (select item_id from item_people where person_id = any($n) group by item_id having count(distinct person_id) = cardinality($n))`.
    - "Shared story" and "posts" in the type filter mean `placements: ['shared_story']` and `['post']`.
    - Every query includes `visibleItem`.
    - **Ordering:** `similarity(body, q) desc, posted_at desc` when there's a `q`, otherwise `posted_at desc`.
    - Results are `{ count, results: (Preview & { event, matchLines })[] }`. `limit=0` returns the count only.
    - The translation `textClause` searches `translation_parts.body` (`exists … ilike`). Ranking uses the best-matching part's `similarity`.
- [ ] **Step 1: Write the failing tests** (seed: all live fixtures, with full maps):
  - **Preview and detail:**
    - The `LONG` preview's first bubble has the host's standard emoji.
    - A mapped `🐱` shows luna's `🌙`, named `'luna'`.
    - Consecutive same-speaker lines set `cont: true`.
    - The `EVENT_B` HTML-looking line stays raw text in `text`; escaping happens in Plan 1b.
  - **Hub views:**
    - `eventView` sections are `[{kind:'translation'}]`.
    - The home view's counts are per kind.
    - `accountView('old_handle')` after a handle change returns `redirectTo`.
  - **Search:**
    - `hug` finds `LONG`.
    - `ครบ` ranks `LONG` first, and `EXPLAIN` shows the trigram index on Postgres (skip this check if the Task 2 spike recorded no Thai trigrams).
    - `all` returns no more results than `any`, and more than 0.
    - `placements:['shared_story']` returns `[SHARED]`; `placements:['post']` includes `POST`.
    - `q:'a'` and `offset:5000` throw `BadRequest`.
    - Removed, opted-out and blocked items never appear.
    - An injection-shaped `q` returns count 0.
  - **Filter options:** excludes opted-out accounts.
- [ ] **Step 2: Run the tests. Expected: FAIL.** Then implement. **Run the tests. Expected: PASS.** Commit: `"Server-resolved view models, hub views, kind-aware search, contracts"`

---

### Task 12: Router function, routes, caching, meta, and the privacy sweep

**Files:**
- Create: `api/[...route].js`, `src/http/{handler,errors,query,origin}.js`, `src/routes/{index,home,event,item,search,filters,person,account,video,meta}.js`, `test/routes/*.test.js`, `test/privacy.test.js`
- Modify: `scripts/build.js` (generates `vercel.json` from `src/routes/index.js`)

**Interfaces:**
- Produces:
  - **`api/[...route].js`.** Exports `default { fetch(request) }` in the Web style. It:
    - builds `deps` per request with `withDeps()`, and calls `db.end()` in `finally`
    - matches the route
    - for **non-GET** routes, runs an Origin check against `site` URLs (`origin.js`)
    - parses query and body
    - calls `route.run`
    - maps `NotFound` to 404, `BadRequest` to 400 and `RateLimited` to 429, and anything else to a logged 500 with no request headers in the log
    - sets the route's `cache` header
  - **Routes.** Each module is `export const route = { method, path, cache, run }`. Each `run` is under 30 lines and calls services only. Paths:
    - `GET /api/home`
    - `GET /api/event/:slug`
    - `GET /api/item/:kind/:sourceId` (404 when the kind is unknown)
    - `GET /api/search`
    - `GET /api/filters`
    - `GET /api/person/:ig`
    - `GET /api/account/:handle`
    - `GET /api/video/:kind/:sourceId`: `{ variants }` from the **stored** media. 404 unless the item is visible and its source is live.
    - `GET /meta/t/:sourceId` and `GET /meta/e/:slug`: return the page HTML (read from the built `public/item.html` / `public/event.html`) with `<title>`, `og:title`, `og:description` (the first preview line, attribute-escaped, at most 200 characters), `og:image` (the site logo) and `twitter:card` injected.
      - Hidden or missing targets get generic site meta and a 200 status, so nothing leaks.
      - `vercel.json` rewrites `/t/:id` → `/meta/t/:id` and `/e/:slug` → `/meta/e/:slug`.
  - The `cache` header follows Global Constraints for public GETs.
  - The build writes `vercel.json` routes, rewrites, `regions`, and the headers from the spec's "Trust, safety and privacy" section: CSP, `frame-ancestors 'none'`, **`Referrer-Policy: no-referrer`**, nosniff, HSTS.
  - Clip playback depends on `no-referrer`: `video.twimg.com` returns 403 to a foreign Referer, as found in the Task 2 spike.
- [ ] **Step 1: Write the failing tests.**
  - **Route checks** (call each route's `run` with test deps):
    - `event` returns `sections[0].kind`.
    - `item` for a removed item throws `NotFound`.
    - `item` with an unknown kind throws `NotFound`.
    - `video` for `TOMB` throws `NotFound`.
    - `filters` lists only visible accounts.
  - **Handler checks** (with Web `Request`s):
    - a POST with a foreign `Origin` returns 403
    - every public GET has `s-maxage=300` and no `Set-Cookie`
    - a thrown error returns 500, and the logged output contains no `cookie` or `authorization` text
  - **Meta:**
    - `/meta/t/<LONG>` contains `og:title` and an escaped description.
    - For a removed item it contains only generic meta and no tweet text.
  - **`privacy.test.js`:**
    - Opt out `tl_gamma` and block a submitter user.
    - Call **every** route in `src/routes/index.js` with representative params, including search with no filter.
    - Assert that `tl_gamma`, `EVENT_B`'s source ID and its unique text appear nowhere in any body. Include the meta routes.
  - **Build:** `vercel.json` contains a rewrite for each page route, `"regions":["sin1"]`, and the CSP header.
- [ ] **Step 2: Run the tests. Expected: FAIL.** Then implement. **Run `npm run build && npm test && npm run check`. Expected: PASS.**
- [ ] **Step 3: CI.** `.github/workflows/ci.yml`:
  - Triggers on PRs and pushes.
  - `permissions: contents: read`, with actions **pinned to full commit SHAs**.
  - Runs `npm ci`, `npm run init-site`, `npm run build`, `npm run check`, then `npm test` (PGlite), then `npm test` again with `TEST_DATABASE_URL` pointing at a `postgres:17` service container.
  - Never uses `pull_request_target`.
- [ ] **Step 4: Commit:** `"Single router function, cached routes, link-preview meta, privacy sweep, CI"`

---

## Self-review notes

- **Review findings covered:**
  - **DB:**
    - text `row_key`
    - safe actor handling
    - date parser
    - diff audit across child tables
    - integrity checks
    - growing lists as text lookups
    - settings, `user_id` and the import tables
    - `event_people`
    - per-kind primary uniqueness
    - Thai trigram verification
    - `occurred_on` not null, with conversion to the site time zone
    - blocked users in the visibility rule
    - account merge
    - shared stories as placement
    - checksummed migrations with a lock
  - **Cost:**
    - cache headers
    - region `sin1`
    - stored video variants
    - unaudited check churn
    - Web fetch-style handlers
    - routes in one table
    - `robots.txt`
    - 3 s source timeouts

    Bundling, the rotating health check and backups are in Plan 1b or Plan 3.
  - **Architecture:**
    - one router function
    - per-request deps
    - bundled site config
    - kind plugins with generated registries
    - `examples/` instead of a committed `site/`
    - default tokens and copy
    - migration namespaces
    - one platform model
    - constants checked against SQL
    - server-resolved view models and contracts
    - Postgres CI
    - the generic privacy test
    - LICENSE, doctor, semver
    - task splits
    - a deploy spike first
  - **Security:**
    - the Origin check on writes
    - search bounds
    - source and URL allowlists
    - no fetching user URLs
    - manual-text entries go to pending
    - credit only by source ID
    - opt-out across every endpoint
    - escaped meta
    - headers and CSP
    - SHA-pinned actions with read-only permissions
    - audit log not deletable by the app role
    - no headers in logs
- **Deferred:**
  - **Plan 1b:** front end and pages, Playwright and axe, the scaffolder and recipes, start-your-own, emibonnie site, deploy with migrations, preview Neon branch, about/takedown/privacy pages, self-hosted fonts.
  - **Plan 2:** auth with narrowed X scopes, database-backed rate limits, add flow, me page, account deletion.
  - **Plan 3:** admin, import, rotating health check via Vercel Cron, weekly dump artifact, flags for deleted tweets at source, erasure script.
