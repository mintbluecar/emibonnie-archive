# Plan 3: bulk import — design

Date: 2026-10-29
Status: draft for owner review (agreed in conversation 2026-10-29; this document is the written form)
Builds on: `2026-10-26-plan-2-accounts-and-adding-design.md` and `2026-10-21-translation-archive-design.md`. Where they differ, this document wins for import.

## Why this exists

The archive already has a body of work outside the database: a translator's Notion database and a Telegram chat full of tweet links — hundreds to a thousand tweets. There is no import process today, and pasting them one at a time is not viable. Plan 3 loads that archive once, quickly, and leaves a usable path for a handful of links afterwards.

The owner's bar for the first load is deliberately not perfection: it may be rough, as long as **every link that did not make it is visible with a reason**, and can be fixed by hand. What must not happen is silent loss, or a thousand half-finished entries becoming public.

Operations work (health check, weekly backup, erasure, pruning) is a separate design; it is not part of this one.

## Goals

1. Load the Notion export and the chat's links in one resumable run, paced so the free tweet sources don't block it.
2. Show exactly what failed, what needs speakers, and what needs a judgement call, in the browser.
3. Map speakers in bulk per translator — one answer per marker — without requiring perfection, with per-entry overrides and optional remembering.
4. Hold imported entries out of public view until the owner publishes them, from the entry or the job page.
5. Reuse the single intake path, so an imported entry and a manually added one are identical.
6. Keep the future path simple: a few links later go through `/add`, or the same CLI.

## Non-goals

- The health check, weekly backup, erasure script, and report/audit pruning. Separate design.
- A full admin section or sidebar. One page for import review, linked from the owner's me page.
- A browser paste-many box. `/add` handles the small ongoing batches.
- A Notion API integration. CSV export only.
- Reconstructing deleted tweets: the Notion columns carry no translation text.
- Re-importing to apply later Notion edits (a later idea, not this plan).

## Anti-goals

- A second write path that diverges from `ingestItem`.
- A row that disappears without a status and a reason.
- Imported entries public before the owner publishes them.
- A bulk speaker answer overwriting the translator's curated Notion values.
- Turning a one-time load into permanent admin infrastructure nobody asked for.

## Who does what

Owner only, with Plan 2's identity rules unchanged: owner by numeric X id, sessions, `requireOwner` on every new API. Translators and readers see nothing new; imported entries look like any others once published.

## The sources

### The Notion database (CSV export)

Columns, and what the import does with each:

| Column | Use |
|---|---|
| Translation link | **The key.** The tweet is fetched and ingested from this. |
| Date | `occurredOn` override (the translator's curated date). |
| Type | Category override; created if the owner has no such category yet. |
| Client / Media | Client override; created if new. |
| Keyword | Event keyword; participates in event matching/creation. |
| Hashtag | Event/tag override and person hashtags. |
| Artist(s) | The people in the clip. Matched to known people by display name or IG handle (case-insensitive). No match → a warning on the row, never a new person and never a failure. |
| Original media | Kept in `import_rows.overrides` for reference. The engine never copies media; a deleted tweet's media is not recoverable. |
| Name | **Ignored** (owner's decision: entries have no titles). |

Unknown Type/Client values are created because the owner runs the import (`lookups: 'create'`); a member could never do this.

### The link collection (a text file)

Any block of text — a chat export, copied messages. The CLI extracts every `x.com` / `twitter.com` status link (`/status/<id>`, including `/i/status/` and `/<handle>/status/`), dedupes, and skips ids already archived or already queued. Everything else is ingested as `addedVia: 'telegram'` or `'paste'` per source.

## The run (CLI)

```
npm run import -- --notion export.csv [--links chat.txt] [--pace 1000] [--retry <jobId>] [--dry-run]
```

- Reads the sources, creates one `import_jobs` row (`source`: `notion` | `paste` | `telegram`) and one `import_rows` row per link (`platform`, `external_id`, `overrides` from Notion, `state: 'queued'`).
- Walks the rows at `--pace` ms (default 1000, with jitter), through the same `ingestItem` as `/add`, signed in as the owner, with:
  - `addedVia: 'notion' | 'paste' | 'telegram'`
  - Notion values as `overrides`
  - `allowUnmapped: true` (speakers may be fixed in bulk later)
  - `lookups: 'create'`
  - **`holdForReview: true`** — a new ingest flag that forces `review_state = 'pending'` regardless of the approval switch, so nothing is public before publishing.
- Resumable: `import_rows` is unique on `(job_id, platform, external_id)`. Re-running with `--retry <jobId>` retries only `queued`/`failed` rows; Ctrl-C at any point loses at most the row in flight.
- Ends with a printed summary and `import-<jobId>-report.csv` listing every row that is not `published`, with its URL, status and reason.
- Writes to whatever `DATABASE_URL` the site's env points at. No Vercel call, no GitHub Actions, no 5-minute cap.

### Row states

The schema already defines them; the mapping is:

| State | Meaning |
|---|---|
| `queued` | Not attempted yet. |
| `fetched` | Item created and held; every marker has a speaker → ready to publish. |
| `needs_speakers` | Item created and held; at least one marker unmapped. |
| `check` | Held item that doesn't look like a translation (no markers and little text, or an event link). Non-blocking; the owner decides. |
| `published` | Live. |
| `skipped` | Nothing archived, with the reason in `error`: duplicate / already archived / opted out / removed at source / deliberately skipped by the owner. |
| `failed` | The job could not finish the row, with the reason in `error`: fetch error, rate limit after retries, database error, deleted tweet with nothing to recover. |

`fetched`, `needs_speakers` and `check` all mean "item exists, held". The distinction is for the owner's lists, not for visibility.

## Holding and publishing

- **Held = `review_state = 'pending'`.** Existing visibility rules already hide pending items from every public surface.
- **The owner can open and edit held entries.** Today `/t/…` and `/edit/…` resolve only visible items, so even the owner gets a 404 while an entry is held. Plan 3 changes item and edit resolution so an owner resolves any archived state (`findItemIdBySource` instead of `findVisibleItemId`); response stays `private, no-store`, and non-owners still get 404.
- **Publishing** is the existing owner review action (`POST /api/owner/items/:kind/:sourceId/review { state: 'published' }`), or the job-level bulk publish. The entry's edit page gets **save & publish**, which saves the changes and then publishes; a failed publish leaves it held with a message.
- **The 2b waiting list excludes import-held items** (any item with an `import_rows` row), so its 50-row window is not consumed by an import. The import job page is where those are reviewed.

## The review page

`/admin/imports/:id`, owner only (a non-owner sees the sign-in screen). Linked from the owner section of `/me` (the most recent jobs). New APIs, all `requireOwner`:

- `GET /api/owner/imports/:id` — job summary, counts by state, the translator marker table, and the first page of rows.
- `GET /api/owner/imports/:id/rows?state&q&offset` — rows page (50), filterable by state, translator, event, or free text against the parsed text.
- `POST /api/owner/imports/:id/map` — `{ translatorAccountId, marker, speaker, remember, entries? }`; applies to every held entry of that translator in this job (`entries` narrows it to specific item ids).
- `POST /api/owner/imports/:id/publish` — `{ scope: 'ready' | 'all' }`.
- `POST /api/owner/imports/:id/rows/:rowId/skip` and `…/archive` — the two decisions for `check` rows (and skip for a failed row).
- `POST /api/owner/imports/:id/retry` — processes up to 10 retryable failed rows per call and returns how many remain; the page calls it until zero, showing progress.

Page contents, top to bottom:

1. **Header** — job id, sources, when it ran, and counts (all / ready / needs speakers / check / failed / skipped) as filters over one table.
2. **All rows** — a table with status, translator, parsed text (clamped), event, and per-row actions: `open` (the entry page), `edit` (the edit page), `tweet ↗`, `skip`, `archive anyway`, `retry` as applicable. Search box and translator/event filters. This is the spot-check surface for "one of these is wrong".
3. **Needs speakers** — one card per translator: each marker with its count and one example line, a dropdown, and `review N` to expand the marker into its entries, each with its own dropdown. A marker used once or twice is labelled "used N times — check these". Saving applies the marker answer to the job's held entries for that translator, and `remember for this translator` (default on, untickable) upserts `speaker_memory` so future imports pre-fill.
4. **Publish bar** — `publish ready` (all `fetched` rows of the job) and `publish all` (everything held from this job).

The same page in the engine's copy-key style; the mockups shown during the conversation are the visual reference.

## Failure and decision taxonomy

| Situation | State | What the owner can do |
|---|---|---|
| Duplicate / already archived | `skipped` | Nothing; link to the existing entry. |
| Translator opted out / item removed | `skipped` | Nothing. |
| Fetch error, rate limit after retries, DB error | `failed` | `retry` (server batch) or `skip`. |
| Tweet deleted | `failed` ("deleted — nothing to recover") | Open on X (if still viewable), or skip. The Notion export has no text column, so the text is lost. |
| No markers and little text, or an event link | `check` | `open` / `edit`, `skip`, or `archive anyway`. |
| Everything else | `fetched` or `needs_speakers` | Map in bulk, or open and fix individually. |

`skip` for a row whose item already exists soft-deletes it with the new `import_skipped` reason; it leaves every public surface (it was never public) and stays in the job record. Rows without an item simply move to `skipped`.

## Mapping semantics

- The engine stores speakers per item (`translation_speakers`) and remembers answers per translator+marker (`speaker_memory`).
- A marker answer from the import page fills that marker for every held item of that translator in the job, **only where the marker is currently unmapped** (it never overwrites an existing per-entry answer), and optionally upserts the memory.
- A per-entry answer changes that item only. Unticking `remember` means the answer applies to the job's entries and never reaches memory — the tool for an inconsistent marker.
- After a mapping, readiness is recomputed: an item with every marker mapped moves to `fetched`; anything still unmapped stays `needs_speakers`.
- The engine cannot detect an inconsistent marker; the page shows the evidence (count, examples, per-entry expansion) and the owner decides.

## Data model

- `import_jobs` and `import_rows` already exist (001). `import_rows.error` carries the reason; `import_rows.overrides` carries the Notion row.
- Migration 005: add `import_skipped` to `deleted_reasons`, and an index on `import_rows (job_id, state)`.
- No new tables.

## Constraints and rules

- The engine stays fandom-neutral; every new string is a copy key.
- Layers hold: routes → services → repos → domain; routes never import repos; the Kind contract stays the only kind-aware seam.
- Writes are POST-only, Origin-checked, owner-only, and audited. No request headers or query strings in logs.
- Imported items are credited to the tweet's author (as every translation is) and "added by" the owner (the import's actor), with `added_via` naming the source.
- The translator's text is never changed by import; speaker mapping and line fixes live beside it.

## Calls made while writing this (owner to check)

- **Fetching is a CLI**, reviewing is the browser. The owner asked how mapping would happen without a UI; the answer settled on this split.
- **Imports are held with a new `holdForReview` ingest flag**, not by flipping the site-wide approval switch.
- **The owner can resolve unpublished entries** on `/t/…` and `/edit/…` (private, no-store); everyone else still gets 404. This also makes the 2b waiting list's cards openable.
- **Import-held items are excluded from the 2b waiting list**, which belongs to the import page.
- **Retry runs in server batches of 10** from the page, not only from the CLI.
- **Mapping fills only unmapped markers**; per-entry overrides never touch memory unless `remember` is ticked.
- **Publishing is possible from both the entry page and the job page.**
- **Deleted tweets are reported, not reconstructed** — the Notion columns have no text.
- **Unmatched Artist(s) names are warnings**, not failures, and never create people.
- **One migration** (the skip reason and an index); no new tables.
- **No admin sidebar**; the import page is linked from the owner's me section.
- **Skipping a `check` row's existing item** uses a new `import_skipped` deletion reason rather than pretending it was spam.

## Left to the builder

- Exact CLI flag spellings, the `--links` input form (file, stdin, or both), and the report's column layout.
- Page pagination size and the exact query-parameter names.
- Whether the me page lists every import job or only the last few.
- Retry batch size if 10 proves wrong under Vercel's limits.
- How the marker example line is chosen (first entry, longest, or middle).

## Later

- Health check, backup, erasure, pruning (the operations design).
- Paste-many in the browser, if the `/add` path ever feels slow.
- A Notion API sync or re-import that reconciles later edits.
- Bulk event creation/reordering from an import's keywords.
