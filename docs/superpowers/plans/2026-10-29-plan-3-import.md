# Plan 3: bulk import — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Load the owner's existing archive — a Notion CSV and a text file of tweet links — into the archive as held entries, then review, map speakers in bulk and publish them from an owner-only page, with every link that didn't make it visible and fixable.

**Architecture:** A resumable CLI (`scripts/import.js`) reads the sources, creates a job and one row per link in the existing `import_jobs`/`import_rows` tables, and ingests each link through the same `ingestItem` as `/add` with a new `holdForReview` flag, so nothing is public. An owner-only page (`/admin/imports/:id`) reviews the job: an all-rows table with filters and per-row actions, a per-translator marker table that maps speakers across the job's held entries (with per-entry overrides and optional remembering), and publish/skip/archive/retry actions. The owner can also open and edit held entries with the existing entry and edit pages, publishing from the edit page. All code goes in the engine repo `fan-archive`, then merges into `emibonnie-archive` as release 0.4.0.

**Tech Stack:** Node ≥22, `node:test`, PGlite and Postgres (Neon), `@neondatabase/serverless`, Playwright and axe, Vercel (one function, `api/index.js`).

**Spec:** `docs/superpowers/specs/2026-10-29-plan-3-import-design.md` (the Plan 3 design). Builds on `2026-10-26-plan-2-accounts-and-adding-design.md` and the 0.3.0 code.

## Global Constraints

- **The engine stays fandom-neutral.** New UI strings are copy keys (`src/site/copyDefaults.json`); tests and fixtures never name a real site's people.
- **Import never changes the translator's text.** Speaker mapping and line fixes live beside it; skip rejects a held part (`rejected = true`) rather than deleting text.
- **Owner only.** Every new route and page is `requireOwner`; a member gets `403 forbidden`, a signed-out visitor `401 signed_out`. Pages show the sign-in screen to non-owners.
- **Writes are POST-only** and pass the existing Origin check; every owner write uses the existing `owner` rate-limit bucket (300/hour).
- **Held means invisible.** Imported items stay `review_state = 'pending'`; no public surface (item page, meta HTML, search, hubs, filters, video, RSS-less APIs) may reveal them. The owner may resolve them privately (`private, no-store`); everyone else gets the same 404 as a missing item.
- **The Notion values listed in the design are mapped:** Date → `occurredOn`, Type → `categoryName`, Client/Media → `clientName`, Keyword → event match or new event, Artist(s) → `people` when they resolve to known people. `Name` is ignored. **Hashtag and Original media are kept in `import_rows.overrides` for reference only** (call recorded in the design's spirit: the tweet's own hashtags drive matching); unknown Artist names are warnings, never people and never failures.
- **Every row ends in a terminal state with a reason.** The resumable states are `queued`/`failed` (retryable) and `fetched`/`needs_speakers`/`check`/`attached` (held); `published`/`skipped` are terminal.
- **Pace:** 1000 ms between fetches by default (`--pace`), with exponential backoff on 429/5xx (1s, 2s, 4s, then the row is `failed`).
- **Limits:** rows page 50; retry batch 10 per request; jobs listed on `/me` 5.
- **Migration 005 only:** `import_skipped` in `deleted_reasons`, `attached` in `import_rows.state`, an index on `import_rows (job_id, state)`. No new tables.
- Each task runs `npm run check` and `npm test` (PGlite) green before committing. Run `TEST_DATABASE_URL=… npm test -- --test-concurrency=1` against Neon at the end of Tasks 1, 4 and 8.
- Commit as the fan identity (`car`) in `fan-archive`. Never push without the owner's go-ahead.

## Review Focus

1. **An interrupted 1,000-row import resumes cleanly.** Re-running the same job neither duplicates items nor loses rows; every row is terminal or retryable, and a Ctrl-C loses at most the row in flight. Test in Task 5.
2. **Held entries are invisible until published.** A held item is 404 on its page, absent from home/search/event/person/translator/filters/video and its meta page, while the owner can open and edit it privately. Test in Task 3.
3. **Bulk mapping changes exactly what it says.** Mapping a marker affects the job's held entries for that translator and never overwrites a per-entry answer; `remember` off leaves `speaker_memory` untouched. Test in Task 7.
4. **A follow-up link never disturbs its parent.** Publishing an `attached` row approves only the held part; skipping it rejects only that part; the parent's review state, text and visibility are unchanged. Test in Task 8.
5. **Nothing is stranded.** A failed row can be retried or skipped and the item it may have created is hidden; a skipped `check` row leaves no public item; the 2b waiting list neither shows import-held items nor hides an item whose import row was skipped. Test in Tasks 4 and 8.

---

### Task 1: Migration 005 and the import repo

**Files:**
- Create: `src/db/migrations/005_import_review.sql`
- Create: `src/repo/imports.js`
- Test: `test/db/migration005.test.js`, `test/repo/imports.test.js`

**Interfaces:**
- Migration: `insert into deleted_reasons values ('import_skipped')`; replace `import_rows_state_check` with the existing state list plus `'attached'`; `create index import_rows_job_state on import_rows (job_id, state)`.
- Produces in `src/repo/imports.js` (`Tx` = `{ query }`):
  - `createJob(tx, { source, actor }) => Promise<number>` — source is `'notion'|'paste'|'telegram'`, sets `created_by = actor`.
  - `insertRows(tx, jobId, rows) => Promise<number>` — rows `{ platform, externalId, overrides }`; `on conflict (job_id, platform, external_id) do nothing`; returns the number inserted.
  - `getJob(db, jobId) => Promise<{ id, source, status, createdAt: string, meta: any }|null>`.
  - `setJobStatus(tx, jobId, status)`.
  - `updateRow(tx, rowId, { state, itemId?, error? })` — `itemId`/`error` only when given.
  - `getRow(db, rowId) => Promise<Row|null>` where `Row = { id, jobId, platform, externalId, overrides, state, itemId, error }` (camel-cased).
  - `rowsPage(db, jobId, { state, q, offset, limit }) => Promise<{ rows: Row[], hasMore }>` — `state` filters `state`; `q` lower-case substring against `external_id`, parsed text is added in Task 4 (here only ids); newest first.
  - `countsByState(db, jobId) => Promise<Record<string, number>>` — every state present, zeros included.
  - `heldItemIds(db, jobId) => Promise<number[]>` — distinct `item_id` where state in (`fetched`,`needs_speakers`,`check`,`attached`) and not null.
  - `rowsWithItems(db, jobId) => Promise<Row[]>` — held rows that have an item (for the marker table).
  - `importHeldItemIdSet(db) => Promise<Set<number>>` — items with a row in a held state, for the 2b waiting-list exclusion.
  - `jobsRecent(db, { limit }) => Promise<{ id, source, status, createdAt, counts }[]>` — for `/me`.
  - `skipReason` and `heldStates` constants exported.

- [ ] **Step 1: Write the failing tests.**

```js
// test/db/migration005.test.js — freshDb(); seed a user; insert a job + rows
test('005 adds the import_skipped reason and the attached row state', ...);   // insert deleted_reasons + a row state 'attached' works
test('005 adds the job/state index', ...);                                  // pg_indexes contains import_rows_job_state
test('an unknown row state is still refused', ...);                         // 23514
// test/repo/imports.test.js
test('createJob + insertRows dedupe by (job, platform, external id)', ...);  // second insert adds 0
test('row states move and countsByState reports zeros too', ...);
test('rowsPage filters by state and pages by 50', ...);                      // 51 rows -> hasMore
test('heldItemIds covers held states only; importHeldItemIdSet spans jobs', ...);
test('jobsRecent lists the newest jobs with counts', ...);
```

- [ ] **Step 2: Run them.** `node --test test/db/migration005.test.js test/repo/imports.test.js` — **Expected:** FAIL (missing migration/exports).

- [ ] **Step 3: Write the migration and repo.** All mutations take the passed `tx`; never use the outer `db` inside a transaction. `insertRows` builds one multi-row insert with `jsonb` overrides (`JSON.stringify`) or loops; either is fine under 1,000 rows.

- [ ] **Step 4: Run them, then `npm test`.** **Expected:** PASS. Then the Neon run.

- [ ] **Step 5: Commit** `feat(import): migration 005 and the import repo`.

### Task 2: `holdForReview` in ingest

**Files:**
- Modify: `src/services/ingest.js` (`IngestRequest`, `attachIfFollowUp`), `src/services/ingestWrite.js` (`writeItem`)
- Test: additions in `test/services/ingest.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `IngestRequest.holdForReview?: boolean`. When true, a newly written item is `review_state = 'pending'` regardless of `settings.approvalRequired`, and an appended follow-up part gets `pending = true` regardless of the switch. The attach result carries `pending: true`.
  - `writeItem(tx, { …, holdForReview = false })` forces `pending`; otherwise the existing `reviewStateOf` rule stands.
  - `attachIfFollowUp(...)` computes `pending = request.holdForReview === true || review === 'pending'`.
  - `dryRun` ignores the flag (it writes nothing).

- [ ] **Step 1: Write the failing tests.**

```js
test('holdForReview makes a new item pending even with approval off', ...);      // reviewState pending, absent from /api/item
test('holdForReview holds a pasted follow-up part when approval is off', ...);   // part.pending true, result.pending true
test('without the flag, approval off still publishes immediately', ...);         // unchanged 2a behaviour
test('the CLI path is unchanged', ...);                                          // ingest() without the flag
```

- [ ] **Step 2: Run them.** **Expected:** FAIL.

- [ ] **Step 3: Implement.** Thread the flag from `ingestItem`'s request through `ingestNew` into `writeItem` and `attachIfFollowUp`; keep `allowUnmapped`/`lookups` untouched.

- [ ] **Step 4: Run them, then `npm test`.** **Expected:** PASS.

- [ ] **Step 5: Commit** `feat(ingest): holdForReview for import`.

### Task 3: The owner can see and edit held entries

**Files:**
- Modify: `src/services/itemView.js` (`loadVisible`, `itemView`), `src/services/itemPage.js` (resolution), `src/services/editItem.js` (`resolveEditInput`, `revertEdit`, `resolveForEdit`)
- Test: `test/routes/item.test.js`, `test/routes/edit.test.js`, `test/routes/meta.test.js`

**Interfaces:**
- Produces:
  - `itemView(deps, kind, sourceId, viewer)` resolves the item with `findItemIdBySource` when `viewer?.isOwner`, otherwise with `findVisibleItemId` as today. The returned view gains `reviewState` (owner only; omit for public).
  - `itemPage(...)` resolves the same way for an owner, so `/api/item/…` answers 200 `private, no-store` for a pending/rejected item to the owner; anonymous and member callers still 404.
  - `editItem`/`revertEdit`/`resolveForEdit`/the edit GET resolve with `findItemIdBySource` for an owner (the owner already has the edit role); non-owners unchanged.
  - **The meta page stays visible-only**: `itemMetaPage` keeps `findVisibleItemId`, so a shared link to a held entry never reveals it.
  - The public home/search/hub/filters/video paths are untouched (they use visibility rules).

- [ ] **Step 1: Write the failing tests.**

```js
test('the owner sees a held item page privately; a member and a visitor get 404', ...);
test('the owner edits a held entry; a member gets 404 and a stranger 403', ...);
test('the held item\'s meta page is still the generic site meta', ...);
test('after publishing, everyone gets the item page', ...);   // seeded, then review published
```

- [ ] **Step 2: Run them.** **Expected:** FAIL (404 for the owner).

- [ ] **Step 3: Implement.** One owner check per resolution site (`viewer?.isOwner`); never widen `findVisibleItemId` itself. Keep meta and every public list untouched.

- [ ] **Step 4: Run them, then `npm test`.** **Expected:** PASS.

- [ ] **Step 5: Commit** `feat: the owner resolves and edits held entries`.

### Task 4: The import job service (views, readiness, markers)

**Files:**
- Create: `src/services/importJob.js`
- Modify: `src/services/owner.js` (`waitingIds` excludes import-held items)
- Test: `test/services/importJob.test.js`, additions in `test/services/owner.test.js`

**Interfaces:**
- Consumes: Task 1's repo, Task 2's hold, `kind.loadDetails(db, ids, { includePending: true })`, `unmappedMarkers(parts, fixes, speakers)`, `findMarkers(splitLines(body))`.
- Produces:
  - `jobView(deps, jobId) => Promise<{ job, counts, rows, hasMore, markers } | null>` — `rows` is the first page (50) through `previewsForAny` so held items get their real previews; `markers` is `markerTable(deps, jobId)`.
  - `rowsPage(deps, jobId, { state, q, offset }) => Promise<{ rows, hasMore }>` — rows enriched with their preview and, when set, `itemId`, `event`, `addedBy`; `q` matches the parsed preview text too (filter after the repo page).
  - `markerTable(deps, jobId) => Promise<{ accountId, handle, markers: { marker, count, example, entries: { itemId, kind, sourceId, text }[] }[] }[]>` — for every translator with held rows, aggregate `unmappedMarkers` across their held items; `example` is the first line containing the marker.
  - `readinessOf(deps, kindName, itemId) => Promise<'fetched'|'needs_speakers'|'check'>` — no markers in any part and the joined text is shorter than 20 characters → `check`; markers all mapped → `fetched`; otherwise `needs_speakers`.
  - `recomputeRow(deps, rowId)` — writes the row state from `readinessOf` (never touches `published`/`skipped` rows).
  - `owner.js`'s `waitingIds` filters out `importHeldItemIdSet(deps.db)`.
- Exports `IMPORT_PAGE_SIZE = 50`.

- [ ] **Step 1: Write the failing tests.**

```js
test('a job view counts states and previews its held rows', ...);
test('rows page filters by state and searches parsed text', ...);
test('the marker table groups each translator\'s unmapped markers with a count and example', ...);
test('readiness: mapped -> fetched, unmapped -> needs_speakers, no markers + short text -> check', ...);
test('recomputeRow never disturbs published or skipped rows', ...);
test('the 2b waiting list leaves import-held items out, but keeps a skipped row\'s item', ...);
```

- [ ] **Step 2: Run them.** **Expected:** FAIL.

- [ ] **Step 3: Implement.** Seed test jobs through Task 1's repo and Task 2's ingest. Classification is kind-agnostic: loop `kindsOf(deps)` and call the kind's `loadDetails`.

- [ ] **Step 4: Run them, then `npm test`.** **Expected:** PASS, plus the Neon run.

- [ ] **Step 5: Commit** `feat(import): job views, readiness and the marker table`.

### Task 5: The import CLI

**Files:**
- Create: `scripts/import.js`, `src/services/importSources.js`
- Modify: `package.json` (`"import": "node scripts/import.js"`), `scripts/add.js` only if a helper moves
- Test: `test/services/importSources.test.js`, `test/scripts/import.test.js`

**Interfaces:**
- Produces in `src/services/importSources.js` (pure, no DB):
  - `parseNotionCsv(text) => { rows: { url, overrides: DraftOverrides, warnings: string[] }[], skipped: { row, reason }[] }` — RFC-4180 quoted fields; header names case-insensitive; maps Date/Type/Client/Keyword/Artist(s) as the design says; `Name`/`Hashtag`/`Original media` go into an `extra` field kept in `overrides` (the CLI stores the whole row there); a missing/invalid Translation link is skipped with a reason.
  - `extractStatusLinks(text) => string[]` — dedupes ids; accepts `x.com`, `twitter.com`, `www.`, `/i/status/`, `/<handle>/status/`, trailing query/fragment.
  - `resolveArtists(deps, names) => { people, warnings }` — case-insensitive display-name or IG-handle match against `listPeople`; unmatched names become warnings.
  - `eventOverrideOf(deps, keyword) => { eventId } | { newEvent: true, eventName: keyword } | {}` — an existing visible event whose name/slug/keyword matches, else a new event named by the keyword.
- Produces in `scripts/import.js`:
  - Flags: `--notion <csv>`, `--links <txt>`, `--pace <ms>` (default 1000), `--retry <jobId>`, `--dry-run`, `--kind <name>`; at least one source or `--retry`.
  - Creates a job (`source` per file; `paste` for plain text), inserts rows with Notion overrides, walks `queued`/`failed` rows, calls `ingestItem` with `holdForReview: true, allowUnmapped: true, lookups: 'create', addedVia: 'notion'|'telegram'`, `actor` = the site owner's user id (`x:<ownerXUserId>`).
  - Maps each terminal `IngestResult.status` to a row state: `added`/`pending` → `readinessOf` (`fetched`/`needs_speakers`/`check`), `attached` → `attached` with `itemId`, `duplicate`/`removed`/`opted_out` → `skipped` with the reason, `deleted`/`unavailable`/`needs_*`/fetch errors → `failed` with the reason. Writes `item_id` when present.
  - Backoff on 429/5xx; `--pace` between rows; Ctrl-C safe (row states already written).
  - Finishes by `setJobStatus('done'|'failed')`, printing counts and writing `import-<jobId>-report.csv` (url, status, reason) plus a summary of marker work.
  - `--retry <jobId>` skips creation and only walks `queued`/`failed` rows of that job.
- Requires `DATABASE_URL` (or `PGLITE_DIR` for a local run); refuses in production when a job would write to a DB it isn't told about? No: it uses the same env mechanism as `scripts/add.js`.

- [ ] **Step 1: Write the failing tests.**

```js
// importSources
test('parseNotionCsv maps the agreed columns and ignores Name', ...);
test('parseNotionCsv handles quoted commas/newlines and a missing link', ...);
test('extractStatusLinks dedupes and accepts the URL shapes', ...);
test('resolveArtists matches names and warns on strangers', ...);
test('eventOverrideOf matches an existing event, else proposes one', ...);
// scripts/import.js (PGlite + offlineFetch fixtures)
test('a notion run creates a held item per row and records states', ...);  // fetched/needs_speakers
test('a link run skips duplicates and marks a deleted tweet failed', ...);
test('an interrupted run resumes without duplicating items', ...);           // simulate by leaving rows queued
test('--retry only touches failed rows; --dry-run writes no item', ...);
```

- [ ] **Step 2: Run them.** **Expected:** FAIL.

- [ ] **Step 3: Implement.** Keep the script thin: argument parsing, source reading, the loop, reporting. Everything testable lives in `importSources.js` and the Task 4 service.

- [ ] **Step 4: Run them, then `npm test`.** **Expected:** PASS.

- [ ] **Step 5: Commit** `feat(import): the resumable import CLI`.

### Task 6: Owner API — job, rows and a dev seed

**Files:**
- Create: `src/routes/imports.js`
- Modify: `src/routes/index.js`
- Test: `test/routes/imports.test.js`

**Interfaces:**
- Produces (all `requireOwner`, `private/no-store`):
  - `GET /api/owner/imports` → `{ jobs: jobsRecent(5) }`.
  - `GET /api/owner/imports/:id` → `jobView` or 404.
  - `GET /api/owner/imports/:id/rows?state&q&offset` → `rowsPage`.
  - `POST /api/dev/import` (dev only: `DEV_SIGN_IN=1` and no `VERCEL`, like `authDev`) — body `{ urls: string[], source?: 'notion' }`; creates a job, ingests each URL with `holdForReview: true`, returns `{ jobId, rows }`. This exists so the browser tests can seed a real job without touching the DB directly; it is a 404 in production.

- [ ] **Step 1: Write the failing tests.**

```js
test('a member and a visitor are refused on every import route', ...);   // 403 / 401
test('the owner reads a job and its rows, filtered and paged', ...);
test('an unknown job is 404', ...);
test('dev seed creates a held job and is 404 without DEV_SIGN_IN', ...);
```

- [ ] **Step 2: Run them.** **Expected:** FAIL.

- [ ] **Step 3: Implement.** Route table entries; the dev route calls the same service and ingest as the CLI, with fixture URLs in tests.

- [ ] **Step 4: Run them, then `npm test`.** **Expected:** PASS.

- [ ] **Step 5: Commit** `feat(import): owner job API and dev seed`.

### Task 7: Owner API — speaker mapping

**Files:**
- Modify: `src/services/importJob.js` (`applyMapping`), `src/routes/imports.js`
- Test: `test/services/importJob.test.js`, `test/routes/imports.test.js`

**Interfaces:**
- Produces:
  - `applyMapping(deps, { jobId, accountId, marker, speaker, remember, entries }) => Promise<{ updated: number }>`:
    - Resolves the job's held rows for `accountId`; when `entries` is given, only those item ids.
    - **Batch mode** (`entries` absent): for each item whose parts use `marker` and that has **no** `translation_speakers` row for it, inserts one (`person_id` or `role`); an existing per-entry answer wins.
    - **Per-entry mode** (`entries` given): upserts that item's row for `marker`, overriding an existing answer — that is how the review page corrects one entry.
    - One transaction under the owner's actor.
    - When `remember`, merges into `speaker_memory` for `accountId` (read with `recall`, add the marker, `remember`), never replacing other markers.
    - Calls `recomputeRow` for each touched row; returns how many items changed.
  - `POST /api/owner/imports/:id/map { accountId, marker, speaker: {person}|{role}, remember?, entries? }` — validates a non-empty marker and exactly one of person/role, the `owner` limit, and returns `{ updated }`.

- [ ] **Step 1: Write the failing tests.**

```js
test('mapping fills only unmapped markers and recomputes the rows', ...);
test('a per-entry answer overrides that entry while the batch leaves it alone', ...);
test('remember off leaves speaker_memory untouched; remember on merges one marker', ...);
test('a foreign account id or a bad speaker is refused', ...);   // 400/empty update
```

- [ ] **Step 2: Run them.** **Expected:** FAIL.

- [ ] **Step 3: Implement.** Reuse `kind.loadDetails` to find the marker's occurrence; the insert is `on conflict (item_id, marker) do nothing` so a per-entry answer wins.

- [ ] **Step 4: Run them, then `npm test`.** **Expected:** PASS.

- [ ] **Step 5: Commit** `feat(import): bulk speaker mapping`.

### Task 8: Owner API — publish, skip, archive, retry

**Files:**
- Modify: `src/services/importJob.js`, `src/routes/imports.js`
- Test: `test/services/importJob.test.js`, `test/routes/imports.test.js`

**Interfaces:**
- Produces:
  - `publishRows(deps, { jobId, scope, actor }) => Promise<{ published: number }>` — `scope: 'ready'` publishes rows in `fetched`; `'all'` publishes `fetched`, `needs_speakers` and `check`. Item rows: `setReviewState published` (and purge). `attached` rows: approve the held parts through the kind's `reviewHeld` and leave the parent's own state untouched. Marks rows `published`.
  - `skipRow(deps, { jobId, rowId, actor }) => Promise<{ skipped: true }>` — a row with an item: soft-delete it with reason `import_skipped` (purge hard); an `attached` row: reject the held parts; a failed row without an item: just mark `skipped`. A `published` row is refused with 409.
  - `archiveRow(deps, { rowId, actor })` — only `check` rows: publish the item and mark the row `published`.
  - `retryRows(deps, { jobId, actor }) => Promise<{ processed: number, remaining: number }>` — up to 10 `failed`/`queued` rows, re-ingested with their stored overrides, states recomputed; `remaining` counts still-retryable rows. A deleted tweet is not retried unless the row is still `queued`.
  - Routes: `POST /api/owner/imports/:id/publish`, `POST /api/owner/imports/:id/rows/:rowId/skip`, `…/archive`, `POST /api/owner/imports/:id/retry`; all owner-only and `owner`-limited.
- Publishing uses `invalidateByTag`; removal paths (`skip` of an item) use the hard delete as in 0.3.0.

- [ ] **Step 1: Write the failing tests.**

```js
test('publish ready leaves needs_speakers and check held; publish all clears them', ...);
test('publishing an attached row approves only its held part', ...);        // parent untouched
test('skipping an attached row rejects only its held part', ...);
test('skipping an item row hides it with import_skipped and purges', ...);
test('archive publishes a check row; skipping an already published row is 409', ...);
test('retry processes at most 10 rows and reports the remainder', ...);
```

- [ ] **Step 2: Run them.** **Expected:** FAIL.

- [ ] **Step 3: Implement.** Take the item's kind from the row (`platform`/`external_id` → `findItemIdBySource`); never assume one kind.

- [ ] **Step 4: Run them, then `npm test`.** **Expected:** PASS, plus the Neon run.

- [ ] **Step 5: Commit** `feat(import): publish, skip, archive and retry`.

### Task 9: The review page — shell, table, filters and row actions

**Files:**
- Create: `src/html/adminImport.html`, `public/js/pages/adminImport.js`, `public/js/components/importRows.js`
- Create: `src/styles/components/adminImport.css`
- Modify: `src/pages.js` (`/admin/imports/:id` → `adminImport.html`), `src/site/copyDefaults.json`
- Test: `test/components/importRows.test.js`, additions in `test/site/build.test.js`

**Interfaces:**
- Produces:
  - The page route `/admin/imports/:id` (an unnamed rewrite; the page reads `:id` from `window.location.pathname`). Reserving the `/admin/` prefix also keeps it out of kind URL prefixes (derived from `src/pages.js`).
  - `importRows.render({ job, counts, rows, hasMore, filters })` + `importRows.bind(root, { state, reload })`:
    - Header: job id, sources, created date, status.
    - Count chips as filters (`all`, `fetched`, `needs_speakers`, `check`, `attached`, `failed`, `skipped`) with counts.
    - Search box (`q`) and a 50-row table: status pill, translator, clamped parsed text, event, actions.
    - Row actions: `open` (entry page), `edit` (edit page), `tweet ↗` (source URL from `platform`+`external_id`), `skip`, `archive` (check rows), `retry` (failed rows). Icon-only actions carry `title` + `aria-label`; text actions are listed in the commit message.
    - `load more` appends the next page.
  - Copy keys: `import.title`, `import.notFound`, `import.counts.*`, `import.filter.*`, `import.row.open|edit|tweet|skip|archive|retry`, `import.empty`, `import.failed`, `import.more`.
  - The page shows the sign-in screen (`components/signIn.js`) when `GET /api/me` has no owner, and `import.notFound` for a 404 job.
- Reads the job with `GET /api/owner/imports/:id` and rows with `…/rows`.

- [ ] **Step 1: Write the failing tests.**

```js
test('the header names the job and counts every state', ...);
test('a row renders its status, translator, text, event and only its legal actions', ...);
test('check rows offer skip and archive; failed rows offer retry; published rows offer open/edit', ...);
test('the filter chips and search call the rows API with the right query', ...);
test('a non-owner sees the sign-in screen; an unknown job shows notFound', ...);
test('every icon-only row action has title and aria-label', ...);
```

- [ ] **Step 2: Run them.** **Expected:** FAIL.

- [ ] **Step 3: Implement.** Keep the page under the lint limits by putting the table in the component and the fetch/state in the page. Build (`npm run build`) writes the page into `vercel.json`'s rewrites.

- [ ] **Step 4: Run them, `npm run build`, then `npm test`.** **Expected:** PASS.

- [ ] **Step 5: Commit** `feat(web): the import review page and row table`.

### Task 10: Review page — marker cards, publish and retry loop

**Files:**
- Create: `public/js/components/importSpeakers.js`
- Modify: `public/js/pages/adminImport.js`, `src/styles/components/adminImport.css`, `src/site/copyDefaults.json`
- Test: `test/components/importSpeakers.test.js`, `e2e/import.spec.js`, `playwright.add.config.js` (testMatch)

**Interfaces:**
- Produces:
  - `importSpeakers.render({ markers, people, roles, expanded, remember })` + `bind(root, { state, map, reload })`:
    - One card per translator with the handle and entry count.
    - Each marker: glyph, count, example line, a `<select>` of known people then roles, a `review N` toggle expanding the marker's entries; each entry row has its own select (per-entry override) and its text.
    - `remember for this translator` checkbox, default on.
    - Save calls `POST /api/owner/imports/:id/map` per changed marker (or one request per marker) and reloads.
    - A marker used once or twice shows the `import.marker.check` note.
  - Publish bar: `publish ready` and `publish all` call the publish route, then reload; a retry button calls `…/retry` until `remaining` is 0, showing `import.retrying` with the processed count.
  - Copy keys: `import.speakers.title`, `import.speakers.empty`, `import.marker.check`, `import.marker.review`, `import.marker.remember`, `import.marker.save`, `import.publish.ready`, `import.publish.all`, `import.retry`, `import.retrying`, `import.publish.done`.
- The page loads `/api/add/options` for people/roles (already owner-accessible).
- e2e (writable config): dev-seed a job with two fixture URLs; as owner, open the job page, see the marker card, map a marker, publish, and check the entry becomes publicly readable; axe clean on the page.

- [ ] **Step 1: Write the failing tests.**

```js
test('a marker card shows its count, example and a select of people then roles', ...);
test('review expands the marker into per-entry selects', ...);
test('saving a marker posts account, marker, speaker and remember', ...);
test('a marker used twice shows the check note', ...);
test('publish ready/all post the scope and the retry loop stops at remaining 0', ...);
// e2e/import.spec.js
test('owner maps and publishes an imported entry; axe is clean', ...);
```

- [ ] **Step 2: Run them.** **Expected:** FAIL.

- [ ] **Step 3: Implement.** Debounce nothing; mapping is a deliberate save. The retry loop is a simple `while (remaining > 0)` with a short status update.

- [ ] **Step 4: Run** `npm test`, `npm run build`, `npm run e2e`. **Expected:** PASS.

- [ ] **Step 5: Commit** `feat(web): import speaker mapping and publish bar`.

### Task 11: Held entries on the site — banner, save & publish, imports link

**Files:**
- Modify: `public/js/pages/item.js`, `public/js/pages/edit.js`, `src/site/copyDefaults.json`, `src/services/editItem.js` (edit payload gains `reviewState`) and `src/services/itemView.js` (owner payload already gains `reviewState` in Task 3), `public/js/pages/me.js`, `public/js/components/ownerSection.js` (recent imports list)
- Test: `test/pages/item.test.js`, `test/pages/edit.test.js`, `test/components/ownerSection.test.js`, e2e additions

**Interfaces:**
- Produces:
  - The item page shows an `item.held` banner (“not published · only you can see this”) when the view carries `reviewState: 'pending'`; nothing for public views.
  - The edit page shows the same banner and a `save & publish` button when the entry is held; it saves, then calls the existing review route with `state: 'published'`, then reports `edit.published` and stops showing the banner. A failed publish keeps the entry held and shows `edit.publishFailed`.
  - Copy keys: `item.held`, `edit.published`, `edit.publishFailed`, `edit.saveAndPublish`.
  - The owner section on `/me` lists the five most recent import jobs (`GET /api/owner/imports`) with link, source, counts and a link to the page; none → nothing.

- [ ] **Step 1: Write the failing tests.**

```js
test('a held item page shows the owner banner; a public page does not', ...);
test('the edit page offers save & publish only for a held entry', ...);
test('save & publish saves then publishes and the banner goes away', ...);
test('the owner me section lists recent imports, a member sees none', ...);
```

- [ ] **Step 2: Run them.** **Expected:** FAIL.

- [ ] **Step 3: Implement.** The edit GET already returns fields; add `reviewState`. Publish reuses `POST /api/owner/items/:kind/:sourceId/review`; on success, reload the edit data.

- [ ] **Step 4: Run** `npm test`, `npm run build`, `npm run e2e`. **Expected:** PASS.

- [ ] **Step 5: Commit** `feat(web): held entries, save & publish, imports on me`.

### Task 12: Docs, version and release

**Files:**
- Modify: `CHANGELOG.md` (0.4.0), `package.json` (0.4.0), `docs/start-your-own.md` (the CLI and its env), `docs/architecture.md` (import pipeline and held entries), `docs/limits.md` if a limit changed (none new; owner bucket reused)
- Test: the existing purity and doc tests

- [ ] **Step 1: Write the docs.**
  - **start-your-own:** `npm run import -- --notion export.csv --links chat.txt` (and `--retry`), what `DATABASE_URL` it needs, the notebook columns it reads, and that nothing is public until published.
  - **architecture:** the CLI → `import_jobs`/`import_rows` → held `pending` items → owner review page → publish; `holdForReview`; owner resolution of held entries; the `attached` row semantics.
  - **CHANGELOG 0.4.0 upgrade steps:** merge; `npm run migrate` (005); no new env; new copy keys (`import.*`, `item.held`, `edit.*` additions); `npm run build`; redeploy. Note that importing needs the owner's session only for the review page, not the CLI.
- [ ] **Step 2: Run** `npm run check`, `npm test`, `npm run build`, `npm run e2e`. **Expected:** all PASS, purity clean.
- [ ] **Step 3: Commit** `Release 0.4.0: bulk import` and tag `v0.4.0` locally. **Ask the owner before pushing** `fan-archive` or merging into `emibonnie-archive`.

---

## Calls made in this plan (owner to check)

- **Notion's Hashtag and Original media are reference-only** in this plan: the tweet's own hashtags drive matching; adding a hashtag override to the draft contract would ripple through event matching for a column that duplicates the tweet.
- **Artist(s) resolve to known people by display name or IG handle**, mapped into `overrides.people` with role `present`; unmatched names are warnings on the row.
- **Each Notion row's Keyword creates or matches its event** through the engine's normal event proposal, so rows sharing a keyword and date share an event.
- **The CLI runs as the owner** (`actor = x:<ownerXUserId>`), so lookups may be created and imported items show “added by” the owner.
- **The dev seed route** (`POST /api/dev/import`, `DEV_SIGN_IN` only) exists solely so browser tests can create a job without a second process on the PGlite file.
- **Retry is bounded at 10 rows per request** and never retries a deleted tweet (there is nothing to fetch).
- **Skip of an item row uses `import_skipped`**, a new deletion reason, rather than reusing `spam`.
- **Page/local naming:** `/admin/imports/:id`, `/admin/` reserved in `pages.js`, and nothing else under `/admin` this plan.
