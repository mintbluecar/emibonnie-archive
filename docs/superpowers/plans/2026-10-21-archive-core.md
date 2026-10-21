# Archive Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deployed, read-only emibonnie archive: the database, tweet fetching and parsing, an owner command to add tweets, and every public reading page (home, event, translation, search, person, translator) in the approved visual design. It's built so Plans 2 and 3 slot in without rewrites.

**Architecture:** Layered, with a pure core:
- A pure **domain** (parsing, speaker resolution, event matching, drafting an entry).
- **Adapters** for the outside world: tweet sources and the database (one repository per table group).
- **Services** that orchestrate them (ingest, search, presenters).
- Thin **HTTP handlers** in `api/`.

The browser side is plain ES modules: small, pure render components plus page modules. Dependencies (`db`, `fetchImpl`, `now`) are passed in explicitly, never imported as globals.

**Tech Stack:** Node 22+ (local is 26), `node --test`, `@neondatabase/serverless`, `@electric-sql/pglite` (tests and local dev), ESLint (flat config), TypeScript as a **checker only** (`checkJs`, no build step), Vercel Hobby, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-21-translation-archive-design.md`. Mockups are in `docs/superpowers/specs/mockups/`. Read both. The spec's text wins over a mockup.

**Later plans (not this one):** sign-in and the add flow (Plan 2); the admin screens, bulk import and GitHub Actions jobs (Plan 3). The seams they plug into are named under each task's **Produces**.

## Global Constraints

- Commit as `car <bluerotcar@gmail.com>`. The repo's `origin` is `git@github.com:mintbluecar/emibonnie-archive.git`, which sets this identity automatically. Check with `git config user.email` before the first commit. **Never push** unless the owner says so in that moment.
- No real name, no personal GitHub account, and no `/Users/...` paths in any committed file.
- Secrets (`DATABASE_URL`, Vercel token) live only in env vars and GitHub/Vercel secrets. `.env*` is gitignored.
- Translator text is stored and shown **verbatim**. Formatting is a view on top of it.
- Person display names are **lowercase** everywhere.
- Fixed people: emi `@emiamily` 🧡 `#ff8a3d`; bonnie `@beonnnie` 💜 `#9b6cff`. IG handles are stored lowercase without `@`.
- Generic roles: `host`, `fan`, `speaker`, `crowd`. They keep the translator's own emoji and have no person page.
- Known people are always shown with their **standard emoji**.
- Design tokens: bg `#f6efe3`, card `#fffdf8`, line `#eadfce`, ink `#2b2233`, muted `#8a7f8f`, brand gradient `#ff6a2b → #e03a85`, emi `#ff8a3d`, bonnie `#9b6cff`. Fonts: Nunito, IBM Plex Sans Thai.
- Header: logo + "emibonnie archive" ("emibonnie" in the gradient) + "fan translations, kept" + **FAN-MADE** badge. Phone tab bar: home · search · ＋ add · me ("＋ add" and "me" go to a "coming soon" page in this plan).
- Entries have **no titles**. "clip by @…" is always shown.
- Removed or opted-out content never appears in any public response.
- Tweet sources: syndication `https://cdn.syndication.twimg.com/tweet-result?id={id}&lang=en&token={token}`, with token `((Number(id)/1e15)*Math.PI).toString(36).replace(/(0+|\.)/g,'')`; FxTwitter `https://api.fxtwitter.com/2/status/{id}`.
- Live-event window: same person + same platform + date within **±1 day**.

## Architecture and code rules

These rules apply to every task. A reviewer rejects a task that breaks them.

**Layers.** Imports may only point downward:

```
api/*.js              thin HTTP adapters: parse input → call a service → return JSON. No SQL, no business rules.
src/http/             handler wrapper, errors, query parsing (shared by every endpoint)
src/services/         orchestration: ingest, search, presenters (views). May use repo/, tweets/, domain/.
src/repo/             all SQL lives here, one module per table group. May use db/ and domain/types only.
src/tweets/           all network access to tweet sources. Returns domain Tweet objects.
src/db/               connection + migrations only
src/domain/           PURE: no I/O, no Date.now(), no imports from other layers. Parsing, rules, constants, types.
public/js/core/       browser utilities (api client, esc, dom, format)
public/js/components/ pure render(props) → string, plus optional bind(el, props) for interaction
public/js/pages/      one module per page: fetch data, compose components, wire events
```

**Rules:**
1. **One source of truth for each rule.**
   - Visibility ("not removed, translator not opted out") is the `visibleEntry` SQL fragment in `src/repo/visibility.js`, used by every read query.
   - Default speaker mappings, roles, platforms and the live window are in `src/domain/constants.js`.
   - Shared data shapes are JSDoc typedefs in `src/domain/types.js`.
   - Nothing restates these elsewhere.
2. **No god modules.** Each file has one job.
   - ESLint enforces `max-lines: 200` (skipping blank lines and comments), `max-lines-per-function: 50`, `complexity: 10`, `max-params: 4` (pass an options object instead).
   - Tests are exempt from `max-lines`.
3. **Dependency injection.**
   - Services and handlers receive `deps = { db, fetchImpl, now }`. `src/deps.js` builds the production defaults.
   - No module-level mutable state, and no `setXForTests` hooks.
4. **Pure core.** Everything in `src/domain/` is deterministic and tested without mocks. I/O happens only in `tweets/`, `repo/` and `db/`.
5. **Extend, don't edit.**
   - New tweet source: add a module in `src/tweets/sources/` and register it in `fetchTweet`.
   - New live platform: add it to `PLATFORMS` in constants.
   - New endpoint: add a file in `api/` using `handler()`.
   - New UI piece: add a component.
6. **Parameterised SQL only.** User input is never interpolated into SQL text.
7. **Escape at the edge.** Components escape every interpolated value with `esc()`. HTML strings are built only in `public/js/components/`.
8. **Type-checked JS.** Every file starts with `// @ts-check`. `npm run check` runs `tsc --noEmit` with `checkJs`, plus ESLint. It must pass before each commit.
9. **Schema changes are migrations.** Never edit an applied migration. Add `src/db/migrations/NNN_description.sql`.
10. **Every addition follows a recipe.** `CONTRIBUTING.md` has one per extension point (table below), and `npm run new <kind> <name>` scaffolds the file and its test. If a feature needs something no recipe covers, add the recipe (and a template) in the same pull request.
11. **Naming.**
   - Files are `camelCase.js`.
   - Functions are verbs (`parseHeader`, `findMarkers`, `resolveSpeakers`). Pure transforms are named for their output (`toPreview`).
   - SQL columns are `snake_case`, and repos map them to camelCase objects at the boundary.

### Extension points

| To add… | Where | Recipe / scaffold |
|---|---|---|
| A JSON endpoint | `api/<name>.js` exporting `run` + `default handler(run)` | `npm run new endpoint <name>` |
| A page | `public/<name>.html` + `public/js/pages/<name>.js` exporting `start()` (+ rewrite in `vercel.json` if it has a pretty URL) | `npm run new page <name>` |
| A UI piece | `public/js/components/<name>.js` exporting `render(props)` (+ `bind`) | `npm run new component <name>` |
| A database table/column | `src/db/migrations/NNN_<desc>.sql` | `npm run new migration <desc>` |
| Queries for a table group | `src/repo/<name>.js` (functions take `db` first, return camelCase) | `npm run new repo <name>` |
| Orchestration across repos/sources | `src/services/<name>.js` (takes `deps` first) | `npm run new service <name>` |
| A pure rule or parser | `src/domain/<name>.js` | `npm run new domain <name>` |
| A tweet source | `src/tweets/sources/<name>.js` + register in `src/tweets/sources/index.js` | recipe only |
| A live platform, role, or default marker | `src/domain/constants.js` | recipe only (one-line change + a test case) |
| A background job (Plan 3) | `jobs/<name>.js` exporting `run(deps)` + a workflow in `.github/workflows/` | recipe added in Plan 3 |

## Review Focus

1. **Tweet text containing HTML** (`<`, `&`, `"`) renders as text. Tested in Task 13.
2. **Searching Thai**, e.g. `ครบ`, finds the Moonshadow entry. Tested in Task 11.
3. **Lines with an empty marker**, e.g. `: Bonnie, mommy has sth to tell you` from @danaNYB, render as plain text, not dropped. Tested in Task 3.
4. **Keyword variations:** "EMIBONNIE AT EFM " vs "emibonnie at efm" match the same event; an ignored hashtag alone never matches. Tested in Task 6.
5. **Deleted tweets:** a tombstone keeps the archived text; `/api/video` returns 404 and the page shows the "no longer available" note. Tested in Tasks 2 and 12.

---

## File structure

```
package.json  vercel.json  eslint.config.js  jsconfig.json
docs/architecture.md                   the layer diagram + rules above, kept current
CONTRIBUTING.md                        setup, workflow, recipes per extension point, checklist
docs/decisions/                        ADRs: 0000-template.md, 0001…
.github/pull_request_template.md       checklist
scripts/new.js + scripts/templates/    scaffolder and one template set per kind
.github/workflows/deploy.yml
scripts/dev.js                         local server: public/ + api/ + vercel.json rewrites
scripts/add.js                         owner CLI (thin: parse args → ingest service)
scripts/seedDev.js                     loads the 6 fixtures into .devdb/
scripts/videoCheck.mjs                 one-off spike
src/deps.js                            production deps {db, fetchImpl, now}
src/domain/types.js                    JSDoc typedefs: Tweet, Line, Marker, SpeakerMap, Header, Person, Event, Draft
src/domain/constants.js                ROLES, DEFAULT_MARKERS, PLATFORMS, LIVE_WINDOW_DAYS, FIXED_PEOPLE
src/domain/header.js                   parseHeader
src/domain/lines.js                    splitLines, findMarkers
src/domain/speakers.js                 resolveSpeakers, missingMarkers, personIdsFrom
src/domain/events.js                   normKeyword, matchEvent, proposeEvent, slugify
src/domain/draft.js                    draftEntry: Tweet + context → Draft (the whole interpretation, pure)
src/tweets/url.js                      parseTweetId, extractTweetIds
src/tweets/sources/syndication.js      fetchSyndication, synToken
src/tweets/sources/fx.js               fetchFx
src/tweets/sources/index.js            SOURCES registry: [{ name, fetch, role: 'primary'|'fullText' }]
src/tweets/normalize.js                normalize(syn, fx) → Tweet
src/tweets/fetchTweet.js               fetchTweet(deps, id) → Tweet
src/db/client.js                       createDb({url?, dir?}) → Db
src/db/migrate.js                      migrate(db); CLI
src/db/migrations/001_initial.sql      first migration (later plans add 002, 003…)
src/repo/visibility.js                 visibleEntry SQL fragment
src/repo/rows.js                       snake→camel row mapping helper
src/repo/people.js  translators.js  events.js  entries.js  speakerMemory.js  settings.js
src/services/ingest.js                 ingestTweet(deps, input, opts)
src/services/search.js                 search(deps, params)
src/services/views.js                  toPreview, groupByEvent, toEntryView
src/http/handler.js                    handler(run, {cache?}) → (req, res)
src/http/errors.js                     NotFound, BadRequest
src/http/query.js                      str, int, list helpers
api/home.js event.js entry.js search.js person.js translator.js video.js   each: export run + default handler(run)
public/*.html                          index event entry search person translator soon
public/css/tokens.css layout.css cards.css bubbles.css search.css
public/img/logo.png
public/js/core/api.js esc.js dom.js format.js
public/js/components/header.js tabBar.js bubbles.js cast.js eventCard.js previewCard.js resultCard.js chips.js filterSheet.js videoPlayer.js personHeader.js
public/js/state/searchState.js
public/js/pages/home.js event.js entry.js search.js person.js translator.js
test/…                                 mirrors src/ and public/js/; fixtures in test/fixtures/
test/helpers/db.js  test/helpers/fakeFetch.js  test/helpers/fixtures.js
```

---

### Task 1: Scaffold, guardrails, dev server, and the video spike

**Files:**
- Create: `package.json`, `vercel.json`, `eslint.config.js`, `jsconfig.json`, `docs/architecture.md`, `scripts/dev.js`, `scripts/videoCheck.mjs`, `public/soon.html`, `public/img/logo.png` (copy from `docs/superpowers/specs/mockups/logo.png`), `test/dev.test.js`, `test/fixtures/site/event.html`, `test/fixtures/api/ping.js`, `docs/video-check.md`

**Interfaces:**
- Produces:
  - `npm test` runs `node --test`.
  - `npm run check` runs `tsc --noEmit -p jsconfig.json && eslint .`.
  - `npm run dev` serves `http://127.0.0.1:3000`.
  - `scripts/dev.js` exports `createServer({ root, apiDir, rewrites }) → http.Server`. API modules default-export `(req, res)` using Vercel's Node signature (`req.query`, `res.status(n).json(o)`, `res.setHeader`).

- [ ] **Step 1: `package.json`** — `"type":"module"`, `"private":true`, `"engines":{"node":">=22"}`. Scripts: `test`, `check`, `dev`, `migrate` (`node src/db/migrate.js`), `add` (`node scripts/add.js`). Dependency: `@neondatabase/serverless`. Dev dependencies: `@electric-sql/pglite`, `eslint`, `@eslint/js`, `globals`, `typescript`. Run `npm install`.
- [ ] **Step 2: `eslint.config.js`.**
  - Base: `js.configs.recommended`.
  - Rules: `max-lines: ['error', {max: 200, skipBlankLines: true, skipComments: true}]`, `max-lines-per-function: ['error', 50]`, `complexity: ['error', 10]`, `max-params: ['error', 4]`, `no-restricted-imports` blocking `src/domain/**` from importing `../repo`, `../tweets`, `../db`, `../services`, `../http`, and blocking `api/**` from importing `src/repo/**` and `src/db/**`.
  - `test/**`: `max-lines` and `max-lines-per-function` off.
  - Globals: Node for `src`, `api`, `scripts`, `test`; browser for `public/js`.
- [ ] **Step 3: `jsconfig.json`** — `checkJs: true`, `strict: true`, `module: nodenext`, `target: es2022`, `noEmit: true`. Include `src`, `api`, `public/js`, `scripts`.
- [ ] **Step 4: Contributor docs.**
  - `docs/architecture.md`: copy the "Architecture and code rules" section of this plan (including Extension points), plus the file-structure tree, as the living doc.
  - `CONTRIBUTING.md` skeleton, with these sections:
    - **Setup:** `npm install`, `npm run dev`, `npm test`, `npm run check`.
    - **Workflow:** branch from `main` → small commits → `npm run check && npm test` → pull request using the template. No push to `main` directly once CI exists.
    - **Recipes:** headings only for now; Task 17 fills them in against real code.
    - **Testing conventions:** `test/` mirrors the source tree; domain tests use real fixtures and no mocks; services get injected `deps`; components are tested as strings.
    - **Commit style:** imperative subject ≤ 72 characters, explaining *why* in the body when it isn't obvious.
  - `docs/decisions/0000-template.md` (Context / Decision / Consequences), plus:
    - `0001-plain-js-no-framework.md`
    - `0002-layered-architecture-and-di.md`
    - `0003-two-tweet-sources.md`
    - `0004-migrations-not-schema-edits.md`

    Each one is 5–15 lines, with the reasons taken from the spec.
  - `.github/pull_request_template.md` checklist:
    - [ ] Followed a recipe in CONTRIBUTING.md, or added one.
    - [ ] Layer rules respected (no SQL outside `repo/`, no I/O in `domain/`).
    - [ ] No duplicated rule; constants live in `domain/constants.js`.
    - [ ] Tests added. `npm run check && npm test` pass.
    - [ ] Schema changes are a new migration.
    - [ ] User-facing copy follows the spec (lowercase names, "remove" not "hide").
    - [ ] No secrets, real names, or local paths.
- [ ] **Step 5: `vercel.json` rewrites** — `/e/:slug → /event.html`, `/t/:id → /entry.html`, `/p/:ig → /person.html`, `/tl/:handle → /translator.html`, `/search → /search.html`, `/add → /soon.html`, `/me → /soon.html`.
- [ ] **Step 6: Write the failing test** `test/dev.test.js`

```js
test('dev server applies vercel rewrites and routes /api', async () => {
  const srv = createServer({ root: 'test/fixtures/site', apiDir: 'test/fixtures/api',
    rewrites: [{ source: '/e/:slug', destination: '/event.html' }] });
  const base = await listen(srv); // helper: listen on port 0, return 'http://127.0.0.1:<port>'
  assert.match(await (await fetch(base + '/e/anything')).text(), /EVENT PAGE/);
  assert.deepEqual(await (await fetch(base + '/api/ping?x=1')).json(), { ok: '1' });
  assert.equal((await fetch(base + '/nope.html')).status, 404);
  srv.close();
});
```

- [ ] **Step 7: Run `npm test`. Expected: FAIL** (`createServer` is not defined).
- [ ] **Step 8: Implement `scripts/dev.js`** with `node:http`.
  - Rewrites: turn `:param` into a `[^/]+` regex.
  - `/api/<name>`: `import()` with a `?t=<now>` cache-buster.
  - Add the `res.status`/`res.json` helpers.
  - When run directly: root `public`, apiDir `api`, rewrites from `vercel.json`, bound to `127.0.0.1:3000`.
- [ ] **Step 9: Run `npm test && npm run check`. Expected: PASS.**
- [ ] **Step 10: Video spike.** `scripts/videoCheck.mjs`:
  - Reads `test/fixtures/tweets/2030321729902641632.syn.json` and picks the smallest `video/mp4` variant.
  - Requests it with `Referer: https://example.com/` and `Range: bytes=0-1023`, and prints the status and content-type.
  - Writes `public/video-check.html` containing `<video controls playsinline src=…>`.

  Run it, run `npm run dev`, and open `http://127.0.0.1:3000/video-check.html`. **Expected:** a 200/206 response, and the video plays.
  - Record the result in `docs/video-check.md` (status, whether it played, date).
  - Delete `public/video-check.html`.
  - **If it doesn't play, stop and tell the owner.** The spec's fallback changes Task 14.
- [ ] **Step 11: Commit** — `git add -A && git commit -m "Scaffold with lint/type guardrails, dev server, video check"`

---

### Task 2: Tweet sources

**Files:**
- Create: `src/domain/types.js` (the `Tweet` typedef first; later tasks add theirs), `src/tweets/url.js`, `src/tweets/sources/syndication.js`, `src/tweets/sources/fx.js`, `src/tweets/normalize.js`, `src/tweets/fetchTweet.js`, `test/helpers/fixtures.js`, `test/helpers/fakeFetch.js`, `test/tweets/*.test.js`, `test/fixtures/tweets/tombstone.syn.json`

**Interfaces:**
- Produces:

```js
/** @typedef {{ url: string, bitrate: number, contentType: string }} VideoVariant */
/** @typedef {{
 *   id: string, status: 'live'|'deleted'|'unavailable',
 *   authorId: string|null, authorHandle: string|null, authorName: string|null,
 *   createdAt: string|null, text: string, textSource: 'syndication'|'fx'|null,
 *   video: { variants: VideoVariant[], durationMs: number } | null,
 *   clipSource: { handle: string, url: string } | null,
 *   quotedId: string|null, replyToId: string|null }} Tweet */
```

  - `parseTweetId(input) → string|null`; `extractTweetIds(text) → string[]` (unique, in order of first appearance).
  - `synToken(id) → string`; `fetchSyndication(deps, id) → Promise<object|null>`; `fetchFx(deps, id) → Promise<object|null>`. Each returns `null` on a non-OK response, an error, or a 5 s timeout (`AbortSignal.timeout(5000)`).
  - `normalize(id, syn, fx) → Tweet`, which is pure.
  - `src/tweets/sources/index.js` exports `SOURCES = [{ name: 'syndication', fetch: fetchSyndication }, { name: 'fx', fetch: fetchFx }]`.
  - `fetchTweet(deps, id) → Promise<Tweet>` fetches every registered source in parallel into `{ [name]: json|null }`, then calls `normalize(id, results.syndication, results.fx)`. Adding a source means one new module, one registry line, and one `normalize` rule. Nothing else changes.
  - Test helpers: `fixtures.syn(id)`, `fixtures.fx(id)`, `fixtures.fxText(id)`, and `fakeFetch({ [urlSubstring]: response|null }) → fetchImpl`.

- [ ] **Step 1: Write the failing tests**

```js
test('parseTweetId', () => {
  assert.equal(parseTweetId('https://x.com/vacantvolcanic/status/2021992269596045801'), '2021992269596045801');
  assert.equal(parseTweetId('https://twitter.com/a/status/123?s=20'), '123');
  assert.equal(parseTweetId('https://x.com/phannii_p/status/2108523935654670719/video/1'), '2108523935654670719');
  assert.equal(parseTweetId('2108532547101856124'), '2108532547101856124');
  assert.equal(parseTweetId('https://x.com/vacantvolcanic'), null);
});
test('extractTweetIds from chat text, deduped', () => {
  assert.deepEqual(extractTweetIds('me: https://x.com/a/status/1\nhi\nhttps://x.com/b/status/2 https://twitter.com/a/status/1'), ['1', '2']);
});
test('long post: text from fx', () => {
  const t = normalize('2110438810274414709', syn('2110438810274414709'), fx('2110438810274414709'));
  assert.equal(t.textSource, 'fx');
  assert.ok(t.text.length >= 2400);
  assert.match(t.text, /We hug all the time\./);
  assert.equal(t.quotedId, '2110432579635831075');
  assert.equal(t.authorHandle, 'vacantvolcanic');
});
test('clip from another account', () => {
  const t = normalize('2108532547101856124', syn('2108532547101856124'), fx('2108532547101856124'));
  assert.deepEqual(t.clipSource, { handle: 'phannii_p', url: 'https://x.com/phannii_p/status/2108523935654670719/video/1' });
  assert.ok(t.video.variants.every(v => v.contentType === 'video/mp4'));
  assert.ok(t.video.variants[0].bitrate <= t.video.variants.at(-1).bitrate);
});
test('short post uses syndication', () =>
  assert.equal(normalize('2021992269596045801', syn('2021992269596045801'), fx('2021992269596045801')).textSource, 'syndication'));
test('tombstone → deleted', () => assert.equal(normalize('1', readJson('tombstone.syn.json'), null).status, 'deleted'));
test('nothing → unavailable', () => assert.equal(normalize('1', null, null).status, 'unavailable'));
test('fetchTweet survives fx failure', async () => {
  const fetchImpl = fakeFetch({ syndication: syn('2021992269596045801'), fxtwitter: null });
  assert.equal((await fetchTweet({ fetchImpl }, '2021992269596045801')).status, 'live');
});
```

  `tombstone.syn.json` is `{"__typename":"TweetTombstone","tombstone":{"text":{"text":"This Post was deleted by the Post author."}}}`.

- [ ] **Step 2: Run `npm test`. Expected: FAIL.**
- [ ] **Step 3: Implement.**
  - **Text rule:** use fx `status.text` when syndication has `note_tweet`, or when syndication is null. Otherwise use syndication `text`.
  - Remove only the trailing media `t.co` URL (from `entities.media[].url`).
  - Variants: `mediaDetails[0].video_info.variants`, keeping only mp4, sorted by bitrate ascending.
  - `clipSource` is parsed from `mediaDetails[0].expanded_url`.
- [ ] **Step 4: Run `npm test && npm run check`. Expected: PASS.**
- [ ] **Step 5: Commit** — `git add -A && git commit -m "Tweet sources and normalisation"`

---

### Task 3: Lines and markers

**Files:**
- Create: `src/domain/lines.js`, `test/domain/lines.test.js`
- Modify: `src/domain/types.js` (add `Line`, `Marker`)

**Interfaces:**
- Produces:
  - `isSpeechLine(line: string) → boolean`
  - `splitLines(text) → Line[]`
  - `findMarkers(lines) → Marker[]` (sorted by count descending; `example` = the first text for that marker)

```js
/** @typedef {{kind:'speech', marker:string, text:string} | {kind:'plain', text:string} | {kind:'footnote', mark:string, text:string}} Line */
/** @typedef {{ marker: string, count: number, example: string }} Marker */
```

  **Marker rule:** before the first `:` (within the first 12 characters), the line holds one or more whole emoji grapheme clusters (`Intl.Segmenter`, granularity `grapheme`, each matching `\p{Extended_Pictographic}`), or a 1–3 character label. The text after the colon, minus one optional space, is the speech text.
  - A line starting with `*`/`**` followed by a space is a footnote.
  - A line starting with `:` (empty marker) is **plain**.
  - Blank lines are skipped. Everything else is kept verbatim.

- [ ] **Step 1: Write the failing tests**

```js
test('emoji markers incl. variation selector', () => {
  const lines = splitLines(fxText('2110438810274414709'));
  assert.deepEqual(new Set(findMarkers(lines).map(m => m.marker)), new Set(['🦁', '🌧️', '🦊', '🐰', '🗣️']));
  assert.equal(lines.find(l => l.kind === 'speech' && l.marker === '🦊').text, 'Actually, I like this scene too.');
});
test('footnotes', () => {
  const f = splitLines(fxText('2110438810274414709')).filter(l => l.kind === 'footnote');
  assert.equal(f.length, 2); assert.equal(f[0].mark, '*');
});
test('empty marker line is plain (danaNYB)', () => {
  const lines = splitLines(fxText('2108748780564816034'));
  assert.ok(lines.some(l => l.kind === 'plain' && l.text.startsWith(': Bonnie, mommy')));
  assert.ok(lines.some(l => l.kind === 'speech' && l.marker === '💜'));
});
test('header lines are plain', () => assert.deepEqual(splitLines(fxText('2030321729902641632'))[0], { kind: 'plain', text: 'ANY LOVE EMIBONNIE SESSION D1' }));
test('letter label', () => assert.deepEqual(splitLines('E: hi')[0], { kind: 'speech', marker: 'E', text: 'hi' }));
test('no line lost', () => {
  const t = fxText('2110438810274414709');
  assert.equal(splitLines(t).length, t.split('\n').filter(s => s.trim()).length);
});
```

- [ ] **Step 2: Run `npm test`. Expected: FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm test && npm run check`. Expected: PASS.**
- [ ] **Step 5: Commit** — `git add -A && git commit -m "Split text into speaker lines and markers"`

---

### Task 4: Domain constants and header parsing

**Files:**
- Create: `src/domain/constants.js`, `src/domain/header.js`, `test/domain/header.test.js`
- Modify: `src/domain/types.js` (add `Header`)

**Interfaces:**
- Produces:
  - `constants.js`:
    - `ROLES = ['host','fan','speaker','crowd']`
    - `PLATFORMS = [{ name:'tiktok live', pattern:/tiktok\s*live/i }, { name:'ig live', pattern:/\b(ig|instagram)\s*live/i }, { name:'youtube live', pattern:/youtube\s*live/i }, { name:'x space', pattern:/\b(x|twitter)\s*space/i }]`
    - `LIVE_WINDOW_DAYS = 1`
    - `FIXED_PEOPLE = [{igHandle:'emiamily', displayName:'emi', emoji:'🧡', colour:'#ff8a3d'}, {igHandle:'beonnnie', displayName:'bonnie', emoji:'💜', colour:'#9b6cff'}]`
    - `DEFAULT_MARKERS = {'💜':{personHandle:'beonnnie'}, '🧡':{personHandle:'emiamily'}, '🗣️':{role:'crowd'}, '💬':{role:'fan'}}`
  - `parseHeader(text, { ignoredHashtags, personHandles, postedAt? }) → Header`

```js
/** @typedef {{ keyword: string|null, hashtags: string[], personTags: string[], unknownHandleTags: string[],
 *   live: { platform: string, date: string|null } | null, context: string|null }} Header */
```

  - **Header lines** are those before the first speech line, using `isSpeechLine` from `src/domain/lines.js` (Task 3).
  - **keyword:** the first header line with at least 2 words and at least 70% uppercase letters.
  - **hashtags:** original case, excluding ignored tags and person tags (case-insensitive).
  - **personTags:** lowercase `#tag`s matching `personHandles`.
  - **unknownHandleTags:** lowercase `#tag`s matching `/^[a-z0-9._]{3,30}$/` that aren't person tags or ignored.
  - **live:** the first `PLATFORMS` match. The date comes from `[YYMMDD]`, or `d/m` with the year taken from `postedAt` (current year if missing).
  - **context:** the first header line that starts with `[`.

- [ ] **Step 1: Write the failing tests**

```js
const opts = { ignoredHashtags: ['emibonnie', 'namtanfilm'], personHandles: ['beonnnie', 'emiamily'] };
test('keyword + event hashtag', () => {
  const h = parseHeader(fxText('2108532547101856124'), opts);
  assert.equal(h.keyword, 'EMIBONNIE ANY HAPPY FAMILY');
  assert.deepEqual(h.hashtags, ['#GMMTVFANIVAL2026HappyFamilyxEB']);
});
test('ignored hashtag dropped', () => assert.deepEqual(parseHeader(fxText('2108748780564816034'), opts).hashtags, ['#GMMTVFANIVAL2026HappyFamilyxEB']));
test('live: person tag + platform + [YYMMDD]', () => {
  const h = parseHeader(fxText('2021992269596045801'), opts);
  assert.deepEqual(h.personTags, ['beonnnie']);
  assert.deepEqual(h.live, { platform: 'tiktok live', date: '2026-02-12' });
  assert.equal(h.keyword, null);
});
test('d/m date uses postedAt year', () =>
  assert.equal(parseHeader('bonnie tiktok live 12/2', { ...opts, postedAt: '2026-02-13T01:00:00Z' }).live.date, '2026-02-12'));
test('shared story signals', () => {
  const h = parseHeader(fxText('2003413749940834557'), opts);
  assert.equal(h.keyword, null); assert.equal(h.live, null);
  assert.deepEqual(h.unknownHandleTags, ['michirujjang']);
});
test('context line', () => assert.match(parseHeader(fxText('2030321729902641632'), opts).context, /^\[After "Number One Girl"/));
```

- [ ] **Step 2: Run `npm test`. Expected: FAIL.**
- [ ] **Step 3: Implement.** Keep each concern a separate small function inside `header.js` (`findKeyword`, `splitHashtags`, `detectLive`, `parseLiveDate`), so no function exceeds the lint limits.
- [ ] **Step 4: Run `npm test && npm run check`. Expected: PASS.**
- [ ] **Step 5: Commit** — `git add -A && git commit -m "Domain constants and header parsing"`

---

### Task 5: Speaker resolution

**Files:**
- Create: `src/domain/speakers.js`, `test/domain/speakers.test.js`
- Modify: `src/domain/types.js` (add `Person`, `SpeakerTarget`, `SpeakerMap`)

**Interfaces:**
- Produces:

```js
/** @typedef {{ id: number, igHandle: string, displayName: string, emoji: string, colour: string, extraHashtags: string[], fixed: boolean }} Person */
/** @typedef {{ person: number } | { role: 'host'|'fan'|'speaker'|'crowd' }} SpeakerTarget */
/** @typedef {Record<string, SpeakerTarget>} SpeakerMap */
```

  - `resolveSpeakers({ people, remembered = {}, chosen = {} }) → SpeakerMap`. Layers are applied in order: `DEFAULT_MARKERS` (handles resolved to IDs via `people`), then `remembered`, then `chosen`. Later layers win.
  - `missingMarkers(markers: Marker[], map: SpeakerMap) → Marker[]`
  - `personIdsFrom(map: SpeakerMap, markers: Marker[]) → number[]`: the people actually used in this text, unique and sorted.

  This is the **only** place defaults and memory are combined. Ingest (here), the add flow (Plan 2) and the import mapping (Plan 3) all call it.

- [ ] **Step 1: Write the failing tests**

```js
const people = [{ id: 1, igHandle: 'emiamily' }, { id: 2, igHandle: 'beonnnie' }];
test('defaults, then remembered, then chosen', () => {
  const map = resolveSpeakers({ people, remembered: { '🐰': { person: 2 }, '💜': { role: 'fan' } }, chosen: { '💜': { person: 2 } } });
  assert.deepEqual(map['🧡'], { person: 1 });
  assert.deepEqual(map['🐰'], { person: 2 });
  assert.deepEqual(map['💜'], { person: 2 });
  assert.deepEqual(map['🗣️'], { role: 'crowd' });
});
test('missing markers', () => {
  const m = [{ marker: '🦁', count: 3, example: 'x' }, { marker: '🧡', count: 1, example: 'y' }];
  assert.deepEqual(missingMarkers(m, resolveSpeakers({ people })).map(x => x.marker), ['🦁']);
});
test('personIdsFrom only counts used markers', () => {
  const map = resolveSpeakers({ people });
  assert.deepEqual(personIdsFrom(map, [{ marker: '💜', count: 2, example: '' }]), [2]);
});
```

- [ ] **Step 2: Run `npm test`. Expected: FAIL.** — [ ] **Step 3: Implement.** — [ ] **Step 4: Run `npm test && npm run check`. Expected: PASS.**
- [ ] **Step 5: Commit** — `git add -A && git commit -m "Speaker map resolution"`

---

### Task 6: Event matching

**Files:**
- Create: `src/domain/events.js`, `test/domain/events.test.js`
- Modify: `src/domain/types.js` (add `Event`, `EventProposal`, `EventMatch`)

**Interfaces:**
- Produces:

```js
/** @typedef {{ id: number, slug: string, name: string, date: string, type: string|null, clientMedia: string|null,
 *   keywords: string[], hashtags: string[], livePersonId: number|null, livePlatform: string|null }} Event */
/** @typedef {Omit<Event,'id'|'type'|'clientMedia'>} EventProposal */
/** @typedef {{ match: Event|null, suggestions: Event[], proposal: EventProposal|null, kind: 'event'|'shared_story'|'unsorted' }} EventMatch */
```

  - `normKeyword(s) → string`: lowercase, collapse whitespace, trim.
  - `slugify(s) → string`: lowercase ASCII, with runs of anything else becoming `-`.
  - `matchEvent({ header, postedAt, events, people }) → EventMatch`. Rules in order:
    1. A keyword (normalised) or hashtag (case-insensitive) match.
    2. A live with exactly one person tag: same `livePersonId` + `livePlatform`, and `|date − liveDate| ≤ LIVE_WINDOW_DAYS`.
    3. No match: build a proposal (via `proposeEvent`) when there's a keyword, an event hashtag, or a live. Otherwise the kind is `'shared_story'` if there are `unknownHandleTags`, else `'unsorted'`.
    4. `suggestions`: events within ±`LIVE_WINDOW_DAYS` of the entry date, excluding the match, newest first, at most 5.
  - `proposeEvent({ header, postedAt, people }) → EventProposal|null`. Name = keyword, or `"<displayName> <platform>"`. Date = live date, or the posted date (UTC day). Slug = `${slugify(name)}-${date}`.

- [ ] **Step 1: Write the failing tests**

```js
const efm = ev({ id: 1, name: 'EMIBONNIE AT EFM', keywords: ['EMIBONNIE AT EFM'], hashtags: ['#EmiBonniexFANDOMLIVE'], date: '2025-05-15' });
const live = ev({ id: 2, name: 'bonnie tiktok live', livePersonId: 2, livePlatform: 'tiktok live', date: '2026-02-12' });
const people = [{ id: 1, igHandle: 'emiamily', displayName: 'emi' }, { id: 2, igHandle: 'beonnnie', displayName: 'bonnie' }];
const h = (o) => ({ keyword: null, hashtags: [], personTags: [], unknownHandleTags: [], live: null, context: null, ...o });
test('keyword match ignores case/spacing', () =>
  assert.equal(matchEvent({ header: h({ keyword: 'emibonnie  at efm ' }), postedAt: '2025-05-16T00:00:00Z', events: [efm, live], people }).match.id, 1));
test('nothing to go on → unsorted', () =>
  assert.equal(matchEvent({ header: h({}), postedAt: '2025-05-15T00:00:00Z', events: [efm], people }).kind, 'unsorted'));
test('live within a day matches; beyond proposes new', () => {
  const near = h({ personTags: ['beonnnie'], live: { platform: 'tiktok live', date: '2026-02-13' } });
  assert.equal(matchEvent({ header: near, postedAt: '2026-02-13T10:00:00Z', events: [live], people }).match.id, 2);
  const far = h({ personTags: ['beonnnie'], live: { platform: 'tiktok live', date: '2026-02-15' } });
  assert.deepEqual(matchEvent({ header: far, postedAt: '2026-02-15T10:00:00Z', events: [live], people }).proposal,
    { slug: 'bonnie-tiktok-live-2026-02-15', name: 'bonnie tiktok live', date: '2026-02-15', keywords: [], hashtags: [], livePersonId: 2, livePlatform: 'tiktok live' });
});
test('shared story', () =>
  assert.equal(matchEvent({ header: h({ unknownHandleTags: ['michirujjang'] }), postedAt: '2025-12-23T10:33:54Z', events: [efm], people }).kind, 'shared_story'));
```

- [ ] **Step 2: Run `npm test`. Expected: FAIL.** — [ ] **Step 3: Implement.** — [ ] **Step 4: Run `npm test && npm run check`. Expected: PASS.**
- [ ] **Step 5: Commit** — `git add -A && git commit -m "Event matching and proposals"`

---

### Task 7: Drafting an entry (the pure interpretation)

**Files:**
- Create: `src/domain/draft.js`, `test/domain/draft.test.js`
- Modify: `src/domain/types.js` (add `DraftContext`, `Draft`)

**Interfaces:**
- Consumes: Tasks 3–6 (`splitLines`/`findMarkers`, `parseHeader`, `resolveSpeakers`, `matchEvent`/`proposeEvent`).
- Produces:

```js
/** @typedef {{ people: Person[], events: Event[], ignoredHashtags: string[],
 *   remembered: SpeakerMap, chosen?: SpeakerMap,
 *   overrides?: { kind?: 'event'|'shared_story', eventId?: number, newEvent?: boolean, type?: string, clientMedia?: string } }} DraftContext */
/** @typedef {{ tweet: Tweet, header: Header, lines: Line[], markers: Marker[], speakerMap: SpeakerMap, missing: Marker[],
 *   kind: 'event'|'shared_story'|'unsorted', eventMatch: EventMatch, eventId: number|null, proposal: EventProposal|null,
 *   type: string|null, clientMedia: string|null, personIds: number[], sharingPersonId: number|null, aboutPersonIds: number[] }} Draft */
```

  `draftEntry(tweet, ctx) → Draft` is pure. It is everything that decides what an entry *is*, in one function. Ingest persists a Draft; Plan 2's add flow shows a Draft as its preview (steps 2 and 3) and re-drafts as the user changes choices. Rules:
  - Person handles for `parseHeader` = each person's `igHandle` plus their `extraHashtags`.
  - **Overrides:**
    - `overrides.kind` replaces the matched kind.
    - `overrides.eventId` forces that event.
    - `overrides.newEvent` forces `proposal = proposeEvent(...)` with `eventId = null` (this is "＋ this is a separate event").
  - **When `kind === 'shared_story'`:** `type = 'shared story'`, `eventId = null`, `proposal = null`. `sharingPersonId` = the person whose handle matches the first of `personTags`/`unknownHandleTags`, if they exist. `aboutPersonIds` = `personIds` minus `sharingPersonId`.
  - `type` = `overrides.type`, else the matched event's type.

- [ ] **Step 1: Write the failing tests** (use `normalize` on fixtures to get `Tweet`s; `ctx` built inline)
  - The Moonshadow tweet with an empty `remembered` has `missing` markers `🦁 🌧️ 🦊 🐰` and `kind` `'event'`, with a proposal named `'LOVE TO THE MOON AND KEY'`.
  - The same tweet with `chosen` covering all markers has `missing.length === 0` and `personIds` containing emi and bonnie.
  - The @danaNYB tweet with `events: [happyFamily]` has `eventId === happyFamily.id` and `missing.length === 0`.
  - The Starlympics tweet with `chosen {'🪇': {role:'speaker'}}` has `kind 'shared_story'`, `type 'shared story'`, and `eventId null`.
  - `overrides.newEvent` on the @danaNYB tweet gives `eventId null` and a non-null proposal.
- [ ] **Step 2: Run `npm test`. Expected: FAIL.** — [ ] **Step 3: Implement** as a short pipeline of the earlier functions. Helpers stay private to the module. — [ ] **Step 4: Run `npm test && npm run check`. Expected: PASS.**
- [ ] **Step 5: Commit** — `git add -A && git commit -m "draftEntry: pure interpretation of a tweet"`

---

### Task 8: Database and repositories

**Files:**
- Create: `src/db/migrations/001_initial.sql`, `src/db/client.js`, `src/db/migrate.js`, `src/repo/visibility.js`, `src/repo/rows.js`, `src/repo/people.js`, `src/repo/translators.js`, `src/repo/events.js`, `src/repo/entries.js`, `src/repo/speakerMemory.js`, `src/repo/settings.js`, `src/deps.js`, `test/helpers/db.js`, `test/repo/*.test.js`

**Interfaces:**
- Produces:
  - `createDb({ url?, dir? }) → Db`, where `Db = { query(sql, params?) → Promise<{rows}> }`.
    - With `url`: `@neondatabase/serverless` `Pool`.
    - Otherwise: PGlite (`dir` for a persistent folder, in-memory when omitted), with `pg_trgm` from `@electric-sql/pglite/contrib/pg_trgm`.
  - `migrate(db, { dir = 'src/db/migrations' } = {}) → string[]` (the names applied).
    - Creates `schema_migrations(name text primary key, applied_at timestamptz default now())`.
    - Applies each `NNN_*.sql` file not yet recorded, in filename order, one transaction per file.
    - Running it again applies nothing.
    - The CLI reads `DATABASE_URL` and prints the applied names, or `up to date`.
  - `src/deps.js`: `defaultDeps() → { db: createDb({ url: process.env.DATABASE_URL, dir: process.env.PGLITE_DIR }), fetchImpl: fetch, now: () => new Date() }`, with `db` created once per process.
  - `visibility.js`: `export const visibleEntry = (alias = 'e') => \`${alias}.removed_at is null and not exists (select 1 from translators t where t.x_user_id = ${alias}.translator_id and t.opted_out_at is not null)\``. Every read in `entries.js`, `events.js` and `search.js` that returns entries or counts uses it.
  - `rows.js`: `camel(row) → object` (`snake_case` keys become camelCase).
  - **Repositories:** every function takes `db` first and returns camelCase domain objects.
    - `people`: `listPeople(db)`, `addPerson(db, {igHandle, displayName, emoji, colour}) → Person` (lowercases the handle, strips `@`, lowercases the name), `getPersonByHandle(db, ig)`
    - `translators`: `upsertTranslator(db, {xUserId, handle, displayName})`, `getTranslator(db, xUserId)`, `getTranslatorByHandle(db, handle)`
    - `events`: `listEvents(db)`, `createEvent(db, proposal, createdBy) → Event`, `getEventBySlug(db, slug)`, `listEventsWithCounts(db) → (Event & {count})[]` (visible entries only, count > 0)
    - `entries`: `entryExists(db, tweetId) → 'none'|'visible'|'removed'`, `insertEntry(db, row)`, `getVisibleEntry(db, tweetId)`, `listVisibleByEvent(db, eventId)`, `listVisibleByPerson(db, personId)`, `listVisibleByTranslator(db, xUserId)`, `neighbours(db, entry) → {prev, next}`
    - `speakerMemory`: `recall(db, translatorId) → SpeakerMap`, `remember(db, translatorId, map)`
    - `settings`: `ignoredHashtags(db) → string[]`, `types(db) → string[]`

  **`001_initial.sql`:** as below. Later plans add `002_…`, `003_…`; they never edit this file.

```sql
create extension if not exists pg_trgm;
create table if not exists people (
  id serial primary key, ig_handle text unique not null check (ig_handle = lower(ig_handle)),
  display_name text not null check (display_name = lower(display_name)),
  emoji text not null, colour text not null, extra_hashtags text[] not null default '{}', fixed boolean not null default false);
create table if not exists translators (
  x_user_id text primary key, handle text not null, display_name text, opted_out_at timestamptz);
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
  speaker_map jsonb not null default '{}',
  sharing_person_id int references people(id), about_person_ids int[] not null default '{}', person_ids int[] not null default '{}',
  added_by text not null, source text not null check (source in ('submit','notion','paste','cli')),
  text_entered_manually boolean not null default false,
  tweet_status text not null default 'live' check (tweet_status in ('live','deleted','unavailable')),
  status_checked_at timestamptz, removed_by text check (removed_by in ('translator','owner')), removed_at timestamptz,
  event_order int, created_at timestamptz not null default now(),
  search tsvector generated always as (to_tsvector('simple', coalesce(keyword,'') || ' ' || text)) stored);
create index if not exists entries_text_trgm on entries using gin (text gin_trgm_ops);
create index if not exists entries_search on entries using gin (search);
create index if not exists entries_event on entries (event_id);
create index if not exists entries_people on entries using gin (person_ids);
create table if not exists speaker_memory (
  translator_id text not null references translators(x_user_id), marker text not null, mapping jsonb not null,
  primary key (translator_id, marker));
create table if not exists ignored_hashtags (tag text primary key check (tag = lower(tag)));
create table if not exists types (name text primary key);
insert into people (ig_handle, display_name, emoji, colour, fixed) values
  ('emiamily','emi','🧡','#ff8a3d',true), ('beonnnie','bonnie','💜','#9b6cff',true) on conflict do nothing;
insert into ignored_hashtags values ('emibonnie') on conflict do nothing;
insert into types values ('show / interview'),('fan meet / fan day'),('live'),('shared story') on conflict do nothing;
```

- [ ] **Step 1: Write the failing tests** (one file per repo, each using `freshDb()` from `test/helpers/db.js`)
  - `listPeople` returns emi and bonnie.
  - `addPerson` with `displayName 'Leo'` and `igHandle '@Leo_X'` stores `'leo'` and `'leo_x'`.
  - A raw insert with an uppercase name throws.
  - `migrate` applies `['001_initial.sql']` the first time and `[]` the second.
  - With a temp dir holding `001_a.sql` + `002_b.sql`, `migrate` applies both in order. Adding `003_c.sql` then applies only that one.
  - `entryExists` returns `'none' → 'visible' → 'removed'` across insert and then `update … set removed_at`.
  - **Visibility:** an opted-out translator's entry is missing from `listVisibleByEvent` and from `listEventsWithCounts` counts.
  - `remember` then `recall` round-trips a map.
- [ ] **Step 2: Run `npm test`. Expected: FAIL.** — [ ] **Step 3: Implement.** — [ ] **Step 4: Run `npm test && npm run check`. Expected: PASS.**
- [ ] **Step 5: Commit** — `git add -A && git commit -m "Database schema and repositories"`

---

### Task 9: Ingest service and owner CLI

**Files:**
- Create: `src/services/ingest.js`, `scripts/add.js`, `test/services/ingest.test.js`

**Interfaces:**
- Consumes: `fetchTweet`, `draftEntry`, `resolveSpeakers` (via draft), the repositories.
- Produces: `ingestTweet(deps, input: string|Tweet, { chosen?, overrides?, addedBy, source }) → Promise<IngestResult>`

```js
/** @typedef {{ status: 'added'|'duplicate'|'removed'|'opted_out'|'deleted'|'unavailable'|'needs_speakers',
 *   tweetId: string, eventId?: number|null, missing?: Marker[], draft?: Draft }} IngestResult */
```

  **Flow** (each step is a small private function; `ingestTweet` reads as the list):
  1. `entryExists` → **duplicate** / **removed**.
  2. `fetchTweet`, unless a `Tweet` was passed → **deleted** / **unavailable**.
  3. The translator has opted out → **opted_out**.
  4. Load the context (people, events, ignored hashtags, `recall`), then `draftEntry`.
  5. `draft.missing.length` → **needs_speakers**, with `missing` and `draft`.
  6. Create the event from `draft.proposal` if one is needed.
  7. `upsertTranslator`, then `insertEntry` (map the Draft to a row in one function, `toEntryRow(draft, meta)`), then `remember`.
  8. **added**.

  `scripts/add.js <url|id> [--map '🐰=beonnnie,🦊=emiamily,🦁=role:host'] [--shared-story] [--event <slug>] [--new-event]`:
  - Parses arguments, resolves handles to IDs, calls `ingestTweet(defaultDeps(), …, { addedBy: 'owner-cli', source: 'cli' })`, and prints the result.
  - On `needs_speakers` it prints each missing marker (count + example) and exits with code 2.
  - It contains no business logic.

- [ ] **Step 1: Write the failing tests** (`deps = { db: await freshDb(), fetchImpl: fakeFetch(fixture routes), now: () => new Date('2026-10-21') }`)

```js
test('needs speakers, then added with a map; memory carries to the next tweet', async () => {
  let r = await ingestTweet(deps, '2110438810274414709', { addedBy: 't', source: 'cli' });
  assert.equal(r.status, 'needs_speakers');
  const leo = await addPerson(deps.db, { igHandle: 'leo_test', displayName: 'leo', emoji: '🦁', colour: '#2fa89a' });
  const chosen = { '🐰': { person: 2 }, '🦊': { person: 1 }, '🦁': { person: leo.id }, '🌧️': { role: 'speaker' } };
  assert.equal((await ingestTweet(deps, '2110438810274414709', { chosen, addedBy: 't', source: 'cli' })).status, 'added');
  r = await ingestTweet(deps, '2021992269596045801', { addedBy: 't', source: 'cli' });
  assert.ok(!(r.missing ?? []).some(m => m.marker === '🐰'));
});
test('two translators land in one event', async () => {
  await ingestTweet(deps, '2108532547101856124', { addedBy: 't', source: 'cli' });
  assert.equal((await ingestTweet(deps, '2108748780564816034', { addedBy: 't', source: 'cli' })).status, 'added');
  const { rows } = await deps.db.query('select count(distinct event_id)::int n from entries');
  assert.equal(rows[0].n, 1);
});
test('duplicate / removed / opted out', async () => { /* each as described in the flow */ });
test('shared story persisted with no event', async () => { /* 2003413749940834557, chosen {'🪇':{role:'speaker'}} → kind shared_story, event_id null, type 'shared story' */ });
```

- [ ] **Step 2: Run `npm test`. Expected: FAIL.** — [ ] **Step 3: Implement.** — [ ] **Step 4: Run `npm test && npm run check`. Expected: PASS.**
- [ ] **Step 5: Commit** — `git add -A && git commit -m "Ingest service and owner add CLI"`

---

### Task 10: Presenters

**Files:**
- Create: `src/services/views.js`, `test/services/views.test.js`

**Interfaces:**
- Consumes: `splitLines`, `Person`.
- Produces (pure; turns stored entries into the JSON shapes the API returns, so handlers stay thin):
  - `toPreview(entry, peopleById) → Preview`
    - `Preview = { tweetId, preview: string[], personIds, translatorHandle, hasVideo, followsOnFrom }`
    - `preview` = the first 2 speech lines as `"<emoji> <text>"`, using the standard emoji for mapped people and the marker otherwise. With no speech lines, it's the first 2 non-header plain lines.
  - `toEntryView(entry, peopleById) → { …public entry fields, lines: Line[], cast: CastItem[] }`
    - `CastItem = { kind:'person', id, displayName, emoji, colour } | { kind:'role', role, marker }`, in first-appearance order, crowd excluded.
  - `groupByEvent(entries, eventsById) → [{ event: Event|null, kind, entries: Preview[] }]`
- [ ] **Step 1: Write the failing tests:**
  - The Moonshadow preview starts with `'🦁 What impressed you abt this scene?'` when leo's emoji is 🦁.
  - A person-mapped `🦊` line shows `🧡` in the preview.
  - The cast for Moonshadow is `[leo, speaker(🌧️), emi, bonnie]` in order of first appearance, with no crowd.
  - `groupByEvent` puts shared stories in their own group with `event: null`.
- [ ] **Step 2: Run `npm test`. Expected: FAIL.** — [ ] **Step 3: Implement.** — [ ] **Step 4: Run `npm test && npm run check`. Expected: PASS.**
- [ ] **Step 5: Commit** — `git add -A && git commit -m "Presenters for API shapes"`

---

### Task 11: Search service

**Files:**
- Create: `src/services/search.js`, `test/services/search.test.js`

**Interfaces:**
- Produces: `search(deps, { q = '', people = [], peopleMode = 'any', types = [], eventSlug, translatorHandle, clientMedia, from, to, limit = 50, offset = 0 }) → Promise<{ count, results: Result[] }>`
  - `Result = { tweetId, event: {slug,name,date}|null, kind, postedAt, translatorHandle, personIds, matchLines: string[] }`
  - Built from small clause builders (`textClause`, `peopleClause`, …), each returning `{ sql, params }` and combined by one `buildWhere(filters)`. It **always** includes `visibleEntry('e')`.
  - Text matching: `e.text ilike '%'||$n||'%' or e.search @@ plainto_tsquery('simple', $n)`.
  - People: `peopleMode 'all'` uses `@>`; `'any'` uses `&&`.
  - `matchLines`: up to 2 lines containing `q` (case-insensitive). With no `q`, the first 2 speech lines.
  - `limit = 0` returns the count only (used for the "show N" button).
- [ ] **Step 1: Write the failing tests** (seed by ingesting all 6 fixtures with full maps)

```js
test('English word', async () => assert.ok((await search(deps, { q: 'hug' })).results.some(r => r.tweetId === '2110438810274414709')));
test('Thai substring', async () => {
  const r = await search(deps, { q: 'ครบ' });
  assert.equal(r.results[0].tweetId, '2110438810274414709');
  assert.match(r.results[0].matchLines[0], /ครบ/);
});
test('all-of narrows any-of', async () => {
  const any = await search(deps, { people: [1, 2], peopleMode: 'any' }), all = await search(deps, { people: [1, 2], peopleMode: 'all' });
  assert.ok(all.count > 0 && all.count <= any.count);
});
test('shared story type', async () => assert.deepEqual((await search(deps, { types: ['shared story'] })).results.map(r => r.tweetId), ['2003413749940834557']));
test('count only', async () => { const r = await search(deps, { q: 'hug', limit: 0 }); assert.ok(r.count > 0); assert.equal(r.results.length, 0); });
test('removed and opted-out never appear', async () => { /* set removed_at on Moonshadow → absent for 'hug'; opt out SugarHoneyz13 → absent from {} */ });
test('SQL injection-shaped q is literal', async () => assert.equal((await search(deps, { q: "'; drop table entries; --" })).count, 0));
```

- [ ] **Step 2: Run `npm test`. Expected: FAIL.** — [ ] **Step 3: Implement.** — [ ] **Step 4: Run `npm test && npm run check`. Expected: PASS.**
- [ ] **Step 5: Commit** — `git add -A && git commit -m "Search service"`

---

### Task 12: HTTP layer and public API

**Files:**
- Create: `src/http/handler.js`, `src/http/errors.js`, `src/http/query.js`, `api/home.js`, `api/event.js`, `api/entry.js`, `api/search.js`, `api/person.js`, `api/translator.js`, `api/video.js`, `test/api/*.test.js`

**Interfaces:**
- Produces:
  - `handler(run, { cache = 'no-store' } = {}) → (req, res)`. It calls `run({ query: req.query }, defaultDeps())`. A `NotFound` becomes 404 `{error:'not_found'}`, a `BadRequest` becomes 400, and anything else becomes 500 `{error:'server_error'}` with the error logged. On success: 200 JSON with the `Cache-Control` header.
  - `query.js`: `str(q, name)`, `int(q, name)`, `list(q, name)` (comma-separated), `ints(q, name)`.
  - Each `api/*.js` file has `export async function run({ query }, deps)` and `export default handler(run, {...})`. **Each `run` stays under 30 lines:** parse input, call repos/services/presenters, return. No SQL.
  - **Endpoints and response shapes:**
    - `home`: `{ months: [{ month:'YYYY-MM', events:[{slug,name,date,hashtag,count}] }] }`. Cache `s-maxage=60`.
    - `event?slug=`: `{ event, translatorCount, entries: Preview[] }`. 404 if not found.
    - `entry?id=`: `toEntryView(...) & { prev, next }`. 404 if missing or removed.
    - `search?…`: the `search()` output.
    - `person?ig=`: `{ person, counts:{translations,events,sharedStories}, groups }`
    - `translator?handle=`: `{ translator:{handle, optedOut}, counts?, groups? }`. When opted out, it returns only `{ translator: { handle, optedOut: true } }`.
    - `video?id=`: `{ variants }` from `fetchTweet`. 404 unless the tweet is live and has a video. Cache `s-maxage=600`.
- [ ] **Step 1: Write the failing tests.** Call `run(...)` directly with test deps; no HTTP needed. Add one `handler` test with a fake `res`, checking that a 404 and a 500 map correctly.
  - `home` groups the October 2026 events under `'2026-10'`.
  - `entry` for a removed tweet throws `NotFound`.
  - `translator` for an opted-out handle returns only the opted-out shape.
  - `video` for a tombstoned tweet throws `NotFound`.
- [ ] **Step 2: Run `npm test`. Expected: FAIL.** — [ ] **Step 3: Implement.** — [ ] **Step 4: Run `npm test && npm run check`. Expected: PASS.**
- [ ] **Step 5: Commit** — `git add -A && git commit -m "HTTP layer and public API"`

---

### Task 13: Front-end core and components

**Files:**
- Create:
  - `public/css/tokens.css`, `layout.css`, `cards.css`, `bubbles.css`, `search.css`
  - `public/js/core/esc.js`, `api.js`, `dom.js`, `format.js`
  - `public/js/components/header.js`, `tabBar.js`, `bubbles.js`, `cast.js`, `eventCard.js`, `previewCard.js`, `resultCard.js`, `chips.js`, `personHeader.js`
  - `test/components/*.test.js`

**Interfaces:**
- Produces:
  - **core:**
    - `esc(s) → string` (escapes `& < > " '`).
    - `getJson(path, params?) → Promise<any>`: builds the query string, throws an `ApiError{status}` on a non-OK response.
    - `mount(el, html)` and `on(el, selector, event, fn)` for delegated events.
    - `monthLabel('2026-10') → 'october 2026'`, `dayLabel('2026-10-14') → '14 Oct 2026'`.
  - **components:** each exports `render(props) → string`. It's pure and escapes every interpolated value. Components never fetch.
    - `header.render({ compact })` and `tabBar.render({ active })`.
    - `bubbles.render({ lines, speakerMap, peopleById })`:
      - A person line becomes a `.msg` with their standard emoji, lowercase name, and `style="--c:<colour>"`.
      - A role line keeps the marker and uses the role name.
      - Crowd becomes `.crowd`.
      - Same speaker consecutively becomes `.msg.cont`.
      - Plain lines become `.plain`, and footnotes are collected into `.notes` at the end.
    - `cast.render({ cast })`, `eventCard.render(ev)`, `previewCard.render({ preview, peopleById })`.
    - `resultCard.render({ result, q, peopleById })`: escape first, then wrap case-insensitive `q` matches in `<mark>`.
    - `chips.render({ items, removable })` and `personHeader.render({ person, counts })`.
  - **CSS:**
    - `tokens.css` holds the custom properties, including a `prefers-color-scheme: dark` override (keep contrast ≥ 4.5:1).
    - Each other stylesheet styles one area. Components use classes only, no inline styles except `--c`.
- [ ] **Step 1: Write the failing tests**

```js
test('esc', () => assert.equal(esc(`<b a="x">&'`), '&lt;b a=&quot;x&quot;&gt;&amp;&#39;'));
test('bubbles: standard emoji, lowercase names, continuation, crowd, escaping', () => {
  const html = bubbles.render({ lines: splitLines('🦊: hi\n🦊: again\n🗣️: (cheering)\n🐰: <script>x</script>'),
    speakerMap: { '🦊': { person: 1 }, '🐰': { person: 2 }, '🗣️': { role: 'crowd' } }, peopleById });
  assert.match(html, /🧡/); assert.doesNotMatch(html, /🦊/); assert.match(html, />emi</);
  assert.equal((html.match(/class="msg cont"/g) || []).length, 1);
  assert.match(html, /class="crowd"/);
  assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>/);
});
test('role keeps translator emoji', () => assert.match(bubbles.render({ lines: splitLines('🌧️: hello'), speakerMap: { '🌧️': { role: 'speaker' } }, peopleById }), /🌧️[\s\S]*speaker/));
test('plain + footnotes verbatim', () => {
  const html = bubbles.render({ lines: splitLines(': Bonnie, mommy has sth\n* note one'), speakerMap: {}, peopleById });
  assert.match(html, /class="plain">: Bonnie, mommy has sth</); assert.match(html, /class="notes"[\s\S]*\* note one/);
});
test('highlight escapes first', () =>
  assert.match(resultCard.render({ result: { matchLines: ['a <hug> b'], event: null, personIds: [] }, q: 'hug', peopleById }), /&lt;<mark>hug<\/mark>&gt;/));
test('header has wordmark and FAN-MADE', () => { const h = header.render({ compact: false }); assert.match(h, /emibonnie/); assert.match(h, /FAN-MADE/); });
```

  `splitLines` is imported from `src/domain/lines.js` in tests only. The browser receives `lines` from the API.

- [ ] **Step 2: Run `npm test`. Expected: FAIL.** — [ ] **Step 3: Implement**, matching `docs/superpowers/specs/mockups/screens-v2.html`, `speaker-style-v2.html` and `search-v2.html`. — [ ] **Step 4: Run `npm test && npm run check`. Expected: PASS.**
- [ ] **Step 5: Commit** — `git add -A && git commit -m "Front-end core, components, and styles"`

---

### Task 14: Home, event, and translation pages

**Files:**
- Create: `public/index.html`, `event.html`, `entry.html`, `soon.html` (finalise), `public/js/components/videoPlayer.js`, `public/js/pages/home.js`, `event.js`, `entry.js`, `scripts/seedDev.js`, `test/components/videoPlayer.test.js`

**Interfaces:**
- Consumes: the API (Task 12) and components (Task 13).
- Produces:
  - `videoPlayer.render({ tweetId })` gives the placeholder markup.
  - `videoPlayer.pickVariant(variants, isSmall) → VideoVariant`: the smallest when `isSmall`, otherwise the largest at or below 2,200,000 bps (or the smallest if none qualify).
  - `videoPlayer.bind(el, { tweetId })` fetches `/api/video`, sets the `<video>` source, and on a 404 or `error` swaps in the note "Original tweet is no longer available. Translation kept below."
  - Each page module exports `start()`. It reads the URL, calls `getJson`, composes components with `mount`, and binds interactions. No HTML strings are built in page modules.
- [ ] **Step 1: Write the failing test** for `pickVariant` (variants at 632k / 950k / 2176k / 10368k: `isSmall` gives 632k; large gives 2176k).
- [ ] **Step 2: Run `npm test`. Expected: FAIL.** — [ ] **Step 3: Implement `videoPlayer`, then run `npm test`. Expected: PASS.**
- [ ] **Step 4: `scripts/seedDev.js`.**
  - With `PGLITE_DIR=.devdb` (add `.devdb/` to `.gitignore`), it migrates and ingests the 6 fixtures offline through `fakeFetch`, with full maps.
  - Leo is added with `igHandle 'leo_placeholder'`; ask the owner for leo's real handle and replace it.
  - `npm run dev` sets `PGLITE_DIR=.devdb` when `DATABASE_URL` is unset.
  - Run `node scripts/seedDev.js`. **Expected:** `seeded 6`.
- [ ] **Step 5: Pages.**
  - **Home:**
    - Header, then the search box (goes to `/search`) and filter icon (goes to `/search?filters=1`).
    - Month groups via `monthLabel`, with event cards linking to `/e/<slug>`.
  - **Event:**
    - Back link and name. Meta line: `dayLabel · N translations · M translators`.
    - Pills, then people chips and a translator filter (client side), with a search icon linking to `/search?event=<slug>`.
    - Preview cards link to `/t/<id>`. "newest first" toggle. Report goes to `/soon.html`.
  - **Translation:**
    - **Under 860px:** the `.vid` is sticky at the top.
    - **860px and wider:** a two-column grid with the sticky video and "‹ previous in event / next in event ›" on the left; credits (`tl @handle · clip by @source · date`), pills, cast and bubbles on the right.
    - Footer: original tweet, original media, follows on from, added by, Copy link, Report (goes to `/soon.html`).
    - "show original" toggles a `<pre>` with the escaped verbatim text.
- [ ] **Step 6: Check in the browser** with `npm run dev`, at 390px and 1280px wide. Use the `run` or `browse` skill to take screenshots, and attach them to the task report next to `mockups/screens-v2.html`. **Expected:**
  - Home is grouped by month.
  - Event, then entry, shows bubbles with 🧡/💜.
  - The video stays put while the text scrolls.
  - Moonshadow shows "🌧️ speaker".
  - `npm run check` passes.
- [ ] **Step 7: Commit** — `git add -A && git commit -m "Home, event, and translation pages"`

---

### Task 15: Search page

**Files:**
- Create: `public/search.html`, `public/js/state/searchState.js`, `public/js/components/filterSheet.js`, `public/js/pages/search.js`, `test/state/searchState.test.js`, `test/components/filterSheet.test.js`

**Interfaces:**
- Produces:
  - `searchState.js`: `parseState(URLSearchParams) → State`, `toQuery(State) → string`, `filterCount(State) → number` (excludes `q`), `withFilter(State, key, value) → State`, and `withoutFilter(State, key, value) → State` (immutable).
    - `State = { q, people:number[], peopleMode:'any'|'all', types:string[], event, translator, client, from, to }`.
    - **The URL is the single source of truth.** Scoped search is just a link (`/search?people=2`, `?translator=vacantvolcanic`, `?event=<slug>`).
  - `filterSheet.render({ state, people, types, events, translators, count })`: "who's in it" chips with the any-of/all-of switch, type chips, event/translator/client/date selects, and the "show N translations" button. `filterSheet.bind(el, { state, onChange })`.
- [ ] **Step 1: Write the failing tests:**
  - **searchState:** a round trip; empty values omitted; `filterCount({people:[2], types:['live']}) === 2`; `withoutFilter` removes just one value; `peopleMode` defaults to `'any'`.
  - **filterSheet:** renders `show 3 translations` for `count: 3`, and marks selected chips with `.on`.
- [ ] **Step 2: Run `npm test`. Expected: FAIL.** — [ ] **Step 3: Implement**, then the page:
  - The box is autofocused, with the filter icon and a count badge next to it.
  - Active filters show as removable chips, plus "clear all".
  - **Empty state:** recent searches (`localStorage` behind try/catch, last 8) and quick chips for people and types.
  - Changes update the URL with `history.replaceState`, then re-fetch.
  - The sheet's count uses `/api/search?…&limit=0`.
  - Person, translator and event pages get a search icon linking to their scoped URL.
- [ ] **Step 4: Run `npm test && npm run check`. Expected: PASS. Then check in the browser:**
  - `/search?q=ครบ` finds Moonshadow.
  - Picking bonnie + live shows a `2` badge.
  - Removing a chip updates both the URL and the results.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "Search page with filter sheet and scoped search"`

---

### Task 16: Person and translator pages

**Files:**
- Create: `public/person.html`, `public/translator.html`, `public/js/pages/person.js`, `public/js/pages/translator.js`

- [ ] **Step 1: Person page.**
  - `personHeader` component (emoji, lowercase name, `@ig`, counts, tinted in their colour).
  - A segmented control: by event / all, newest / with… ("with…" picks a person and goes to `/search?people=<this>,<other>&peopleMode=all`).
  - Groups via previews, with shared stories labelled "shared story · date".
  - A search icon linking to `/search?people=<id>`.
- [ ] **Step 2: Translator page.**
  - Handle, "open profile ↗" linking to `https://x.com/<handle>`, totals, and groups.
  - When the translator has opted out, it shows only "this translator has opted out".
- [ ] **Step 3: Check in the browser.**
  - `/p/beonnnie` lists the Moonshadow, TikTok live and shared-story entries.
  - `/tl/vacantvolcanic` shows 4 entries.
  - After opting out `danaNYB` in `.devdb`, `/tl/danaNYB` shows only the opted-out line, and the HAPPY FAMILY event counts 1.
  - `npm run check` passes.
- [ ] **Step 4: Commit** — `git add -A && git commit -m "Person and translator pages"`

---

### Task 17: Contributor framework: scaffolder and recipes

**Files:**
- Create: `scripts/new.js`, `scripts/templates/{endpoint,page,component,repo,service,domain,migration}/…`, `test/scripts/new.test.js`
- Modify: `CONTRIBUTING.md` (fill in the recipes), `package.json` (add `"new": "node scripts/new.js"`), `docs/architecture.md` (if anything drifted)

**Interfaces:**
- Produces: `scaffold({ kind, name, root = '.' }) → string[]` (the paths created), plus a CLI `npm run new <kind> <name>`.
  - **Kinds and what they create:**
    - `endpoint`: `api/<name>.js` + `test/api/<name>.test.js`
    - `page`: `public/<name>.html` + `public/js/pages/<name>.js` + a rewrite hint printed (not auto-edited)
    - `component`: `public/js/components/<name>.js` + `test/components/<name>.test.js`
    - `repo`: `src/repo/<name>.js` + `test/repo/<name>.test.js`
    - `service`: `src/services/<name>.js` + `test/services/<name>.test.js`
    - `domain`: `src/domain/<name>.js` + `test/domain/<name>.test.js`
    - `migration`: `src/db/migrations/<next NNN>_<name>.sql` (no test)
  - **Name rules:** `name` must match `^[a-z][a-zA-Z0-9]*$`, or `^[a-z0-9_]+$` for migrations. Refuse to overwrite an existing file. Exit with code 1 and a message on any violation.
  - **Templates** are real, minimal, passing examples of each pattern: `// @ts-check`, the right imports, `handler(run)`, `render(props)` with `esc`, `deps` first, and a test that runs green. Placeholders are `__name__` and `__Name__`.
- [ ] **Step 1: Write the failing tests** (in a temp dir: copy `scripts/templates`, `src/http`, `src/deps.js`, `public/js/core`, and whatever the templates import)
  - `scaffold({kind:'component', name:'badge'})` creates the two files, and the component file contains `export function render(`.
  - `scaffold({kind:'migration', name:'add_reports'})` → `002_add_reports.sql` when `001_initial.sql` exists.
  - Scaffolding the same name twice throws `already exists`.
  - `name: 'Bad-Name'` throws.
- [ ] **Step 2: Run `npm test`. Expected: FAIL.** — [ ] **Step 3: Implement `scripts/new.js` and the templates.** — [ ] **Step 4: Run `npm test`. Expected: PASS.**
- [ ] **Step 5: Prove every template is green in the real repo.** For each kind, run `npm run new <kind> zzTemplateCheck` (`zz_template_check` for migrations), then `npm run check && npm test`. **Expected:** PASS. Then delete the generated files (and the migration) and confirm `git status` is clean apart from intended changes.
- [ ] **Step 6: Fill in the `CONTRIBUTING.md` recipes.** One per row of the Extension points table. Each recipe has:
  - **when to use it** (one line)
  - **the command**
  - **the steps after scaffolding** (e.g. "add the rewrite to `vercel.json`", "register in `SOURCES`", "add a test case to `constants.test.js`")
  - **a real file in the repo to copy from** (e.g. `api/event.js`, `public/js/components/eventCard.js`, `src/repo/people.js`)
  - **what review will check**

  Also add a worked example: "Adding 'yt live' as a platform". It's a one-line change to `PLATFORMS` plus one header test, showing that no other file changes.
- [ ] **Step 7: Run `npm run check && npm test`. Expected: PASS. Commit** — `git add -A && git commit -m "Contributor framework: scaffolder, templates, recipes"`

---

### Task 18: Deploy pipeline (needs the owner)

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`, `docs/deploy.md`

**Owner steps.** Pause and ask the owner to do these in their **fan accounts**, then confirm before continuing:
1. Create a Neon project directly at neon.com (free plan) and copy its connection string.
2. Create a Vercel project (Hobby) **without** connecting Git, then run `vercel link` locally (`.vercel/` is gitignored). Create a Vercel token.
3. Create the GitHub repo `mintbluecar/emibonnie-archive`, **private**.
4. Add repo secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`. Add `DATABASE_URL` to the Vercel project's env (Production and Preview).

**Interfaces:**
- Produces: `.github/workflows/ci.yml` runs `npm ci && npm run check && npm test` on every pull request and on push. `deploy.yml` (on push to `main`, after CI) runs `npm ci`, `npm run check`, and `npm test`, then `vercel pull --yes --environment=production`, `vercel build --prod`, and `vercel deploy --prebuilt --prod` (each with `--token=${{ secrets.VERCEL_TOKEN }}`). Pull requests do the same with `preview`.

- [ ] **Step 1: Write `deploy.yml` and `docs/deploy.md`** (the four owner steps, plus running `DATABASE_URL=… npm run migrate` once). No personal names or paths.
- [ ] **Step 2: Run the migration:** `DATABASE_URL=… npm run migrate`. **Expected:** `migrated`.
- [ ] **Step 3: Add the data:** `DATABASE_URL=… npm run add -- <id> --map …` for the 6 example tweets. **Expected:** `added` ×6.
- [ ] **Step 4: Commit, then ask the owner whether to push** (`git push -u origin main`). Push only on a yes. After pushing, check that Actions is green and open the production URL on a phone. **Expected:** home lists the events, and an entry's video plays and stays pinned while scrolling.

---

## Self-review notes

- **Spec coverage in this plan:** entries, events (keyword/hashtag, lives ±1 day, separate-event override at the draft level), shared stories, people (IG identity, person hashtags, lowercase), generic roles, two-source fetch, speaker display, search with filters and scoped search, all public pages, video with the deleted fallback, visual design, deploy via Actions, Neon direct, removed/opted-out exclusion.
- **Contributor framework:** recipes, a scaffolder, ADRs and a PR template (Tasks 1 and 17). Numbered migrations (Task 8). A tweet-source registry (Task 2). Plans 2 and 3 must add their new kinds (e.g. `job`) as recipes and templates rather than one-off code.
- **Seams for later plans:**
  - `draftEntry` and `resolveSpeakers` are the add-flow preview (Plan 2) and the import mapping (Plan 3).
  - `ingestTweet` is the single write path for submit, paste and Notion (Plan 3 adds Notion overrides via `overrides`).
  - `visibleEntry` covers remove/opt-out (Plan 2).
  - The repositories grow with new functions, never new god modules.
- **Deferred to Plan 2:** sign-in, add-flow UI (event picker, separate event, inline new-event setup), me page, remove/restore/opt-out UI, reports, translator welcome, edit log, blocking, approval switch.
- **Deferred to Plan 3:** admin screens, Notion/paste import with per-translator mapping, Actions jobs (import worker, health check, private backup), alerts.
