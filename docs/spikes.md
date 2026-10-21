# Spikes

Plan 1a, Task 2: proving the riskiest assumptions before building on them. No
tweet text appears below; sample data is either a fixed, invented Thai
sentence or a static "spike" placeholder page.

Dates below are 2026-10-21. Node v26.10.0, Vercel CLI 65.0.0 for the deploy
spike.

## Step 1: Video

Script: `scripts/spikes/video.mjs <syn.json path>`. Picks the smallest mp4
variant (by bitrate) out of a real example tweet fixture's
`mediaDetails[].video_info.variants`, then range-requests it from
`video.twimg.com`.

Fixture used: `../my-archive/test/fixtures/tweets/1900000000000000001.syn.json`
(read-only; its text was never copied). Smallest mp4 variant: bitrate 632000.

Two requests were made, both with `Range: bytes=0-1023`:

| Referer sent | Result |
| --- | --- |
| `https://example.com/` (the task ruling's literal evidence request) | **403**, `content-type: text/plain`, body `Unauthorized.` -- no ftyp box |
| none (no `Referer` header at all) | **206**, `content-type: video/mp4`, `content-range: bytes 0-1023/3433546`, first bytes contain an mp4 `ftyp` box |

**Finding, flagged prominently:** the literal evidence request in the task
ruling (`Referer: https://example.com/`) does **not** play -- `video.twimg.com`
rejects a present-but-untrusted `Referer` with 403. However, that is not what
a real `<video referrerpolicy="no-referrer">` embed sends: per the HTML
Standard, the `no-referrer` policy means the browser omits the `Referer`
header entirely, not that it sends a placeholder value. Requesting with no
`Referer` header at all -- the actual real-world condition -- succeeds (206,
correct content-type, valid `ftyp` box). `video.twimg.com`'s hotlink
protection appears to allow an absent `Referer` (and a `twitter.com`-origin
one, also checked manually) but reject other non-empty origins.

Conclusion: the planned `<video controls playsinline referrerpolicy="no-referrer">`
embed is expected to work, based on the no-Referer probe, but this spike's
evidence for the literal ruling is a 403, not a 200/206. The owner should
confirm this reading before Plan 1b, Task 5 relies on it; if the owner reads
this differently, the X-embed fallback changes that task. Real-browser
playback is unverified here (no browser was available) and is deferred to
Playwright, per the ruling.

`public/spike-video.html` (a `<video controls playsinline referrerpolicy="no-referrer">`
pointed at the same mp4 URL) was written, served successfully by
`npm run dev` (`200`, correct body), then deleted, as directed.

## Step 2: Thai trigrams and PGlite/Neon parity

Script: `scripts/spikes/db.mjs`. Runs five probes against an in-memory
PGlite instance (with the `pg_trgm` contrib extension) and, when
`DATABASE_URL` is set, against the same probes on Neon (Postgres 17.11, the
dev project's pooled `-pooler` endpoint in `ap-southeast-1`/AWS Singapore,
region confirmed via the connection string's host; host and credentials are
not reproduced here).

| Probe | PGlite | Neon (pooled) |
| --- | --- | --- |
| `show_trgm('ครบถ้วน')` | non-empty array of 8 hex-form trigrams, e.g. `["0x87a28b", ...]` | identical hex-form array |
| `gin_trgm_ops` GIN index, 5,000 rows, `explain ... ilike '%ครบ%'` | **Bitmap Heap Scan** over **Bitmap Index Scan** | identical plan shape |
| `1::bigint` round-trip | JS **number** (`1`) | JS **string** (`"1"`) |
| `'2026-02-12'::date` round-trip (no date parser registered) | JS `Date` object, `2026-02-12T00:00:00.000Z` | JS `Date` object, `2026-02-11T16:00:00.000Z` (the local-midnight-to-UTC conversion depends on the Node process's timezone) |
| `set_config('app.actor','x',true)` in a transaction, same session | inside tx: `"x"`; after commit: `""` | identical, using a single `pool.connect()`-checked-out client for the whole probe |

**Thai trigrams: not a fallback case.** `show_trgm` renders Thai trigrams in
hex form rather than readable substrings on both engines, because both run
under a `C`/`C.UTF-8` ctype (confirmed on Neon via
`select datcollate, datctype from pg_database`), and `pg_trgm` classifies
word characters using the locale's `ctype`; in `C` locale, only ASCII
letters/digits count as word characters, so non-ASCII text's trigrams print
as hex (a known, documented pg_trgm behaviour -- see PostgreSQL bug report
[#15476](https://www.postgresql.org/message-id/15476-4314f480acf0f114%40postgresql.org)
and the `pg_trgm` docs on locale-dependent word-character classification).
This is cosmetic: it affects only `show_trgm`'s human-readable display. The
GIN index itself works correctly for Thai substring search on both engines,
confirmed by the identical Bitmap Index Scan plan above. `show_trgm`
returning a non-empty array (the ruling's acceptance test) passed on both
engines. No `pg_trgm`-independent fallback is needed.

**Parity gaps found, relevant to Task 7 (which registers type parsers):**
- `int8`/`bigint` round-trips as a **string** on Neon's driver but a
  **number** on PGlite. Code must not assume a JS type for bigint columns
  without an explicit, consistent parser on both engines (Neon's
  string-by-default is the safer one for values beyond
  `Number.MAX_SAFE_INTEGER`).
- `date` round-trips as a `Date` object on both engines, but at different
  instants: PGlite treats it as UTC midnight; Neon's driver (node-postgres
  style parsing) constructs it from **local midnight in the Node process's
  timezone**, so the exact instant depends on `TZ`. This is exactly why
  Task 7 needs to register its own date parser rather than relying on either
  engine's default.

**Pooling note:** the probe deliberately checks out a single client with
`pool.connect()` and keeps it for the whole `BEGIN` / `set_config` / `COMMIT`
/ `SELECT current_setting` sequence. On a pooled (`-pooler`) endpoint,
separate `pool.query()` calls can be served by different backend
connections, which would make a transaction-scoped `set_config(..., true)`
invisible to a later call even inside the "same" logical operation. Any code
relying on `app.actor` being visible across statements in one transaction
must use one checked-out client for that transaction, not independent pool
queries.

## Step 3: Deploy hello-world (manual CLI)

In a temp folder outside the repo: `public/index.html` containing "spike",
`vercel.json` with `{"regions":["sin1"]}`. `vercel link --yes --project
fan-archive-spike` then `vercel deploy --yes` (no `--prod` flag passed).

- Project was created under the already-logged-in fan Vercel account's only
  team (confirmed via `vercel whoami` = the fan handle). The team's slug is
  not the fan org name; noted here for the owner's awareness, not acted on,
  since no account, email, or GitHub linkage was touched.
- Because this was the project's first-ever deployment, Vercel's CLI
  assigned it `"target": "production"` by default (its own behaviour for a
  brand-new project, not something `--prod` caused). The project was
  single-use and fully removed afterward, so this had no lasting effect, but
  is recorded since the ruling said not to use `--prod`.
- `curl https://fan-archive-spike.vercel.app` returned **200**, body
  `spike`, and `x-vercel-id: sin1::...` -- region confirmed as `sin1`
  (Singapore). The deployment API reported `deploymentProtection:
  ["vercel_authentication"]`, but the plain request was not actually
  challenged (no 401 seen); protection settings were not changed.
- Cleanup: `vercel remove fan-archive-spike --yes` succeeded. No `.vercel/`
  directory was created inside this repo (the spike ran entirely in a temp
  folder outside it).

## Summary

| Spike | Outcome |
| --- | --- |
| Video range request | Literal ruling test (`Referer: https://example.com/`) failed (403); the real `no-referrer` condition (no header) succeeded (206, valid mp4). Flagged for the owner; see Step 1. |
| Thai trigrams | Work on both engines (GIN index scan confirmed); `show_trgm`'s human-readable form is hex, a known, cosmetic `pg_trgm`/locale quirk. No fallback needed. |
| PGlite/Neon parity | Index behaviour matches; `bigint` and `date` round-trip differently between engines -- Task 7 must register explicit parsers. |
| Deploy path | Manual CLI preview (effectively first-deploy "production") in `sin1` confirmed working and was fully torn down. |
