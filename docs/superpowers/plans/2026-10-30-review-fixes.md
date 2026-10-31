# Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix what the 2026-10-30 code review found. Where a bug came from logic copied across many callers, fix it once in a shared piece and move the callers onto it, so the next caller reuses the piece instead of copying the mistake.

**Architecture:** A new shared interface is added only where it has many callers today **and** the copies have already caused a bug or drifted. Everything else is fixed in place. The table below lists each interface with its evidence, and the ones considered and dropped, with the reason. Engine work happens in `../fan-archive` and reaches this repo as a tagged release, as with v0.4.0. Site work (`site/`, the region, the deploy script) happens here.

**Tech Stack:** Node ≥22 plain ESM JS with `// @ts-check`, `node --test`, PGlite and Neon (`@neondatabase/serverless` ^1.2), Playwright, esbuild, bash, Vercel (prebuilt deploys).

**Spec:** The code review in the session of 2026-10-30. Each task restates the findings it covers. Architecture rules: `docs/architecture.md`.

## Global Constraints

- Engine changes are committed in `../fan-archive` only, never in this repo (`docs/superpowers/specs/2026-10-30-styling-system-design.md`, "Where it's built").
- **Another agent is executing `2026-10-30-styling-system.md` in `../fan-archive` on branch `styling-system`.**
  - Phase A works in a separate worktree, `../fan-archive-review`, on branch `review-fixes`, cut from `main`.
  - Phase B (front-end pages, `pullProd.js`, `authDev.js`) starts only after `styling-system` is merged to `main`. Those files are rewritten or exist only there.
  - Never edit the main `../fan-archive` checkout.
- Every file starts with `// @ts-check`. Keep ESLint limits: `max-lines` 200, `max-lines-per-function` 50, `complexity` 10, `max-params` 4.
- Keep layer rules: routes don't touch `repo`/`db`; parameterised SQL only.
- **A migrated caller keeps its behaviour.** Each migration step runs the caller's existing tests unchanged before any test is edited. A test changes only when the review found it wrong (named in the task).
- **Delete the old copy in the same task that moves its last caller.**
- **No new interface without a caller count.** An implementer who finds they're adding a parameter, hook or option that no current caller uses leaves it out.
- Copy goes in `src/site/copyDefaults.json` (namespaced keys).
- Nothing in this plan touches production except Task 1 and Task 18, which the owner runs by hand.
- `npm run check` and `npm test` pass at every commit.

## Shared pieces: what's added, and why

Caller counts are from the code at `efa5598`.

| Piece | Callers today | Evidence it's needed |
|---|---|---|
| `defineRoute({ auth, limit, body, cache, run })` (`src/http/defineRoute.js`) | 20 owner checks in 4 route files, 18 `requireUser`, 25 `limit()` calls, 17 `input.body` casts | Three owner routes have no refusal test; `importActions.js` grew its own `ownerOf`; private GETs are kept on a hand-written list that has already gone stale |
| `write(deps, actor, fn)` + `itemLifecycle` (`src/services/write.js`, `itemLifecycle.js`) | 15 hand-placed purge calls; 3 publish paths | Import publishes outside the held-parts transaction; mapping an `attached` row changes a public page with no purge; owner actions logged as `system` |
| `kindNamed(deps, name)` (`src/services/cards.js`) | 13 lookup sites | 8 are unguarded: `kindsRegistry['constructor']` returns a function |
| A `Deps` typedef (`src/http/deps.js`) | Every route's `run` (typed `any` today) | `env` arrives by two paths that can disagree; a misspelled dep isn't caught |
| `runCli(main, options)` (`scripts/cli.js`) | 7 scripts open a db; `SITE_DIR` read 19 times | 3 CLIs can quietly use an in-memory db; `remap.js` re-implements the migrate guard |
| `runAction(el, fn, { onError })` (`public/js/core/dom.js`) | 8 hand-written disable/re-enable sites in 6 files | 3 handlers leave a dead button on failure (`event.js` ×2, `me.js`) |
| `loadEntityPage(spec)` and `signedOutScreen(...)` (`public/js/core/`) | 3 entity pages share one start skeleton; 4 separate signed-out screens | The copies already differ (e.g. `composeSignedOut` ignores the `returnTo` it's given) |
| `withGlobals(...)` (`test/helpers/globals.js`) | 6 test files assign `globalThis.fetch`/`document` | `edit.test.js` never restores `fetch` |
| `site/scripts/lib.sh` | 3 scripts share one preamble; the `vercel` wrapper and CLI pin appear twice | Dry-run lines are hand-copied beside real commands, so the tests check text, not commands |

**Considered and not added:**
- **New kind hooks for import, and a migration adding a job `kind` column.** There's one kind. The missing-people bug is fixed through the existing `remapSpeakers` hook.
- **A source registry (`linksIn`/`urlOf`/`imageAt`).** There's one source. Instead: reuse `extractTweetIds`, add one `statusUrl(id)` for the 3 copies, and size thumbnails inside `thumbAt`.
- **`oauthFlow(provider)`.** There are two providers and the copied blocks are short. Revisit when a third is added.
- **`replaceDir`.** It would have one caller (`pull-prod`), so the fix stays inline.
- **An `api` endpoints module.** It would replace 5 template strings over IDs that don't need encoding. The one raw `fetch` is fixed in place.
- **A `mountView` view framework.** It would migrate 31 components to fix bugs in 3 pages. Binding to the freshly mounted element, which `add.js` and `item.js` already do, fixes them.
- **`openDialog`.** All seven dialogs use native `<dialog>.showModal()`, which already handles Escape and focus.
- **New route and seed harnesses.** `test/helpers/api.js` (`apiFor`, used by 17 test files) and `test/helpers/seed.js` already exist; tests use them.

## Review Focus

- **An owner opening a held entry after Task 13.** They must still see it, even when the public `/api/item/…` answer is a cached 404 (test in Task 13).
- **A signed-in visitor with no or a stale hint cookie.** Missing hint: no editor buttons, nothing broken. A cookie with no valid session: the viewer call answers 401 and the page treats the visitor as signed out (Task 13).
- **An action whose request fails.** The button comes back enabled, the error is announced, and a second click works (Task 14).
- **A retry where every row fails for good.** The loop ends after one pass (Task 6).
- **`pull-prod` against a database whose migrations differ.** `.devdb` is untouched (Task 15).

---

## Phase 0: the region (site repo, owner runs it)

### Task 1: Run the API function in the database's region

Production responses carry `x-vercel-id: sin1::iad1::…`: the function ran in iad1 while Neon is in Singapore, despite `"regions": ["sin1"]` in `vercel.json`. Measured cache misses take about 4.1–4.3 s; a cache hit takes 49 ms.

**Files:** `site/scripts/deploy.sh` (post-deploy region line), `site/docs/deploy.md`, `site/test/deployScript.test.js`

- [ ] **Step 1: Record the baseline.** Run `curl -s -o /dev/null -D - -w '%{time_starttransfer}\n' "https://emibonnie-archive.vercel.app/api/search?q=zz$RANDOM&limit=0"` three times. Record each TTFB and `x-vercel-id` in a new "Function region" section of `site/docs/deploy.md`.
- [ ] **Step 2: Find where the region is lost.**
  - Run `npm run build`, then `vercel pull --yes --environment=preview`, then `vercel build`, using the CLI version pinned in `deploy.sh`.
  - Read `regions` in `.vercel/output/functions/api.func/.vc-config.json` and `.vercel/output/config.json`.
  - Check the dashboard setting under Settings → Functions → Function Region.
  - Read https://vercel.com/docs/functions/configuring-functions/region and quote which setting wins.
  - If nothing explains `iad1`, stop and report what you found (`rules/debugging.md`).
- [ ] **Step 3: Apply the documented fix** and record it in `deploy.md`.
- [ ] **Step 4: Write the failing test.** `deployScript.test.js` › `deploy reports where the function ran`: a fake `curl` answers `x-vercel-id: sin1::iad1::a`, and stderr matches `/function ran in iad1, expected sin1/`. With `sin1::sin1::a`, stdout matches `/function region sin1/`.
- [ ] **Step 5: Implement.** `post_deploy_region "$DEPLOY_URL"` takes the second `::` field of `x-vercel-id` from `curl -sI "$1/api/home"` and compares it with `site.json`'s `region`. A non-200 answer prints `could not check the function region (HTTP <code>)`.
- [ ] **Step 6: Run, deploy and measure.** The test should PASS. Deploy with `--prod`, repeat Step 1, and expect `::sin1::`. Record the after-numbers.
- [ ] **Step 7: Commit.** `git commit -am "fix(deploy): run the API in the database's region and report where it ran"`

---

## Phase A: engine back end and tooling (`../fan-archive-review`, branch `review-fixes` from `main`)

- [ ] **Setup:** `git -C ../fan-archive worktree add ../fan-archive-review -b review-fixes main && cd ../fan-archive-review && npm ci && node scripts/genRegistries.js && npm test`. Expected: green.

### Task 2: Restore test globals; drop the tests that can't fail

**Files:**
- Create `test/helpers/globals.js`
- Migrate its 6 callers: `test/components/meTranslations.test.js`, `importSpeakers.test.js`, `reportForm.test.js`, `ownerSection.test.js`, `importRows.test.js`, `test/pages/edit.test.js`
- Modify `test/helpers/miniDom.js:133-137`, `test/api.test.js:45-78`, `test/http/handler.test.js`, `test/repo/visibility.test.js:32-37`

**Interfaces:** `withGlobals(overrides: Record<string, unknown>, fn: () => Promise<T>) → Promise<T>` sets each `globalThis[key]`, runs `fn`, and restores the previous values, deleting keys that were absent, in `finally`.

- [ ] **Step 1: Write the failing tests.**
  - `withGlobals restores globals even when fn throws`.
  - `miniDom` › `a listener added during dispatch does not run in that dispatch`; fix it by iterating over `[...listeners]`.
- [ ] **Step 2: Implement and migrate the 6 files.** Run, and expect PASS.
- [ ] **Step 3: Fix and remove the review's broken tests.**
  - Move "ip never logged" into `handler.test.js` as `a failing route's log line never carries the caller's ip`. The route throws; assert `logs.length === 1` and that the line doesn't contain `203.0.113.5`. Delete the old assertion and the unused `freshDb()`.
  - Delete `visibility.test.js:32-37`: its regex can never match.
  - Delete `handler.test.js:59,76`: they only check that a constant equals itself.
  - Rename `handler.test.js:227` to `…to NOT_FOUND_CACHE or PRIVATE_NO_STORE, and nothing else`, and add the `PRIVATE_NO_STORE` case.
- [ ] **Step 4: Run and commit.** `npm test` PASS. `git commit -am "test: restore globals in one helper; replace tests that could not fail"`

### Task 2b: Faster test databases (no test removed)

Measured at `efa5598` on 8 cores: `npm test` takes 150 s of wall time. The wall time is set by one file: `test/services/ingest.test.js` takes about 147 s while running alongside the others. The next longest are `test/kinds/scaffoldedKind.test.js` (59 s), `test/services/editItem.test.js` (56 s) and `test/db/pgliteShared.test.js` (54 s).

Each database test calls `freshDb()` (`test/helpers/db.js:38-51`), which starts a new in-memory PGlite: about 0.7–0.8 s even with no migrations, and running all migrations adds little. The Postgres path already gives each call its own schema on one server, and CI runs the whole suite that way, so the migrations are known to work per schema.

**Files:**
- Modify `test/helpers/db.js` (`freshDb`)
- Modify `src/db/pglite.js` only if a shared in-memory instance needs a key; today only `dir` is shared
- Split `test/services/ingest.test.js` by topic into `test/services/ingest/*.test.js`, and likewise any other file still over 40 s after the helper change

**Interfaces:**
- `freshDb({ migrated = true } = {})` keeps its signature and return type.
- Without `TEST_DATABASE_URL`, it returns a `Db` on **one PGlite instance per test process**, in a fresh `uniqueName('fa_test')` schema, migrated there exactly as the Postgres path does. `end()` drops the schema and releases the instance.
- Tests that need a whole instance (`test/db/pgliteShared.test.js`, any test of `createDb({ dir })` itself) keep opening their own; they don't use `freshDb`.

- [ ] **Step 1: Measure the baseline.** Run `npm test` and record the wall time, plus the four slowest files timed one by one with `node --test <file>`. Use these as the baseline in the report.
- [ ] **Step 2: Write the failing test.** `test/helpers/db.test.js` › `two freshDb calls in one process share a PGlite instance but not data`: an insert in one isn't visible in the other, and both see the migrated tables. Run it: FAIL.
- [ ] **Step 3: Implement the shared instance.** Run `npm test`: every test must pass unchanged. A test that fails only under the shared instance (e.g. it reads global state such as roles) is a real isolation finding: give that one test `freshDb`'s own instance and list it in the report. Never delete or weaken an assertion.
- [ ] **Step 4: Split the slow files.**
  - Re-time per file. Split any file over 40 s by topic, keeping every test name and body unchanged. Shared setup moves to `test/helpers/` if more than one new file needs it.
  - Check the test counts with `grep -c "^test(" before/after`: the total must match.
- [ ] **Step 5: Run and record.**
  - `npm test` wall time (target: at most 75 s).
  - `TEST_DATABASE_URL` path unchanged: if no Postgres is available locally, say so in the report.
  - `npm run check` passes.
  - Record before and after numbers in the commit message and in `CONTRIBUTING.md`'s testing section, one line: how to time a single file.
- [ ] **Step 6: Commit.** `git commit -am "test: one PGlite per test process with a schema per test; split the slowest files"`

### Task 3: `defineRoute`: auth, rate limit, body and cache in one place

Owner writes repeat `requireOwner` + `limit(deps,'owner',…)` (20 checks across 4 files). `importActions.js:11-15` has its own `ownerOf`. Bodies are read through 17 `/** @type {any} */ (input.body)` casts. Three owner routes have no refusal test (unblock, archive, retry). `routes.test.js:53-55` keeps a hand-written list of private GETs, five of whose entries are dead.

**Files:**
- Create `src/http/defineRoute.js`
- Migrate every module in `src/routes/` that calls `requireOwner`, `requireUser`, `currentUser` or `limit`, or reads `input.body`
- Modify `test/routes/routes.test.js`, `test/routes/owner.test.js`

**Interfaces:**
- `defineRoute(spec) → Route`, where:
  - `spec.method`, `spec.path`
  - `spec.auth`: `'none'|'optional'|'user'|'owner'`
  - `spec.limit?`: a key of `LIMITS` in `src/services/limits.js`
  - `spec.body?`: `(raw: unknown) => T`, throwing `BadRequest`
  - `spec.cache?`, `spec.query?`
  - `spec.run(ctx, deps)`, with `ctx = { params, query, body: T, user: SessionUser|null, ip, origin, cookies }`
- The wrapper's order:
  1. Resolve the user (`'user'` → `requireUser`, `'owner'` → `requireOwner`, `'optional'` → `currentUser`).
  2. Apply `limit`, keyed by `user.id`, else the IP.
  3. Parse the body.
  4. Default the cache: a GET with `auth` of `'user'` or `'owner'` gets `PRIVATE_NO_STORE`, and a POST gets `NO_STORE`. Declaring `PUBLIC_CACHE` on a `'user'|'owner'` GET throws when the route is defined.
- `Route` gains a read-only `auth` field. The handler is otherwise unchanged.
- Routes that use none of these features (`home`, `search`, `filters`, the meta routes) are left as they are.

- [ ] **Step 1: Write the failing tests** in `test/http/defineRoute.test.js` (with `apiFor`):
  - `owner routes answer 401 to a visitor and 403 to a member`.
  - `a limited route answers 429 after its limit`.
  - `a body parser's BadRequest becomes a 400`.
  - `a signed-in GET defaults to private, no-store`.
  - `declaring PUBLIC_CACHE on an owner GET throws at definition`.
- [ ] **Step 2: Implement** (PASS).
- [ ] **Step 3: Migrate one route file at a time,** with that file's tests unchanged. Delete `ownerOf`, the inline auth and limit pairs, and the body casts. Each body becomes a small parser next to its route.
- [ ] **Step 4: Replace the route-table tests.**
  - Replace `routes.test.js`'s hand-written list with `a GET that resolves a user is never publicly cached`, read from each route's `auth`.
  - Replace the per-route owner refusals with one loop over `routes.filter(r => r.auth === 'owner')`.
- [ ] **Step 5: Run and commit.** `npm test`, `npm run check` and `npm run e2e` PASS. `git commit -am "refactor(http): defineRoute owns auth, limits, body parsing and cache defaults"`

### Task 4: A typed `Deps`, one clock, one kind lookup

`BaseDeps` has `[key: string]: unknown` (`handler.js:31`), and every `run` takes `deps: any`. The handler takes `env` separately (`handler.js:178`) from `deps.env`. `translator.js:69`, `session.js:201` and `oauthState.js:60,97` read the real clock. Kinds are looked up at 13 sites; the unguarded ones are `editItem.js:161,234,256`, `remap.js:25`, `importJob.js:45,74` and `ingest.js:58`. `Tx` is re-declared in 22 repo files, and the copies disagree about `rowCount`.

**Files:**
- Create `src/http/deps.js`
- Modify `api/index.js:39-50`, `src/http/handler.js`, `src/services/cards.js`, the 13 lookup sites, `oauthState.js`, `translator.js`, `session.js`, every `src/repo/*.js` (`/** @typedef {import('../db/common.js').Tx} Tx */`), and `docs/architecture.md` rule 4

**Interfaces:**
- `Deps = { db, fetchImpl, now: () => Date, site, env, pages, invalidateByTag, dangerouslyDeleteByTag, defer }`. List only the fields `api/index.js` builds today.
- `kindNamed(deps, name: string) → Kind | null`.
- `issueState(deps, …)` and `takeState(deps, …)` read `deps.now()`.

- [ ] **Step 1: Write the failing tests.**
  - `kindNamed(deps, 'constructor') === null`.
  - `POST /api/item/constructor/1/edit` as a member → 404.
  - `an OAuth state expires 10 minutes after deps.now()`.
  - The session's `last_seen_at` equals `deps.now()`.
- [ ] **Step 2: Implement and migrate.** `npm run check` must pass with the index signature removed; fix what it reveals.
- [ ] **Step 3: Run and commit.** `git commit -am "refactor: typed Deps, injected clock, one guarded kind lookup"`

### Task 5: `write()` and `itemLifecycle`: one way to change an item's state

There are three publish paths:
- `owner.reviewItem` (`owner.js:93-98`) publishes in one transaction together with the held parts.
- `importActions.publishRows` (`:41-50`) and `archiveRow` (`:97-99`) publish in a separate transaction from the row update, and skip `reviewHeld` for non-attached rows.
- The attached-row branch is copied between `publishRows` and `skipRow`.

There are 15 purge calls placed by hand after transactions, and `recordResult` repeats one transaction 4 times (`importJob.js:249-263`).

**Files:**
- Create `src/services/write.js`, `src/services/itemLifecycle.js`
- Migrate the 15 purge sites (`owner.js`, `ownerUsers.js`, `importActions.js`, `translator.js`, `editItem.js`, …)
- Modify `importJob.js` (`recordResult` → one `setRowResult(w, row, result)`)

**Interfaces:**
- `write(deps, actor: string, fn: (w) => Promise<T>) → Promise<T>`.
  - `w = { tx, purge: { item(itemId), itemRemoved(itemId), account(accountId), accountRemoved(accountId), tags(tags, { removed }) } }`. Add only the purge kinds the 15 sites use.
  - It runs `fn` in `deps.db.transaction(…, { actor })`, and queued purges run after commit through `deps.defer` and `src/services/cache.js`.
- `itemLifecycle`:
  - `publish(w, { itemId, kindName, part?: number })` approves the item, or only `part`, with its held parts via `kind.reviewHeld`, then queues `purge.item`.
  - `reject(w, { itemId, kindName, part? })` queues `purge.itemRemoved`.
  - `remove(w, { itemId, reason })`.

  These are the three operations owner and import share. Don't add others.

- [ ] **Step 1: Write the failing tests.**
  - `a purge queued in a write that rolls back never runs`.
  - `publish approves the item and its held parts in one transaction`.
  - `publish with a part changes only that part`: assert that part's own `pending === false` and the sibling unchanged. This replaces the tautology at `importActions.test.js:56`.
  - `an import publish updates the row and the item together`: make the row update throw, and the item is still pending.
- [ ] **Step 2: Implement and migrate.** Delete every purge call outside `write.js`.
  - Fix `importJob.test.js:96-103` to use a published row that has an item, so it reaches the terminal-state guard.
  - Delete `importJob.test.js:58`, which `:166` covers.
- [ ] **Step 3: Run and commit.** `git commit -am "refactor: write() with after-commit purges; one item lifecycle for owner and import"`

### Task 6: Retry walks each row once per pass

`retryRows` always takes the first 10 queued/failed rows (`importActions.js:110-120`). Permanently failing rows are re-picked, `remaining` never reaches 0, and the page loops 200 times (`importSpeakers.js:229`).

**Files:** `src/repo/imports.js` (`rowsForRun`), `src/services/importActions.js`, `src/routes/importActions.js` (body `{ afterId?: integer ≥ 0 }`), `public/js/components/importSpeakers.js` (`retryJob`), and their tests

**Interfaces:**
- `rowsForRun(db, jobId, { afterId = 0 } = {})`.
- `retryRows(deps, { jobId, actor, afterId = 0 }) → { processed, remaining, lastId }`.
  - `lastId` is the id of the last row processed, or `afterId` when none was.
  - `remaining` counts queued/failed rows with `id > lastId`.

- [ ] **Step 1: Write the failing tests.**
  - `retry makes progress past rows that keep failing`: 12 rows with a fetch that always answers 404. Call 1 → `{processed:10, remaining:2}`; call 2 with `afterId` → `{processed:2, remaining:0}`; 12 fetches in total.
  - `retryJob sends the cursor back and stops at remaining 0`.
- [ ] **Step 2: Implement, run (PASS) and commit.** `git commit -am "fix(import): retry walks each failed row once per pass"`

### Task 7: Import mapping through `remapSpeakers`; one status URL

`applyMapping` writes raw `translation_speakers` SQL (`importMapping.js:42-56`) and never updates `item_people`. As a result, mapped imports never reach person pages (`repo/hubQueries.js:72`) or people search (`repo/search.js:70`). The kind's existing `remapSpeakers` hook (`src/kinds/translation/remap.js:85`) already updates both tables. The X status URL is built in 3 places (`importSources.js:113`, `importJob.js:34,237`). `importSources.extractStatusLinks` (`:130-137`) re-implements `sources/url.js`'s `extractTweetIds` with a looser regex that accepts any host.

**Files:** `src/services/importMapping.js`, `src/routes/importMap.js`, `src/sources/url.js` (`statusUrl`), `importSources.js`, `importJob.js`, and their tests

**Interfaces:**
- `applyMapping(deps, { jobId, accountId, marker, speaker, remember?, entries?, actor })`. Per target:
  - Look the kind up with `kindNamed`.
  - In batch mode, skip items whose speakers already have `marker`.
  - Call `kind.remapSpeakers(w.tx, { itemId, map: { [marker]: speaker }, ctx })` inside `write(deps, actor, …)`, with `ctx` from `loadContext` in `src/services/remap.js`.
  - `w.purge.item` for `attached` rows.
- `statusUrl(id: string) → string` in `src/sources/url.js`.

- [ ] **Step 1: Write the failing tests.**
  - `a mapped marker puts the person on the entry's people`: `listItemPeople` includes the person, and once published the person hub lists the item.
  - `batch mode leaves an entry that already answers the marker alone`.
  - `remember merges into existing memory`: start non-empty. This replaces `importMapping.test.js:66`.
  - `mapping reaches every entry of that translator in the job and no one else's`: this replaces the `>= 1` at `:38`.
  - `the audit log names the owner`.
  - `mapping an attached row purges its public parent`.
  - `status links on another host are ignored`: `fox.com/a/status/12345` → `[]`.
- [ ] **Step 2: Implement.** Delete the raw SQL, `extractStatusLinks`'s regex, the 3 inline URLs and `classifyDetails`'s unused `deps`.
- [ ] **Step 3: Run and commit.** `git commit -am "fix(import): map speakers through remapSpeakers so people update; one status-link parser"`

### Task 8: `runCli`

Seven scripts open a db, each choosing its options its own way. `import.js:182`, `add.js:95` and `seedDev.js:24` fall back to in-memory PGlite. `remap.js:47` re-implements `migrateTargetOf` (`migrate.js:28`). `SITE_DIR` is read 19 times.

**Files:** Create `scripts/cli.js`; migrate `add.js`, `import.js`, `migrate.js`, `remap.js`, `seedDev.js`, `setup.js`, plus every other `SITE_DIR` reader. Test: `test/scripts/cli.test.js`.

**Interfaces:** `runCli(main, { db: 'required'|'none' = 'required', args?: ParseArgsOptions }) → Promise<void>` calls `main({ db, siteDir, values, positionals, log, env })`.
- `'required'` refuses when neither `DATABASE_URL` nor `PGLITE_DIR` is set (`migrateTargetOf`, moved here).
- The db is always ended.
- Failures print `migrate.js`'s safe summary (moved here) and set `process.exitCode = 1`.

- [ ] **Step 1: Write the failing tests.**
  - `runCli refuses an in-memory database when one is required`.
  - `runCli ends the db when main throws`.
  - `import with an empty env fails before reading its input`.
- [ ] **Step 2: Implement and migrate.** Delete `migrateTargetOf` and the per-script `SITE_DIR` reads.
- [ ] **Step 3: Run and commit.** `git commit -am "refactor(scripts): one runCli for db, site dir and errors"`

### Task 9: CI in a site repo, and a synthetic handle in tests

`.github/workflows/ci.yml:46,72` runs `npm run init-site`, which refuses when `site/` exists, so every CI run in a site repo fails. `vacantvolcanic`, a real translator handle, appears in `test/components/me.test.js:27`, `test/domain/displayName.test.js:7` and `test/routes/me.test.js:80`.

- [ ] **Step 1: Replace the handle.** Change it to `sample_translator`, and confirm with `grep -rn vacantvolcanic .`: no hits.
- [ ] **Step 2: Fix CI.** In both jobs, `run: '[ -d site ] || npm run init-site'`. In the `test` job, add a step that runs `if [ -d site/test ]; then node --test "site/test/**/*.test.js"; fi`.
- [ ] **Step 3: Verify and commit.** Push, check that `gh run watch` is green, and commit.

### Task 10: The add page saves once

`add.js:219` and `:221` both bind `[data-action="save"]` on the same `main`, so one click sends two `POST /api/add`. `edit.js:145` already leaves `onSave` out of `speakerStep.bind`.

- [ ] **Step 1: Write the failing test.** `test/pages/add.test.js` › `one save click sends one POST` (using `withGlobals`). Run it: FAIL.
- [ ] **Step 2: Fix.** Drop `onSave: save` from `add.js:221`. Run: PASS.
- [ ] **Step 3: Commit.** `git commit -am "fix(add): one save per click"`

### Task 11: Smaller first screen

**Files:**
- `src/kinds/translation/media.js:97-120` (`thumbAt` adds `name=<SIZE>` to pbs.twimg.com URLs and keeps `format`)
- `public/js/components/thumb.js` (`render(thumb, { eager = false } = {})`; eager → `loading="eager" fetchpriority="high"`), and the three card lists `resultCard.js`, `previewCard.js`, `eventCard.js` (eager for index < 4)
- `scripts/build.js:119-132` (the site logo is copied into hashed `/build/`, and the header and favicon use it)
- `public/js/components/sourceEmbed.js:127-140` (`widgets.js` is added by one `IntersectionObserver` with `rootMargin: '200px'` that disconnects after the first hit)
- `src/html/index.html` (`<link rel="preload" as="fetch" href="/api/home" crossorigin>`)
- `src/services/meta.js` (`itemMetaPage`/`eventMetaPage` inject the same link for their API path, escaped with `escapeAttr`; MDN: `as="fetch"` needs `crossorigin`, https://developer.mozilla.org/en-US/docs/Web/HTML/Attributes/rel/preload)

- [ ] **Step 1: Pick the size.** Fetch one media URL and one video poster with `name=360x360` and with `name=small`, and check pixel sizes with `sips -g pixelWidth -g pixelHeight`. Use `360x360` if it keeps the aspect ratio, else `small`. Record the bytes in `thumbAt`'s comment.
- [ ] **Step 2: Write the failing tests.**
  - `thumbAt adds the size and keeps format`.
  - `thumb.render(x, { eager: true })` contains `loading="eager"`.
  - The built logo path matches `/^\/build\/logo-[0-9a-f]{10}\.(png|svg)$/`.
  - `widgets.js is added once, when the first embed intersects`.
  - The item meta HTML has the preload link, and a `"` in the source id is escaped.
  - e2e › `home and item pages request their API once`.
- [ ] **Step 3: Implement, run (PASS) and commit.** In headed Chromium the console must not show "preloaded but not used". `git commit -am "perf: sized and eager thumbnails, hashed logo, lazy X embeds, API preload"`

### Task 12: Neon reads over HTTP (only if Task 1 leaves misses slow)

- [ ] **Step 1: Decide whether to do this.** After Task 1 is deployed, time five misses of `/api/search?q=<random>&limit=0`. If the median TTFB is under 500 ms, mark this task skipped.
- [ ] **Step 2: Read the docs.** Read `node_modules/@neondatabase/serverless/README.md` (`neon()`, `fullResults`, `types`, `sql.query(text, params)`) and cite it in `src/db/client.js`.
- [ ] **Step 3: Write the failing test.** `plain queries go over HTTP, transactions over a lazily created pool` (fakes via `createNeonDb(url, searchPath, { httpQuery, PoolImpl })`).
- [ ] **Step 4: Implement, run and commit.** `npm test` PASS, also with `TEST_DATABASE_URL` against Postgres 17. Commit.

### Task 13: One cached item answer for everyone

`src/routes/item.js:27` answers any signed-in viewer `private, no-store`, so the owner never gets the cache.

**Decision (the owner may override):** a non-HttpOnly `signed_in=1` hint cookie tells the page to ask for its per-user fields.
- It carries nothing secret and grants nothing; the private endpoint still checks `sid`.
- It relaxes "cookies are always HttpOnly" (`src/domain/cookies.js:6`) for this one cookie.
- Alternative: no hint, and every visitor's item page makes one extra uncached call.

**Files:**
- `src/domain/cookies.js` (`hintCookie(on)`), `src/services/session.js` (sign-in, sign-out and sign-out-everywhere set or clear the hint), `src/services/deleteAccount.js`
- `src/routes/item.js` (`auth: 'none'`, the public view only)
- Create `src/routes/itemViewer.js`: `GET /api/item/:kind/:sourceId/viewer`, `auth: 'user'`
- `src/services/itemView.js` (`viewerFieldsOf`), `src/http/contracts.js` (`ItemViewerVM`)
- `public/js/pages/item.js`, `docs/architecture.md` (the item-page paragraph)

**Interfaces:** `ItemViewerVM = { canEdit, canCheckFollowUps, editOpenUntil: string|null, held: ItemView|null }`. `held` is filled only for the owner, on a held item.

- [ ] **Step 1: Write the failing tests.**
  - `a signed-in reader gets the same cacheable answer as a visitor`.
  - `viewer answers a member's edit fields privately`.
  - `viewer refuses a visitor`: 401.
  - `the owner gets a held entry through viewer.held; a member gets null`.
  - Page: `with the hint, editor buttons appear once viewer answers`.
  - Page: `a 404 public view plus viewer.held renders the held entry`.
  - Page: `a 401 viewer answer leaves a plain reader's page`.
  - Session: sign-in sets the hint; sign-out, sign-out everywhere and delete clear it.
- [ ] **Step 2: Implement, run and commit.** `npm test` and `npm run e2e` PASS, including `e2e/owner.spec.js` and `e2e/import.spec.js`. Commit.

### Release 0.4.1

- [ ] **Step 1: Docs.** In `CHANGELOG.md`, list the fixes. For site owners: the `…/viewer` route, the hint cookie, and `defineRoute` for any site route. Bump `package.json`.
- [ ] **Step 2: Verify.** `npm run check && npm test && npm run e2e` should PASS.
- [ ] **Step 3: Merge, tag and push.** In the review worktree: `git switch main && git merge --no-ff review-fixes && git tag v0.4.1 && git push origin main v0.4.1`. Tell the owner that `main` moved, so `styling-system` merges it before its own release.

---

## Phase B: engine front end and dev tooling (after `styling-system` is merged to `main`; new worktree, branch `review-fixes-2`)

### Task 14: Rebind on the fresh page; `runAction` for async buttons

`pages/me.js:166` calls `bind(root, state)` again after each `mountPage` on the same `root`, so handlers stack: `ownerSection.js:184-219`, `meTranslations.js:166-195`, `meAccount.js:18-52`. `adminImport.js` `paint()` does the same. `add.js:211` and `item.js` already bind to the freshly mounted element, which is replaced on every mount, so this is the existing pattern applied to the two pages that skipped it.

Separately, 8 handlers in 6 files disable a button and re-enable it by hand (`reportForm.js`, `inlineSearch.js`, `refreshButton.js`, `event.js`, `hubGroups.js`, `me.js`). Three leave it dead on failure: `event.js:176-206` ×2 and `me.js:184-197`. `refreshButton.js:143` uses a raw `fetch` only to read a 409, which `ApiError.status` already carries.

**Files:**
- Modify `public/js/core/dom.js`: `mountPage` returns the mounted scope element, and `runAction` is added.
- Modify `public/js/pages/me.js`, `meAccount.js`, `adminImport.js`, and the 6 `runAction` files.
- Test: `test/pages/me.test.js` (moving the `pages/me.js` tests out of `test/components/me.test.js`), `test/pages/adminImport.test.js`, `test/core/dom.test.js`.

**Interfaces:**
- `mountPage(root, html) → Element`: the new `<main>`, or `root` when there is none.
- `runAction(el, fn: () => Promise<void>, { onError }: { onError: (err) => void }) → Promise<void>`.
  - It returns at once if `el` is already `aria-busy`.
  - Otherwise it sets `disabled` and `aria-busy="true"`, awaits `fn`, and on rejection calls `onError(err)`.
  - In every case it re-enables `el` if it's still in the document.

- [ ] **Step 1: Write the failing tests.**
  - `after two rerenders, one "more" click fetches once` (/me).
  - `after a rerender, one approve click posts once` (/me, as owner).
  - `after a refresh, one skip click posts once` (import).
  - `after a refresh, the review toggle still expands and collapses` (import).
  - `runAction ignores a second activation while busy`.
  - `runAction re-enables after a failure and reports it`.
  - `a failed "more" on the event page re-enables and announces the load failure`.
- [ ] **Step 2: Implement and migrate.**
  - `me.js` and `adminImport.js` bind to the element `mountPage` returns.
  - The 8 sites use `runAction`; error copy is `t('page.loadFailed')` in the page's existing live region.
  - `refreshButton` uses `postJson` and reads `ApiError.status === 409`.
  - Replace the component tests that stub `reload` (ownerSection, meTranslations, importRows) with page-level tests where they only covered the now-fixed rebinding.
- [ ] **Step 3: Run and commit.** `npm test` and `npm run e2e` PASS. `git commit -am "fix(me, import): bind to the fresh page; runAction for async buttons"`

### Task 15: `pull-prod` keeps `.devdb`; dev sign-in through the repo

`scripts/pullProd.js:151` deletes `.devdb` before the migration check, and reads production table by table outside a transaction. `src/routes/authDev.js:42-53` runs raw SQL with its own copy of the visibility rule, which leaves out the blocked-submitter check. `authDev.js:101` clears the cookie without revoking the session. The dev gate is repeated in `importDev.js:18`.

**Files:**
- `scripts/pullProd.js` (through `runCli` with `{ db: 'none' }`; migrate and copy into `<dir>.tmp-<pid>`, then swap it in; on failure remove only the temp directory)
- `src/db/client.js` (`transaction(fn, { actor, isolation? })`)
- `src/routes/authDev.js`, `src/routes/importDev.js` (both through `defineRoute`; `devEnabled` exported once)
- `src/repo/accounts.js` (`firstCreditedAccount(db, handle)` using `visibleItem('i')`)
- `src/services/session.js` (export `SESSION_COOKIE`, used by `deleteAccount.js` and `authDev.js`)

- [ ] **Step 1: Write the failing tests.**
  - `a migration mismatch leaves the dev database as it was`.
  - `the source is read in one repeatable-read transaction`.
  - `firstCreditedAccount skips an account whose only entry's submitter is blocked`.
  - `switching role in dev revokes the old session`.
- [ ] **Step 2: Implement, run (PASS), commit, and release** (0.5.1, or fold into the styling release if it isn't tagged yet), as in Release 0.4.1.

### Task 16: One start for entity pages; one signed-out screen; add/edit share transitions

The start skeleton is copied across `event.js:235-259`, `person.js:190-218` and `account.js:108-142`. There are four signed-out screens (`addView.signedOut`, `edit.js:65`, `me.js:62`, `adminImport.js:37`), and `composeSignedOut` ignores the `returnTo` it's passed. `home.js:51-57` has no error path, so a failed `/api/home` leaves a blank page. `pickMarker`, `openFix`, `applyFix` and `addPerson` are near-identical in `add.js:143-182` and `edit.js:102-133`. `state/addState.js` has no unit tests.

**Files:**
- Create `public/js/core/loadEntityPage.js` and `public/js/components/signedOut.js`
- Migrate `event`, `person`, `account` (entity) and `add`, `edit`, `me`, `adminImport` (signed out); `home.js` uses `mountLoadError`
- Move the four transitions into `public/js/state/addState.js`, and give both pages one context shape
- Tests: `test/core/loadEntityPage.test.js`, `test/state/addState.test.js`, `test/pages/home.test.js`

**Interfaces:**
- `loadEntityPage({ key: (path) => string|null, load: (key) => Promise<D>, notFoundKey, title: (data) => string, compose: (data) => SafeHtml, bind: (el, data, key) => void }) → Promise<void>`. It handles a bad key and 404 → `notFoundKey`, any other error → load-failed, `data-ready` on every outcome, and `inlineSearch.bind`.
- `signedOut.render({ titleKey, returnTo })`.
- `addState` adds `withMarker(s, marker, speaker)`, `withLineFixOpen(s, at)`, `withLineFix(s, fix)` and `withNewPerson(s, person)`.

- [ ] **Step 1: Write the failing tests.**
  - `a failed home load shows the load-failed screen and marks ready`.
  - `loadEntityPage shows the page's not-found copy on 404 and load-failed on other errors`.
  - `the signed-out screen links back to returnTo`.
  - Table tests for each `addState` transition and for `changesOf`:
    - placement switching off `event`
    - a NEW person with an empty name
    - the same fields given in a different key order are not a change; `JSON.stringify` today depends on key order, so replace it with a key-sorted comparison
- [ ] **Step 2: Implement and migrate.** Migrate one page at a time with its tests unchanged. Delete the per-page skeletons, the four signed-out composers and the copied transitions.
- [ ] **Step 3: Run and commit.** `npm test` and `npm run e2e` PASS. Commit.

---

## Phase C: this repo

### Task 17: `site/scripts/lib.sh`; deploy builds before it migrates

The three site scripts repeat one preamble (`deploy.sh:149-188`, `create-app-role.sh:159-223`, `check-app-role.sh:52-93`), and the `vercel` wrapper with its CLI pin appears twice. Steps 7–10 of `deploy.sh` print hand-written dry-run lines beside the real commands (`:331-387`), so the dry-run tests check text. Production is migrated (`:343`) before the tree check, `vercel pull` and `vercel build` (`:372-387`), and `.vercel/output` is deleted before the confirmation (`:221`). `check-app-role.sh`'s inline JS has no tests. The Taskfile puts the owner password in argv (`site/Taskfile.yml:248,391`). The name guard's `\b…\b` misses `EMIBONNIE_DB` and `emibonnieArchive`, and its latin1 reading can't match Thai (`site/test/engineNeutral.test.js:74-80`).

**Files:**
- Create `site/scripts/lib.sh` and `site/scripts/check-app-role.mjs`
- Migrate `deploy.sh`, `create-app-role.sh`, `check-app-role.sh`
- Modify `site/scripts/password.mjs` (`splitDbUrl`), `site/Taskfile.yml` (`PGPASSWORD` plus a password-free URL for `pg_dump`/`psql`), `site/test/engineNeutral.test.js`, `.gitignore` (`/links.txt`, `/import-report.csv`)

**Interfaces:**
- `lib.sh`:
  - `select_target "$@"` sets `TARGET`, `PROD`, `DRY_RUN` and `DB_VAR_NAME`.
  - `read_db_url` does the indirect read, then `unset`.
  - `step <n> <description> -- <cmd…>` prints `step n: running: …` or `step n: would run: …` and runs the command unless `DRY_RUN`.
  - `vercel` (the pinned CLI) and `log`.
- `check-app-role.mjs` exports a pure `violations(row) → string[]`.
- `splitDbUrl(url) → { url, password }`.
- Deploy order:
  1. Checks 1–6.
  2. The tree check.
  3. `vercel pull` and `vercel build`.
  4. Confirmation (`--prod`).
  5. `rm` of stale output.
  6. doctor, migrate, role check.
  7. `vercel deploy --prebuilt`.
  8. The Task 1 region line.

- [ ] **Step 1: Write the failing tests.**
  - `dry run and real run list the same steps in the same order` (scratch copy, fake binaries).
  - `a failed vercel build stops before the migration`.
  - `answering no leaves .vercel/output in place`.
  - `deployScript.test.js:242-262` must use the scratch copy, never the real checkout.
  - `violations` table tests.
  - `splitDbUrl moves the password out of the URL`.
  - `the name guard finds names inside identifiers and in UTF-8`: `EMIBONNIE_DB`, `emibonnieArchive` and a Thai term. Match terms of 5+ characters as case-insensitive substrings, and scan as UTF-8 and latin1.
- [ ] **Step 2: Implement and migrate.** Delete `REMAINING_DB_VARS` and every hand-written `would run` line.
- [ ] **Step 3: Run and commit.** `node --test site/test/` PASS, then `site/scripts/deploy.sh --dry-run` shows the new order. Commit.

### Task 18: Merge the engine release and deploy

- [ ] **Step 1: Drop the uncommitted engine copies.** The release now carries them. `git restore` the modified engine files and remove the untracked `scripts/pullProd.js`, `test/routes/authDev.test.js` and `test/scripts/pullProd.test.js`. Before deleting, check the tag has them (`git -C ../fan-archive show <tag>:scripts/pullProd.js`).
- [ ] **Step 2: Merge.** `git fetch engine --tags && git merge <tag>`, resolving `site/`-only conflicts.
- [ ] **Step 3: Verify.** `npm ci && npm run check && npm test && node --test site/test/` PASS, and CI is green.
- [ ] **Step 4: Deploy and measure.** Deploy to preview, then production. Repeat Task 1's measurements, plus an item page opened as the signed-in owner, and record before and after numbers in `site/docs/deploy.md`.
