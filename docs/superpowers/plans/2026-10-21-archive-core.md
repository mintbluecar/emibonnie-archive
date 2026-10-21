# Archive Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deployed, read-only emibonnie archive: the database, tweet fetching and parsing, an owner command to add tweets, and every public reading page (home, event, translation, search, person, translator) in the approved visual design.

**Architecture:** Plain HTML/CSS/ES-module JS pages in `public/`, which fetch JSON from Vercel serverless functions in `api/`. Pure logic (tweet fetching, header and speaker parsing, event matching, rendering) lives in small modules under `src/` and `public/js/`, all tested with `node --test`. Postgres (Neon in production, PGlite in tests) holds everything. A local dev server mimics Vercel's routing, so development needs no Vercel login.

**Tech Stack:** Node 22+ (local is 26), `node --test`, `@neondatabase/serverless`, `@electric-sql/pglite` (tests and local dev), Vercel Hobby, GitHub Actions, Nunito + IBM Plex Sans Thai (Google Fonts).

**Spec:** `docs/superpowers/specs/2026-10-21-translation-archive-design.md`. Mockups are in `docs/superpowers/specs/mockups/`. Read both. The spec's text wins over a mockup.

**Later plans (not this one):** sign-in and the add flow (Plan 2); the admin screens, bulk import and GitHub Actions jobs (Plan 3). This plan leaves room for them: `entries.added_by` is text, the speaker map is the same JSON the add flow will write, and `ingestTweet` is the single intake function both will call.

## Global Constraints

- Commit as `car <bluerotcar@gmail.com>`. The repo's `origin` is `git@github.com:mintbluecar/emibonnie-archive.git`, which sets this identity automatically. Check with `git config user.email` before the first commit. **Never push** unless the owner says so in that moment.
- No real name, no personal GitHub account, and no `/Users/...` paths in any committed file.
- Secrets (`DATABASE_URL`, Vercel token) live only in env vars and GitHub/Vercel secrets. Never commit them. `.env*` is already gitignored.
- Translator text is stored and shown **verbatim**. Never rewrite, trim inside, or re-case it. Formatting is a view on top of it.
- Person display names are **lowercase** everywhere: "emi", "bonnie", "leo".
- Fixed people: emi `@emiamily` 🧡 `#ff8a3d`; bonnie `@beonnnie` 💜 `#9b6cff`. People are keyed by IG handle, stored lowercase without `@`.
- Generic roles: `host`, `fan`, `speaker`, `crowd`. They have no person page and keep the translator's own emoji.
- Known people are always shown with their **standard emoji**, never the translator's.
- Design tokens: bg `#f6efe3`, card `#fffdf8`, line `#eadfce`, ink `#2b2233`, muted `#8a7f8f`, brand gradient `#ff6a2b → #e03a85`, emi `#ff8a3d`, bonnie `#9b6cff`. Fonts: Nunito, IBM Plex Sans Thai.
- Header: logo + "emibonnie archive" ("emibonnie" in the brand gradient) + tagline "fan translations, kept" + **FAN-MADE** badge.
- Phone tab bar: home · search · ＋ add · me. In this plan, "＋ add" and "me" link to a "coming soon" page.
- Entries have **no titles**. Lists show the opening lines of the translation as a preview.
- "clip by @…" is always shown.
- Removed or opted-out content must not appear in any public API response.
- Tweet sources: syndication `https://cdn.syndication.twimg.com/tweet-result?id={id}&lang=en&token={token}`, with token `((Number(id)/1e15)*Math.PI).toString(36).replace(/(0+|\.)/g,'')`; FxTwitter `https://api.fxtwitter.com/2/status/{id}`.
- Event live-matching window: same person + same platform + date within **±1 day**.

## Review Focus

1. **Tweet text containing HTML** (`<`, `&`, `"`) must render as text, never as markup. All rendering goes through `esc()`. Tested in Task 10.
2. **Searching Thai**, e.g. `ครบ`, which has no word boundaries, must find "…ครบ (krob)…". Tested in Task 8.
3. **Lines with an empty marker**, e.g. `: Bonnie, mommy has sth to tell you` from @danaNYB, must render as a plain line, not be dropped or crash. Tested in Task 4.
4. **Keyword variations:** "EMIBONNIE AT EFM " vs "emibonnie at efm" must match the same event, and an ignored hashtag (#EmiBonnie) alone must never create a match. Tested in Task 6.
5. **Deleted tweets:** syndication returns `TweetTombstone`. The entry keeps its text, the page shows the "no longer available" note, and `/api/video` returns 404 rather than throwing. Tested in Tasks 2 and 9.

---

## File structure

```
package.json                     scripts: test, dev, migrate, add
vercel.json                      rewrites for pretty URLs
.github/workflows/deploy.yml     deploy to Vercel on push to main; preview on PR
db/schema.sql                    tables, indexes, seed rows
src/db.js                        getDb() → {query(sql, params)}; Neon or PGlite
src/migrate.js                   applies db/schema.sql
src/tweets/url.js                tweet URL/ID parsing
src/tweets/fetch.js              fetch + normalise from both sources
src/parse/header.js              keyword, hashtags, person tags, live detection
src/parse/speakers.js            line splitting, marker discovery
src/events.js                    event matching
src/store.js                     reads/writes for entries, events, people, translators
src/search.js                    search query builder
src/ingest.js                    ingestTweet(): the one intake function
scripts/add.js                   owner CLI: add a tweet with a speaker map
scripts/dev.js                   local server: public/ + api/ + vercel.json rewrites
scripts/video-check.mjs          one-off spike: do X video URLs play off-site?
api/home.js api/event.js api/entry.js api/search.js api/person.js api/translator.js api/video.js
public/index.html event.html entry.html search.html person.html translator.html soon.html
public/css/site.css              tokens + components
public/img/logo.png              from docs/superpowers/specs/mockups/logo.png
public/js/esc.js                 HTML escaping
public/js/render.js              pure render functions (bubbles, cards, previews)
public/js/layout.js              header + tab bar
public/js/pages/*.js             one module per page
test/**/*.test.js                node --test
test/fixtures/tweets/*.json      already saved: 6 real tweets × {syn,fx}
```

---

### Task 1: Scaffold, dev server, and the video spike

**Files:**
- Create: `package.json`, `vercel.json`, `scripts/dev.js`, `scripts/video-check.mjs`, `public/soon.html`, `public/img/logo.png` (copy), `test/dev.test.js`
- Create: `docs/video-check.md` (the result)

**Interfaces:**
- Produces: `npm test` runs `node --test test/`. `npm run dev` serves on `http://127.0.0.1:3000`. `scripts/dev.js` exports `createServer({ root, apiDir, rewrites }) → http.Server`. Each API module default-exports `async function handler(req, res)`, using the Vercel Node signature (`req.query`, `res.status(n).json(obj)`).

- [ ] **Step 1: `package.json`** — `"type":"module"`, `"private":true`, `"engines":{"node":">=22"}`, scripts `test`, `dev` (`node scripts/dev.js`), `migrate` (`node src/migrate.js`), `add` (`node scripts/add.js`). Dependencies: `@neondatabase/serverless`. Dev dependency: `@electric-sql/pglite`. Run `npm install`.

- [ ] **Step 2: `vercel.json` rewrites** — `/e/:slug → /event.html`, `/t/:id → /entry.html`, `/p/:ig → /person.html`, `/tl/:handle → /translator.html`, `/search → /search.html`, `/add → /soon.html`, `/me → /soon.html`.

- [ ] **Step 3: Write the failing test** `test/dev.test.js`

```js
test('dev server applies vercel rewrites and routes /api', async () => {
  const srv = createServer({ root: 'test/fixtures/site', apiDir: 'test/fixtures/api',
    rewrites: [{ source: '/e/:slug', destination: '/event.html' }] });
  // fixtures: site/event.html contains "EVENT PAGE"; api/ping.js returns res.status(200).json({ ok: req.query.x })
  await listen(srv);
  assert.match(await (await fetch(url('/e/anything'))).text(), /EVENT PAGE/);
  assert.deepEqual(await (await fetch(url('/api/ping?x=1'))).json(), { ok: '1' });
  assert.equal((await fetch(url('/nope.html'))).status, 404);
});
```

- [ ] **Step 4: Run it, expect a FAIL** (`createServer` is not defined). Run: `npm test`.

- [ ] **Step 5: Implement `scripts/dev.js`** with `node:http`, so there's no framework. Rewrites are matched by converting `:param` to a regex segment. `/api/<name>` dynamically imports `<apiDir>/<name>.js`, and the module is re-imported on each request with a cache-busting query. The server adds `res.status()` and `res.json()` helpers. When run directly, it uses `root: 'public'`, `apiDir: 'api'`, and rewrites from `vercel.json`, and binds to `127.0.0.1:3000`.

- [ ] **Step 6: Run `npm test`, expect PASS.**

- [ ] **Step 7: Video spike.** `scripts/video-check.mjs` reads `test/fixtures/tweets/2030321729902641632.syn.json`, picks the smallest `video/mp4` variant, and requests it with `Referer: https://example.com/` and `Range: bytes=0-1023`. It prints the status, content-type, and any `access-control-allow-origin` header. It also writes `public/video-check.html`, which has a `<video controls src=…>` for that URL. Run `node scripts/video-check.mjs`, then `npm run dev`, and open `http://127.0.0.1:3000/video-check.html` in a browser.
  - **Expected:** a 200 or 206 response, and the video plays in the page.
  - **Record the result** in `docs/video-check.md`: status, whether it played, and the date. If it **doesn't** play, stop and tell the owner. The spec's fallback (X's tweet embed, not pinned on phone) changes Task 11.
  - Delete `public/video-check.html` afterwards. Don't commit it.

- [ ] **Step 8: Commit** — `git add -A && git commit -m "Scaffold project, dev server, and video playback check"`

---

### Task 2: Tweet URLs and fetching

**Files:**
- Create: `src/tweets/url.js`, `src/tweets/fetch.js`, `test/tweets.test.js`, `test/fixtures/tweets/tombstone.syn.json`

**Interfaces:**
- Produces:
  - `parseTweetId(input: string) → string|null`. Accepts `x.com`/`twitter.com`/`mobile.twitter.com` status URLs (with `?s=`, `/video/1`, trailing slash) and bare numeric IDs.
  - `extractTweetIds(text: string) → string[]`. Unique, in order of first appearance.
  - `synToken(id: string) → string`.
  - `fetchTweet(id, { fetchImpl = fetch } = {}) → Promise<NormalizedTweet>`.
  - `normalize(syn: object|null, fx: object|null) → NormalizedTweet`. This is pure, so tests use it directly.

```js
// NormalizedTweet
{ id, status: 'live'|'deleted'|'unavailable',
  authorId, authorHandle, authorName,      // strings; null if unavailable
  createdAt,                                // ISO string
  text,                                     // full verbatim text, t.co media link removed (see below)
  textSource: 'syndication'|'fx',
  video: { variants: [{ url, bitrate, contentType }], durationMs } | null,
  clipSource: { handle, url } | null,       // from mediaDetails[0].expanded_url
  quotedId: string|null, replyToId: string|null }
```

- [ ] **Step 1: Write the failing tests** in `test/tweets.test.js`. Load fixtures with `JSON.parse(readFileSync(...))`.

```js
test('parseTweetId', () => {
  assert.equal(parseTweetId('https://x.com/vacantvolcanic/status/2021992269596045801'), '2021992269596045801');
  assert.equal(parseTweetId('https://twitter.com/a/status/123?s=20'), '123');
  assert.equal(parseTweetId('https://x.com/phannii_p/status/2108523935654670719/video/1'), '2108523935654670719');
  assert.equal(parseTweetId('2108532547101856124'), '2108532547101856124');
  assert.equal(parseTweetId('https://x.com/vacantvolcanic'), null);
});
test('extractTweetIds from chat text, deduped', () => {
  const chat = '[12/02] me: https://x.com/a/status/1\ntiktok live!!\nhttps://x.com/b/status/2 and again https://twitter.com/a/status/1';
  assert.deepEqual(extractTweetIds(chat), ['1', '2']);
});
test('long post: text comes from fx, not truncated syndication', () => {
  const t = normalize(syn('2110438810274414709'), fx('2110438810274414709'));
  assert.equal(t.textSource, 'fx');
  assert.equal(t.text.length >= 2400, true);
  assert.match(t.text, /We hug all the time\./);
  assert.equal(t.quotedId, '2110432579635831075');
  assert.equal(t.authorHandle, 'vacantvolcanic');
});
test('clip source from another account', () => {
  const t = normalize(syn('2108532547101856124'), fx('2108532547101856124'));
  assert.deepEqual(t.clipSource, { handle: 'phannii_p', url: 'https://x.com/phannii_p/status/2108523935654670719/video/1' });
  assert.ok(t.video.variants.every(v => v.contentType === 'video/mp4'));
});
test('short post uses syndication text', () => {
  assert.equal(normalize(syn('2021992269596045801'), fx('2021992269596045801')).textSource, 'syndication');
});
test('tombstone → deleted', () => {
  const t = normalize(JSON.parse(readFileSync('test/fixtures/tweets/tombstone.syn.json')), null);
  assert.equal(t.status, 'deleted');
});
test('both sources missing → unavailable', () => {
  assert.equal(normalize(null, null).status, 'unavailable');
});
test('fetchTweet falls back when fx fails', async () => {
  const fetchImpl = async (u) => u.includes('syndication')
    ? { ok: true, status: 200, json: async () => syn('2021992269596045801') }
    : { ok: false, status: 503, json: async () => ({}) };
  assert.equal((await fetchTweet('2021992269596045801', { fetchImpl })).status, 'live');
});
```

  `tombstone.syn.json` is `{"__typename":"TweetTombstone","tombstone":{"text":{"text":"This Post was deleted by the Post author."}}}`.

- [ ] **Step 2: Run `npm test`, expect a FAIL.**

- [ ] **Step 3: Implement the module.**
  - **Text rule:** use fx `status.text` when syndication has `note_tweet` (a long post) or when syndication is missing. Otherwise use syndication `text`.
  - **Media link:** remove the trailing `https://t.co/…` that points at the attached media. It's the URL in syndication `entities.media[].url`, if present. Remove nothing else.
  - **Video variants:** syndication `mediaDetails[0].video_info.variants`, keeping only `video/mp4`, sorted by bitrate ascending.
  - **Ordering:** run both fetches in parallel, each with a 5 s timeout via `AbortSignal.timeout(5000)`. Any non-OK response or thrown error counts as `null` for that source.

- [ ] **Step 4: Run `npm test`, expect PASS.**
- [ ] **Step 5: Commit** — `git commit -am "Tweet URL parsing and two-source fetch"` (also `git add` the new files).

---

### Task 3: Header parsing

**Files:**
- Create: `src/parse/header.js`, `test/header.test.js`

**Interfaces:**
- Produces: `parseHeader(text: string, { ignoredHashtags: string[], personHandles: string[] }) → Header`

```js
// Header
{ keyword: string|null,            // first non-empty line that is mostly uppercase letters, trimmed; null if none
  hashtags: string[],               // all #tags, original case, excluding ignored (case-insensitive) and person handles
  personTags: string[],             // lowercase handles found as #handle matching personHandles
  unknownHandleTags: string[],      // #tags that look like an IG handle (lowercase, [a-z0-9._]{3,30}) and aren't known people or ignored
  live: { platform: 'tiktok live'|'ig live'|'x space'|'youtube live', date: 'YYYY-MM-DD'|null } | null,
  context: string|null }            // a leading "[...]" line, e.g. [After "Number One Girl"...]
```

- [ ] **Step 1: Write the failing tests**

```js
const opts = { ignoredHashtags: ['emibonnie', 'namtanfilm'], personHandles: ['beonnnie', 'emiamily'] };
test('event keyword + hashtag', () => {
  const h = parseHeader(fxText('2108532547101856124'), opts);
  assert.equal(h.keyword, 'EMIBONNIE ANY HAPPY FAMILY');
  assert.deepEqual(h.hashtags, ['#GMMTVFANIVAL2026HappyFamilyxEB']);
});
test('ignored hashtag is dropped', () => {
  assert.deepEqual(parseHeader(fxText('2108748780564816034'), opts).hashtags, ['#GMMTVFANIVAL2026HappyFamilyxEB']);
});
test('live: person tag + platform + [YYMMDD]', () => {
  const h = parseHeader(fxText('2021992269596045801'), opts);
  assert.deepEqual(h.personTags, ['beonnnie']);
  assert.deepEqual(h.live, { platform: 'tiktok live', date: '2026-02-12' });
  assert.equal(h.keyword, null);
});
test('live date formats', () => {
  assert.equal(parseHeader('bonnie tiktok live 12/2', { ...opts, postedAt: '2026-02-13T01:00:00Z' }).live.date, '2026-02-12');
  assert.equal(parseHeader('#beonnnie IG live [261009]', opts).live.platform, 'ig live');
});
test('shared story signals', () => {
  const h = parseHeader(fxText('2003413749940834557'), opts);
  assert.equal(h.keyword, null);
  assert.equal(h.live, null);
  assert.deepEqual(h.unknownHandleTags, ['michirujjang']);
});
test('context line', () => {
  assert.match(parseHeader(fxText('2030321729902641632'), opts).context, /^\[After "Number One Girl"/);
});
```

  `fxText(id)` reads `test/fixtures/tweets/<id>.fx.json` → `.status.text`. `options.postedAt` (ISO string, optional) gives the year for `d/m` dates. If it's missing, the current year is used.

- [ ] **Step 2: Run `npm test`, expect a FAIL.**
- [ ] **Step 3: Implement.** Only lines before the first speaker line count as the header (see Task 4's marker rule). "Mostly uppercase" means at least 70% of the letters are uppercase and there are at least 2 words. `d/m` dates are day/month.
- [ ] **Step 4: Run `npm test`, expect PASS.**
- [ ] **Step 5: Commit** — `git commit -m "Parse tweet headers: keyword, hashtags, person tags, lives"`

---

### Task 4: Speaker lines

**Files:**
- Create: `src/parse/speakers.js`, `test/speakers.test.js`

**Interfaces:**
- Produces:
  - `splitLines(text: string) → Line[]`, where `Line = {kind:'speech', marker, text} | {kind:'plain', text} | {kind:'footnote', mark, text}`
  - `findMarkers(lines: Line[]) → [{ marker, count, example }]`, sorted by count descending, where `example` is the first line text for that marker.

  **Marker rule:** a line whose start, before the first `:` (within 12 characters), is one or more emoji (including ZWJ and variation-selector sequences, e.g. `🌧️`) or a short label of 1–3 characters such as `E`. Whatever follows the colon, after one optional space, is the speech text. A line starting with `*` or `**` followed by a space is a footnote. Anything else is plain. An empty marker (a line starting with `:`) is **plain**, kept verbatim.

- [ ] **Step 1: Write the failing tests**

```js
test('emoji markers incl. variation selector', () => {
  const lines = splitLines(fxText('2110438810274414709'));
  const m = findMarkers(lines).map(x => x.marker);
  assert.deepEqual(new Set(m), new Set(['🦁', '🌧️', '🦊', '🐰', '🗣️']));
  assert.equal(lines.find(l => l.kind === 'speech' && l.marker === '🦊').text, 'Actually, I like this scene too.');
});
test('footnotes', () => {
  const f = splitLines(fxText('2110438810274414709')).filter(l => l.kind === 'footnote');
  assert.equal(f.length, 2);
  assert.equal(f[0].mark, '*');
});
test('empty marker line stays as plain text (danaNYB)', () => {
  const lines = splitLines(fxText('2108748780564816034'));
  assert.ok(lines.some(l => l.kind === 'plain' && l.text.startsWith(': Bonnie, mommy')));
  assert.ok(lines.some(l => l.kind === 'speech' && l.marker === '💜'));
});
test('header and context lines are plain', () => {
  const lines = splitLines(fxText('2030321729902641632'));
  assert.equal(lines[0].kind, 'plain');
  assert.equal(lines[0].text, 'ANY LOVE EMIBONNIE SESSION D1');
});
test('letter label', () => {
  assert.deepEqual(splitLines('E: hi')[0], { kind: 'speech', marker: 'E', text: 'hi' });
});
test('lines joined back equal the original text', () => {
  const t = fxText('2110438810274414709');
  assert.equal(splitLines(t).length, t.split('\n').filter(s => s.trim() !== '').length);
});
```

- [ ] **Step 2: Run `npm test`, expect a FAIL.**
- [ ] **Step 3: Implement.** Use `/^\p{Extended_Pictographic}/u` together with `Intl.Segmenter` (granularity `grapheme`) to read the whole emoji cluster. Blank lines are skipped. Line text is otherwise kept verbatim.
- [ ] **Step 4: Run `npm test`, expect PASS.**
- [ ] **Step 5: Commit** — `git commit -m "Split translation text into speaker lines"`

---

### Task 5: Database schema and client

**Files:**
- Create: `db/schema.sql`, `src/db.js`, `src/migrate.js`, `test/helpers/db.js`, `test/db.test.js`

**Interfaces:**
- Produces:
  - `getDb() → { query(sql: string, params?: any[]) → Promise<{rows: object[]}> }`. If `DATABASE_URL` is set, it uses `@neondatabase/serverless` `Pool`. Otherwise it uses PGlite in memory, with the `pg_trgm` extension (from `@electric-sql/pglite/contrib/pg_trgm`).
  - `migrate(db)` runs `db/schema.sql`, which is idempotent (`create … if not exists`, `insert … on conflict do nothing`).
  - `test/helpers/db.js` exports `freshDb() → Promise<db>`, which gives a new PGlite instance with the schema applied.

  **Schema** (exact names are used by later tasks):

```sql
create extension if not exists pg_trgm;
create table if not exists people (
  id serial primary key,
  ig_handle text unique not null check (ig_handle = lower(ig_handle)),
  display_name text not null check (display_name = lower(display_name)),
  emoji text not null, colour text not null,
  extra_hashtags text[] not null default '{}', fixed boolean not null default false);
create table if not exists translators (
  x_user_id text primary key, handle text not null, display_name text,
  opted_out_at timestamptz);
create table if not exists events (
  id serial primary key, slug text unique not null, name text not null, date date not null,
  type text, client_media text, keywords text[] not null default '{}', hashtags text[] not null default '{}',
  live_person_id int references people(id), live_platform text,
  created_by text not null, created_at timestamptz not null default now(), needs_review boolean not null default true);
create table if not exists entries (
  tweet_id text primary key, translator_id text not null references translators(x_user_id),
  kind text not null check (kind in ('event','shared_story','unsorted')),
  event_id int references events(id), type text, client_media text,
  posted_at timestamptz not null, keyword text, hashtags text[] not null default '{}',
  text text not null, follow_up_ids text[] not null default '{}',
  clip_source_handle text, clip_source_url text, follows_on_from text,
  full_video_url text, full_video_start int,
  speaker_map jsonb not null default '{}',          -- { "<marker>": {"person": <id>} | {"role": "host|fan|speaker|crowd"} }
  sharing_person_id int references people(id), about_person_ids int[] not null default '{}',
  person_ids int[] not null default '{}',            -- derived: all mapped people + sharing + about
  added_by text not null, source text not null check (source in ('submit','notion','paste','cli')),
  text_entered_manually boolean not null default false,
  tweet_status text not null default 'live' check (tweet_status in ('live','deleted','unavailable')),
  status_checked_at timestamptz, removed_by text check (removed_by in ('translator','owner')), removed_at timestamptz,
  event_order int, created_at timestamptz not null default now(),
  search tsvector generated always as (to_tsvector('simple', coalesce(keyword,'') || ' ' || text)) stored);
create index if not exists entries_text_trgm on entries using gin (text gin_trgm_ops);
create index if not exists entries_search on entries using gin (search);
create index if not exists entries_event on entries (event_id);
create table if not exists speaker_memory (
  translator_id text not null references translators(x_user_id), marker text not null,
  mapping jsonb not null, primary key (translator_id, marker));
create table if not exists ignored_hashtags (tag text primary key check (tag = lower(tag)));
create table if not exists types (name text primary key);
insert into people (ig_handle, display_name, emoji, colour, fixed) values
  ('emiamily','emi','🧡','#ff8a3d',true), ('beonnnie','bonnie','💜','#9b6cff',true) on conflict do nothing;
insert into ignored_hashtags values ('emibonnie') on conflict do nothing;
insert into types values ('show / interview'),('fan meet / fan day'),('live'),('shared story') on conflict do nothing;
```

  A `'simple'` text configuration is used rather than `'english'`, so translators' wording isn't stemmed. Thai search goes through trigram/`ILIKE` (Task 8).

- [ ] **Step 1: Write the failing test** `test/db.test.js`: after `freshDb()`, `select display_name from people order by id` returns `['emi','bonnie']`; inserting a person with `display_name 'Leo'` throws (lowercase check); running `migrate(db)` twice doesn't throw.
- [ ] **Step 2: Run `npm test`, expect a FAIL.**
- [ ] **Step 3: Implement `src/db.js`, `src/migrate.js` (CLI: `getDb()` then `migrate()` then log "migrated"), and `test/helpers/db.js`.**
- [ ] **Step 4: Run `npm test`, expect PASS.**
- [ ] **Step 5: Commit** — `git commit -m "Database schema with seed people and types"`

---

### Task 6: Event matching

**Files:**
- Create: `src/events.js`, `test/events.test.js`

**Interfaces:**
- Consumes: `Header` (Task 3).
- Produces:
  - `normKeyword(s) → string`: lowercase, collapse whitespace, trim.
  - `matchEvent(header, postedAt: string, events: Event[], people: Person[]) → { match: Event|null, suggestions: Event[], proposal: NewEvent|null, kind: 'event'|'shared_story'|'unsorted' }`

  **Rules, in order:**
  1. Any `events` row whose normalised `keywords` include `normKeyword(header.keyword)`, or whose lowercased `hashtags` intersect the header's lowercased hashtags → `match`.
  2. Otherwise, if `header.live` and exactly one `personTags` entry: an event with the same `live_person_id`, same `live_platform`, and `|date − liveDate| ≤ 1 day` → `match`.
  3. If there's no match:
     - **New event proposal** when there's a keyword, an event hashtag, or a live. Name = keyword, or `"<display_name> <platform>"`. Date = live date, or the posted date. Slug = `slugify(name)-YYYY-MM-DD`.
     - Otherwise, `kind: 'shared_story'` when `unknownHandleTags` is non-empty, else `'unsorted'`.
  4. `suggestions` = events dated within ±1 day of the entry's date (live date or posted date), excluding the match, newest first, at most 5.

- [ ] **Step 1: Write the failing tests**

```js
const efm = { id: 1, name: 'EMIBONNIE AT EFM', keywords: ['EMIBONNIE AT EFM'], hashtags: ['#EmiBonniexFANDOMLIVE'], date: '2025-05-15' };
const live = { id: 2, name: 'bonnie tiktok live', keywords: [], hashtags: [], live_person_id: 2, live_platform: 'tiktok live', date: '2026-02-12' };
const people = [{ id: 1, ig_handle: 'emiamily', display_name: 'emi' }, { id: 2, ig_handle: 'beonnnie', display_name: 'bonnie' }];
test('keyword match ignores case and spacing', () => {
  const r = matchEvent({ keyword: 'emibonnie  at efm ', hashtags: [], personTags: [], unknownHandleTags: [], live: null }, '2025-05-16T00:00:00Z', [efm, live], people);
  assert.equal(r.match.id, 1);
});
test('ignored-only hashtags never match (header already stripped them)', () => {
  const r = matchEvent({ keyword: null, hashtags: [], personTags: [], unknownHandleTags: [], live: null }, '2025-05-15T00:00:00Z', [efm], people);
  assert.equal(r.match, null);
  assert.equal(r.kind, 'unsorted');
});
test('live matches same person+platform within a day', () => {
  const h = { keyword: null, hashtags: [], personTags: ['beonnnie'], unknownHandleTags: [], live: { platform: 'tiktok live', date: '2026-02-13' } };
  assert.equal(matchEvent(h, '2026-02-13T10:00:00Z', [live], people).match.id, 2);
  h.live.date = '2026-02-15';
  const r = matchEvent(h, '2026-02-15T10:00:00Z', [live], people);
  assert.equal(r.match, null);
  assert.deepEqual(r.proposal, { name: 'bonnie tiktok live', date: '2026-02-15', slug: 'bonnie-tiktok-live-2026-02-15', live_person_id: 2, live_platform: 'tiktok live', keywords: [], hashtags: [] });
});
test('shared story when only an unknown handle tag', () => {
  const r = matchEvent({ keyword: null, hashtags: [], personTags: [], unknownHandleTags: ['michirujjang'], live: null }, '2025-12-23T10:33:54Z', [efm], people);
  assert.equal(r.kind, 'shared_story');
});
```

- [ ] **Step 2: Run `npm test`, expect a FAIL.**
- [ ] **Step 3: Implement.** Dates are compared as UTC calendar days.
- [ ] **Step 4: Run `npm test`, expect PASS.**
- [ ] **Step 5: Commit** — `git commit -m "Event matching by keyword, hashtag, and live window"`

---

### Task 7: Store and ingest, with the owner CLI

**Files:**
- Create: `src/store.js`, `src/ingest.js`, `scripts/add.js`, `test/ingest.test.js`

**Interfaces:**
- Consumes: `fetchTweet`/`normalize` (Task 2), `parseHeader` (Task 3), `splitLines`/`findMarkers` (Task 4), `matchEvent` (Task 6), `getDb` (Task 5).
- Produces:
  - `store.listPeople(db) → Person[]`, `store.listEvents(db) → Event[]`, `store.ignoredHashtags(db) → string[]`
  - `store.upsertTranslator(db, {x_user_id, handle, display_name})`
  - `store.createEvent(db, proposal, createdBy) → Event`
  - `store.insertEntry(db, entryRow) → void`
  - `store.rememberSpeakers(db, translatorId, speakerMap)` and `store.recallSpeakers(db, translatorId) → speakerMap`
  - `ingestTweet(db, tweetOrId, { speakerMap, addedBy, source, overrides = {}, fetchImpl }) → Promise<{ status: 'added'|'duplicate'|'opted_out'|'removed'|'deleted'|'unavailable'|'needs_speakers', tweetId, eventId?, missingMarkers? }>`

  **`ingestTweet` order:**
  1. **duplicate** if `entries.tweet_id` exists and isn't removed; **removed** if it exists and is removed (removed tweets can't be re-added).
  2. Fetch the tweet. Return **deleted** or **unavailable** as-is.
  3. **opted_out** if the translator has `opted_out_at`.
  4. Upsert the translator.
  5. Parse the header (using `ignoredHashtags` and the people's handles and extra hashtags) and the lines.
  6. Build the effective speaker map: defaults `{'💜':{person:bonnie.id}, '🧡':{person:emi.id}, '🗣️':{role:'crowd'}, '💬':{role:'fan'}}`, overlaid by `recallSpeakers`, overlaid by `speakerMap`.
  7. If any marker from `findMarkers` is still unmapped, return **needs_speakers** with `missingMarkers`.
  8. `matchEvent`, applying `overrides` (`event_id`, `kind`, `type`, `client_media`, `new_event`). When the resulting kind is `shared_story`, set `type = 'shared story'`, `event_id = null`, `sharing_person_id` = the person matching the first `unknownHandleTags`/`personTags` entry if they exist (else null), and `about_person_ids` = the mapped people.
  9. Create the proposed event if there's no match and the kind is `event`.
  10. Insert the entry, with `person_ids` = the union of mapped people.
  11. `rememberSpeakers`. Return **added**.

  `scripts/add.js <url-or-id> [--map '🐰=beonnnie,🦊=emiamily,🦁=role:host'] [--shared-story] [--event <slug>]` resolves handles to person IDs, calls `ingestTweet` with `addedBy: 'owner-cli'` and `source: 'cli'`, and prints the result. If the result is `needs_speakers`, it prints each missing marker with its count and example, and exits with code 2.

- [ ] **Step 1: Write the failing tests** (PGlite + fixture-backed `fetchImpl` that serves `test/fixtures/tweets/<id>.{syn,fx}.json`)

```js
test('needs speakers first, then adds with a map, and remembers it', async () => {
  const db = await freshDb();
  let r = await ingestTweet(db, '2110438810274414709', { addedBy: 'test', source: 'cli', fetchImpl });
  assert.equal(r.status, 'needs_speakers');
  assert.deepEqual(new Set(r.missingMarkers.map(m => m.marker)), new Set(['🦁', '🌧️', '🦊', '🐰']));
  const leo = await addPerson(db, { ig_handle: 'leo_test', display_name: 'leo', emoji: '🦁', colour: '#2fa89a' });
  const map = { '🐰': { person: 2 }, '🦊': { person: 1 }, '🦁': { person: leo.id }, '🌧️': { role: 'speaker' } };
  r = await ingestTweet(db, '2110438810274414709', { speakerMap: map, addedBy: 'test', source: 'cli', fetchImpl });
  assert.equal(r.status, 'added');
  const { rows } = await db.query('select text, keyword, person_ids from entries');
  assert.match(rows[0].text, /We hug all the time\./);
  assert.equal(rows[0].keyword, 'LOVE TO THE MOON AND KEY');
  // remembered: another vacantvolcanic tweet using 🐰 needs no map for 🐰
  r = await ingestTweet(db, '2021992269596045801', { addedBy: 'test', source: 'cli', fetchImpl });
  assert.ok(r.status === 'added' || !r.missingMarkers.some(m => m.marker === '🐰'));
});
test('two translators, same event', async () => {
  const db = await freshDb();
  await ingestTweet(db, '2108532547101856124', { addedBy: 't', source: 'cli', fetchImpl });
  const r = await ingestTweet(db, '2108748780564816034', { addedBy: 't', source: 'cli', fetchImpl });
  // danaNYB's empty-marker line is plain; 💜 is a default → added
  assert.equal(r.status, 'added');
  const { rows } = await db.query('select count(distinct event_id)::int n from entries');
  assert.equal(rows[0].n, 1);
});
test('duplicate, removed, opted out', async () => { /* insert once → 'duplicate'; set removed_at → 'removed'; set translators.opted_out_at on a fresh db → 'opted_out' */ });
test('shared story kind', async () => { /* 2003413749940834557 with map {'🪇':{role:'speaker'}} → entries.kind = 'shared_story', event_id null */ });
```

  `addPerson` is `store.addPerson(db, {ig_handle, display_name, emoji, colour}) → Person`. Add it to `store.js` (Plan 2's "add a new person" reuses it). It lowercases the handle (stripping `@`) and the display name.

- [ ] **Step 2: Run `npm test`, expect a FAIL.**
- [ ] **Step 3: Implement `store.js`, `ingest.js`, `scripts/add.js`.**
- [ ] **Step 4: Run `npm test`, expect PASS.**
- [ ] **Step 5: Commit** — `git commit -m "Intake: ingestTweet with speaker memory, and owner add CLI"`

---

### Task 8: Search

**Files:**
- Create: `src/search.js`, `test/search.test.js`

**Interfaces:**
- Produces: `search(db, { q = '', people = [], peopleMode = 'any', types = [], eventSlug, translatorHandle, clientMedia, from, to, limit = 50, offset = 0 }) → Promise<{ count: number, results: Result[] }>`
  - `Result = { tweet_id, event: {slug, name, date}|null, kind, posted_at, translator_handle, person_ids, matchLines: string[] }`
  - Excludes `removed_at is not null` and opted-out translators, **always**.
  - `q` matching uses `text ILIKE '%' || q || '%'` (served by the trigram index; works for Thai), or `search @@ plainto_tsquery('simple', q)`.
  - `peopleMode 'all'` uses `person_ids @> $people`. `'any'` uses `&&`.
  - `matchLines` = up to 2 lines of the entry text containing `q` (case-insensitive). With no `q`, it's the first 2 non-header lines.
  - Order is `posted_at desc`.

- [ ] **Step 1: Write the failing tests** (seed by ingesting the fixtures with full speaker maps)

```js
test('finds English word', async () => { const r = await search(db, { q: 'hug' }); assert.ok(r.results.some(x => x.tweet_id === '2110438810274414709')); });
test('finds Thai substring', async () => { const r = await search(db, { q: 'ครบ' }); assert.equal(r.results[0].tweet_id, '2110438810274414709'); assert.match(r.results[0].matchLines[0], /ครบ/); });
test('people all-of narrows', async () => {
  const any = await search(db, { people: [1, 2], peopleMode: 'any' });
  const all = await search(db, { people: [1, 2], peopleMode: 'all' });
  assert.ok(all.count <= any.count && all.count > 0);
});
test('type filter: shared story', async () => { const r = await search(db, { types: ['shared story'] }); assert.deepEqual(r.results.map(x => x.tweet_id), ['2003413749940834557']); });
test('removed and opted-out never appear', async () => {
  await db.query(`update entries set removed_at = now(), removed_by = 'translator' where tweet_id = '2110438810274414709'`);
  assert.equal((await search(db, { q: 'hug' })).results.some(x => x.tweet_id === '2110438810274414709'), false);
  await db.query(`update translators set opted_out_at = now() where handle = 'SugarHoneyz13'`);
  assert.equal((await search(db, {})).results.some(x => x.translator_handle === 'SugarHoneyz13'), false);
});
```

- [ ] **Step 2: Run `npm test`, expect a FAIL.**
- [ ] **Step 3: Implement** with parameterised SQL only. Never interpolate `q` into the query string.
- [ ] **Step 4: Run `npm test`, expect PASS.**
- [ ] **Step 5: Commit** — `git commit -m "Search with filters, Thai substring, and removal rules"`

---

### Task 9: Public API

**Files:**
- Create: `api/home.js`, `api/event.js`, `api/entry.js`, `api/search.js`, `api/person.js`, `api/translator.js`, `api/video.js`, `src/views.js`, `test/api.test.js`

**Interfaces:**
- Consumes: `store`, `search`, `fetchTweet`, `splitLines`.
- Produces (all `GET`, JSON; every one excludes removed and opted-out content):
  - `/api/home` → `{ months: [{ month: 'YYYY-MM', events: [{ slug, name, date, hashtag, count }] }] }`. Only events with at least 1 visible entry.
  - `/api/event?slug=` → `{ event: {slug,name,date,type,client_media,keywords,hashtags, translatorCount}, entries: Preview[] }`, in `event_order nulls last, posted_at` order. Returns 404 if the event isn't found.
  - `/api/entry?id=` → `{ entry: {...row minus internal columns, translator_handle, lines: Line[]}, people: Person[] (all referenced), prev: tweet_id|null, next: tweet_id|null }`. prev/next are within the same event. Returns 404 if the entry is missing or removed.
  - `/api/search?…` → the `search()` output, with query-string arrays as comma lists (`people=1,2&types=live`).
  - `/api/person?ig=` → `{ person, counts: {translations, events, shared_stories}, groups: [{ event|null, kind, entries: Preview[] }] }`
  - `/api/translator?handle=` → `{ translator: {handle, opted_out: bool}, counts, groups }`. When the translator has opted out, it returns only `{ translator: {handle, opted_out: true} }`.
  - `/api/video?id=` → `{ variants }` from a fresh `fetchTweet`. Returns 404 when the tweet's `status` isn't `live` or it has no video. Sets `Cache-Control: s-maxage=600`.
  - `Preview = { tweet_id, preview: string[] /* first 2 speech lines as "<emoji> text", standard emoji for known people, else the marker */, person_ids, translator_handle, has_video, follows_on_from }`
  - `src/views.js` exports `toPreview(entry, peopleById) → Preview` and `groupByEvent(entries) → groups`.

- [ ] **Step 1: Write the failing tests.** Call the handlers directly with a fake `req`/`res` against a seeded PGlite. API modules call `getDb()`, so test setup sets a module-level override: `src/db.js` exports `setDbForTests(db)`.
  - `home` groups the October 2026 events under `'2026-10'`.
  - `entry` for `2110438810274414709` returns `lines` where the `🦊` line maps to emi via `people`.
  - `entry` for a removed tweet returns 404.
  - `translator` for an opted-out handle returns only `{translator:{handle, opted_out:true}}`.
  - `video` for a tombstoned tweet returns 404 (use `fetchImpl` injection through `setFetchForTests`).
  - The preview for the Moonshadow entry starts with `'🦁 What impressed you abt this scene?'` when leo's standard emoji is 🦁.
- [ ] **Step 2: Run `npm test`, expect a FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm test`, expect PASS.**
- [ ] **Step 5: Commit** — `git commit -m "Public JSON API"`

---

### Task 10: Styles, escaping, and render functions

**Files:**
- Create: `public/css/site.css`, `public/js/esc.js`, `public/js/render.js`, `public/js/layout.js`, `test/render.test.js`

**Interfaces:**
- Produces (pure, string-returning, importable in Node):
  - `esc(s) → string`, which escapes `& < > " '`.
  - `renderBubbles(lines: Line[], speakerMap, peopleById) → string`.
    - Known person: a `.msg` bubble with their standard emoji, lowercase name, and the `--c` CSS variable set to their colour.
    - Role: the translator's marker, with the role name.
    - `crowd`: a `.crowd` note.
    - Consecutive same speaker: the follow-on bubble has no avatar or name (`.msg.cont`).
    - `plain` lines become `.plain`, and footnotes are collected at the end in `.notes`.
  - `renderCast(speakerMap, peopleById) → string`: pills for each person and role present (crowd isn't shown).
  - `renderEventCard(ev)`, `renderPreview(p, peopleById)`, `renderResult(r, q, peopleById)` (highlights `q` with `<mark>` on escaped text).
  - `layout.js`: `mountHeader(el, { compact })` (logo, wordmark, tagline, FAN-MADE) and `mountTabBar(el, active)` (home · search · ＋ add · me; on wide screens it becomes a top bar). It also shows a search box with the filter icon (SVG: three lines, widths 16/10/4) when `compact` is false.
  - `site.css`: tokens as CSS custom properties on `:root`, plus a `prefers-color-scheme: dark` override with dark equivalents (builder's choice of exact values; keep contrast ≥ 4.5:1). Components: card, pill, chip, bubble, tab bar, sheet, and `.vid` (sticky).

- [ ] **Step 1: Write the failing tests**

```js
test('esc', () => assert.equal(esc(`<b a="x">&'`), '&lt;b a=&quot;x&quot;&gt;&amp;&#39;'));
test('bubbles use standard emoji and lowercase names', () => {
  const html = renderBubbles(splitLines('🦊: hi\n🦊: again\n🗣️: (cheering)\n🐰: <script>x</script>'),
    { '🦊': { person: 1 }, '🐰': { person: 2 }, '🗣️': { role: 'crowd' } }, peopleById);
  assert.match(html, /🧡/); assert.doesNotMatch(html, /🦊/);
  assert.match(html, />emi</); assert.equal((html.match(/class="msg cont"/g) || []).length, 1);
  assert.match(html, /class="crowd"/);
  assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>/);
});
test('role keeps translator emoji', () => {
  assert.match(renderBubbles(splitLines('🌧️: hello'), { '🌧️': { role: 'speaker' } }, peopleById), /🌧️[\s\S]*speaker/);
});
test('plain and footnotes kept verbatim', () => {
  const html = renderBubbles(splitLines(': Bonnie, mommy has sth\n* note one'), {}, peopleById);
  assert.match(html, /class="plain">: Bonnie, mommy has sth</);
  assert.match(html, /class="notes"[\s\S]*\* note one/);
});
test('highlight is escaped first', () => {
  assert.match(renderResult({ matchLines: ['a <hug> b'], event: null, person_ids: [] }, 'hug', peopleById), /&lt;<mark>hug<\/mark>&gt;/);
});
```

- [ ] **Step 2: Run `npm test`, expect a FAIL.**
- [ ] **Step 3: Implement.** Match `docs/superpowers/specs/mockups/screens-v2.html` and `speaker-style-v2.html` for the look.
- [ ] **Step 4: Run `npm test`, expect PASS.**
- [ ] **Step 5: Commit** — `git commit -m "Design tokens, escaping, and render functions"`

---

### Task 11: Home, event, and translation pages

**Files:**
- Create: `public/index.html`, `public/event.html`, `public/entry.html`, `public/soon.html` (finalise), `public/js/pages/home.js`, `public/js/pages/event.js`, `public/js/pages/entry.js`

**Interfaces:**
- Consumes: the `/api/home`, `/api/event`, `/api/entry` and `/api/video` routes; the render functions (Task 10); `layout.js`.

- [ ] **Step 1: Seed local data.** Add `scripts/seed-dev.js`, which writes to a persistent PGlite folder `.devdb/`, gitignored. When `DATABASE_URL` is unset, `npm run dev` uses `.devdb/` (add this to `getDb`: the `PGLITE_DIR` env var, defaulting to `.devdb` in dev and in-memory in tests). The seed ingests the 6 fixture tweets offline, adds leo (`ig_handle: 'leo_placeholder'` — replace with the real handle when the owner gives it), and uses full speaker maps. Run `node scripts/seed-dev.js`. **Expected:** "seeded 6".

- [ ] **Step 2: Home** — the header (not compact), the search box (tapping it goes to `/search`), and the filter icon (goes to `/search?filters=1`). Events are grouped under lowercase month headings ("october 2026"), and cards link to `/e/<slug>`.

- [ ] **Step 3: Event page** — back link, name, meta line (`date · N translations · M translators`), tag pills, people chips, and a translator dropdown filtering on the client side. Preview cards link to `/t/<id>`. "newest first" toggle. A "Report" link goes to `/soon.html`.

- [ ] **Step 4: Translation page.**
  - **Phone (< 860px):** `.vid` is `position: sticky; top: 0` at the top, with the content scrolling under it.
  - **Web (≥ 860px):** a two-column grid. The left column has the sticky video plus "‹ previous in event / next in event ›". The right column holds credits, pills, cast and bubbles.
  - The video is loaded from `/api/video?id=` into `<video controls playsinline preload="metadata">`. It uses the smallest variant when `matchMedia('(max-width: 859px)')` matches, otherwise the largest at or below 2.2 Mbps.
  - On a 404, or on the `error` event, the video area is replaced by "Original tweet is no longer available. Translation kept below." (This fallback applies only if Task 1's check passed; otherwise use the X embed per the spec.)
  - **Credits:** `tl @handle · clip by @source · 14 Oct 2026`. Footer links: original tweet, original media, follows on from, added by, Copy link, Report (→ `/soon.html`).
  - "show original" toggles a `<pre>` holding the escaped verbatim text.

- [ ] **Step 5: Verify in the browser.** Run `npm run dev` and open `http://127.0.0.1:3000/` at 390px wide and at 1280px wide. **Expected:**
  - Home shows events grouped by month.
  - Tapping an event, then an entry, shows bubbles with 🧡/💜, and the video stays put while scrolling.
  - The Moonshadow entry shows "🌧️ speaker".
  - Compare against `docs/superpowers/specs/mockups/screens-v2.html` side by side.

  Use the `run` or `browse` skill to take screenshots at both widths, and include them in the task report.

- [ ] **Step 6: Commit** — `git commit -m "Home, event, and translation pages"`

---

### Task 12: Search page

**Files:**
- Create: `public/search.html`, `public/js/pages/search.js`, `public/js/search-state.js`, `test/search-state.test.js`

**Interfaces:**
- Produces: `search-state.js` exports `parseState(urlSearchParams) → State` and `toQuery(State) → string`, where `State = { q, people: number[], peopleMode, types: string[], event, translator, client, from, to }`. The URL is the source of truth, so scoped search is just a link: `/search?people=2`, `/search?translator=vacantvolcanic`, `/search?event=<slug>`.

- [ ] **Step 1: Write the failing tests:** a `parseState`/`toQuery` round trip; empty values are omitted; `people` keeps its order; `filterCount(state)` (also exported) counts the active filters, excluding `q`. For example, `people=[2]` + `types=['live']` gives `2`.
- [ ] **Step 2: Run `npm test`, expect a FAIL.**
- [ ] **Step 3: Implement the page:**
  - The box is autofocused.
  - Next to the box: the filter icon with a count badge when `filterCount > 0`.
  - Active filters show as removable chips, plus "clear all".
  - Empty state (no `q` and no filters): recent searches (`localStorage`, wrapped in try/catch, last 8) and quick chips for people and types.
  - **Filter sheet**, sliding up from the bottom:
    - **who's in it:** people chips with an "any of / all of" switch.
    - **type** chips.
    - **event, translator, client/media, date** selects. Options come from `/api/home` and `/api/search` facets; listing just the people and types from `/api/person` is fine here.
    - The apply button reads "show N translations" and live-counts through `/api/search?…&limit=0`.
  - **Results:** event and date, `matchLines` with `<mark>`, then people emoji and translator.
  - Person, translator and event pages each get a search icon linking to the scoped URL.
- [ ] **Step 4: Run `npm test`, expect PASS. Then check in the browser:**
  - `/search?q=ครบ` finds the Moonshadow entry.
  - The filter icon badge shows `2` after picking bonnie and live.
  - Removing a chip updates the URL and the results.
- [ ] **Step 5: Commit** — `git commit -m "Search page with filter sheet and scoped search"`

---

### Task 13: Person and translator pages

**Files:**
- Create: `public/person.html`, `public/translator.html`, `public/js/pages/person.js`, `public/js/pages/translator.js`

- [ ] **Step 1: Person page.**
  - A header tinted with the person's colour, showing their emoji, lowercase name, `@ig`, and "in N translations · M events · K shared stories".
  - A segmented control: "by event" / "all, newest" / "with…". "with…" opens a people picker, then links to `/search?people=<this>,<other>&peopleMode=all`.
  - Groups use lowercase event names with dates, and shared stories are labelled "shared story · date".
  - A search icon links to `/search?people=<id>`.
- [ ] **Step 2: Translator page.**
  - The X handle, "open profile ↗" linking to `https://x.com/<handle>`, and totals.
  - Translations grouped by event.
  - If the translator has opted out, the page shows only "this translator has opted out".
- [ ] **Step 3: Check in the browser.**
  - `/p/beonnnie` lists the Moonshadow, TikTok live and shared-story entries.
  - `/tl/vacantvolcanic` shows 4 entries.
  - After `update translators set opted_out_at=now() where handle='danaNYB'` in `.devdb`, `/tl/danaNYB` shows only the opted-out line, and the HAPPY FAMILY event shows 1 translation.
- [ ] **Step 4: Commit** — `git commit -m "Person and translator pages"`

---

### Task 14: Deploy pipeline (needs the owner)

**Files:**
- Create: `.github/workflows/deploy.yml`, `docs/deploy.md`

**Owner steps.** Pause and ask the owner to do these in their **fan accounts**, then confirm before continuing:
1. Create a Neon project directly at neon.com (free plan, not through the Vercel Marketplace) and copy its connection string.
2. Create a Vercel project (Hobby) **without** connecting Git, then run `vercel link` locally. That produces `.vercel/project.json`, which is gitignored. Create a Vercel token.
3. Create the GitHub repo `mintbluecar/emibonnie-archive` as **private**, unless the owner says otherwise.
4. Add repo secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`. Add `DATABASE_URL` in the Vercel project's env vars (Production and Preview).

**Interfaces:**
- Produces: on push to `main`, the workflow runs `npm ci && npm test`, then `vercel pull --yes --environment=production`, `vercel build --prod`, and `vercel deploy --prebuilt --prod`, all with `--token=${{ secrets.VERCEL_TOKEN }}`. On pull requests, it does the same with `preview`.

- [ ] **Step 1: Write `deploy.yml` and `docs/deploy.md`.** The doc covers the four owner steps above and how to run `DATABASE_URL=… npm run migrate` once. Use no personal names or paths.
- [ ] **Step 2: Run the migration against Neon:** `DATABASE_URL=… npm run migrate`. **Expected:** "migrated".
- [ ] **Step 3: Add data.** Run `DATABASE_URL=… npm run add -- <id> --map …` for the 6 example tweets. **Expected:** "added" ×6.
- [ ] **Step 4: Commit.** Then **ask the owner** whether to push (`git push -u origin main`). Push only on a yes. After pushing, check that the Actions run is green and open the production URL on a phone. **Expected:** home lists the events, and an entry's video plays and stays pinned while scrolling.

---

## Self-review notes

- **Spec coverage in this plan:** core concepts (entries, events incl. lives and separate events at data level, shared stories, people incl. IG and person hashtags, generic roles), two-source fetch, speaker display, search with filters and scoped search, pages (home, event, translation, search, person, translator), video player with deleted fallback, visual design, deploy via Actions, Neon direct, removed/opted-out exclusion.
- **Deferred to Plan 2:** sign-in (X + Google), add flow UI incl. event picker / "＋ this is a separate event" / new-event inline setup, me page, translator remove/restore/opt-out UI, reports, translator welcome screen, edit log, blocking, approval switch.
- **Deferred to Plan 3:** admin screens, Notion CSV and paste import with per-translator mapping, GitHub Actions jobs (import worker, daily health check, nightly private backup), source-failure and X-sign-in alerts.
