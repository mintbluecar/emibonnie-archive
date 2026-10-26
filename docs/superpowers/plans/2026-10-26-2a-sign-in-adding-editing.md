# Plan 2a: sign-in, adding and editing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anyone can sign in with X or Google and add any translation tweet through the web, with speaker mapping that helps but never blocks, and fix entries after saving.

**Architecture:** All code goes in the engine repo `fan-archive` (plain JS + JSDoc, no framework; ADRs 0001–0006), then merges into `emibonnie-archive` as release 0.2.0. Sign-in is a small hand-written OAuth flow (X OAuth 2.0 + PKCE, Google OIDC). It's built on `fetch` and WebCrypto, with sessions in Postgres: no Better Auth (see "Calls" at the end). The web add flow reuses `ingestItem` with new request flags (`dryRun`, `allowUnmapped`, `lineFixes`, `subbed`, `lookups`). Line-level speaker fixes live in their own table beside the verbatim text, and one pure module (`src/domain/lineFixes.js`) applies them everywhere lines are read.

**Tech Stack:** Node ≥22, `node:test`, PGlite and Postgres (Neon), `@neondatabase/serverless`, Playwright and axe, Vercel (one function, `api/index.js`).

**Spec:** `docs/superpowers/specs/2026-10-26-plan-2-accounts-and-adding-design.md`, which builds on `docs/superpowers/specs/2026-10-21-translation-archive-design.md`.

## Global Constraints

- The X OAuth scopes are exactly `users.read tweet.read`. A test checks the requested scope string.
- No email or profile image is stored for X users. Google requests scope `openid` only, so it returns no email and no name.
- `users.display_name` holds only the user's chosen public name, never a Google profile name.
- Recognition and owner checks use only the numeric X ID from the sign-in record (`site.ownerXUserId`), never a handle.
- Sessions last 7 days. Cookies are `HttpOnly; Secure; SameSite=Lax; Path=/`.
- Request headers and query strings never go into logs. No telemetry.
- Writes are POST-only and go through the existing Origin check (`src/http/origin.js`). Every write is rate-limited (Task 3).
- The translator's text is never changed by intake or editing. Line fixes and the subbed flag are stored beside it.
- Credit only ever goes to an author ID returned by a source.
- The engine stays fandom-neutral. New UI strings are copy keys, and new buttons are icons with `title` + `aria-label` from a copy key. Text labels stay only where an icon can't be understood alone, and each one is listed in the task's commit message for the owner.
- Each task runs `npm run check` and `npm test` (PGlite) green before committing. Run `TEST_DATABASE_URL=… npm test -- --test-concurrency=1` against Neon at the end of Tasks 1, 8 and 10.
- Commit as the fan identity (`car`) in `fan-archive`. Never push without the owner's go-ahead.

## Review Focus

1. **A text-only tweet with no markers and no media** (fixture `NO_MARKERS`) is added through the web, saves `added`, and its page shows plain lines with nothing pinned. Test in Task 8.
2. **A line fix on a part whose text is replaced by "check for update"** (edit-window re-fetch): that part's fixes are dropped and the item reports unmapped markers again, while marker-level speakers are kept. Test in Task 7.
3. **A Google display name that imitates a handle or hides characters** (`@vacantvolcanic`, `ab​c`, `‮abc`, 31+ chars) is cleaned or rejected, never stored as typed. Test in Task 6.
4. **An OAuth callback with a missing, mismatched, expired or replayed `state`** returns 400 and creates no session or user. Test in Task 5.
5. **A blocked user who still holds a session** gets 403 on add, edit and check for follow-ups, and nothing is written. Test in Task 9 (add) and Task 10 (edit, follow-ups).

---

### Task 1: Migration 002

**Files:**
- Create: `src/db/migrations/002_accounts_and_adding.sql`
- Test: `test/db/migration002.test.js`

**Interfaces:**
- Produces these tables and columns:
  - `sessions (token_hash text primary key, user_id text not null references users(id), created_at timestamptz not null default now(), expires_at timestamptz not null)`, with an index on `user_id`. **Not audited.**
  - `rate_limits (key text not null, window_start timestamptz not null, hits integer not null, primary key (key, window_start))`. **Not audited.**
  - `translation_line_fixes (item_id bigint not null references translations(item_id), position smallint not null, line smallint not null, as_kind text not null check (as_kind in ('speech','plain')), person_id bigint references people(id), role speaker_role, created_at, created_by, primary key (item_id, position, line))`. Its check: `as_kind='plain'` ⇒ both null; `as_kind='speech'` ⇒ exactly one set. **Audited**, with row key `item_id`.
  - `item_edits (id bigint identity pk, item_id bigint not null references items(id), before jsonb not null, after jsonb not null, reverts bigint references item_edits(id), created_at, created_by text references users(id))`. **Audited**, with row key `id`.
  - `translations.subbed boolean not null default false`
  - `translation_parts.pending boolean not null default false`
- The rule from 001 holds: no `begin`/`commit`. Attach the audit trigger the way 001's `do $$ … for t in select * from (values …)` loop does.

- [ ] **Step 1: Write the failing tests.**
  - `'002 adds sessions, rate_limits, line fixes, item_edits, subbed and pending'` inserts one row of each and asserts the defaults: `subbed=false`, `pending=false`.
  - `'a plain line fix may not name a speaker'` and `'a speech line fix names exactly one of person or role'` each expect error code `23514`.
  - `'line fixes and item edits are audited; sessions are not'` checks `audit_log` row counts after inserts.
  - Use `freshDb()` from `test/helpers/db.js`.
- [ ] **Step 2: Run** `node --test test/db/migration002.test.js`. **Expected:** FAIL (relation does not exist).
- [ ] **Step 3: Write the migration.**
- [ ] **Step 4: Run the test, then `npm test`.** **Expected:** PASS. `test/db/migrate.test.js` still passes, since checksums of 001 are unchanged.
- [ ] **Step 5: Commit** `feat(db): migration 002 for sessions, rate limits, line fixes, item edits`.

### Task 2: Request context — cookies, client IP, JSON body in tests

**Files:**
- Modify: `src/http/handler.js` (`RouteInput`, `createHandler`)
- Create: `src/http/cookies.js`
- Modify: `test/helpers/api.js` (`call` accepts `body` and `cookies`)
- Test: `test/http/cookies.test.js`, `test/api.test.js`

**Interfaces:**
- Produces:
  - `RouteInput` gains `cookies: Record<string,string>` and `ip: string|null`. `ip` is the first entry of `x-forwarded-for`, else `x-real-ip`, else `null`. It's never logged.
  - `parseCookies(header: string|null) => Record<string,string>`.
  - `serializeCookie(name: string, value: string, { maxAge: number }) => string`. It always adds `HttpOnly; Secure; SameSite=Lax; Path=/`, and `maxAge: 0` clears the cookie.
  - `jsonWithCookies(body: unknown, cookies: string[], status = 200) => Response`.
  - `redirectWithCookies(location: string, cookies: string[]) => Response` (302). `toResponse` keeps the route's cache header on these.
  - `apiFor(...).call(method, path, { body?: unknown, cookies?: Record<string,string>, headers?, origin? })` sends `body` as JSON and returns `setCookies: string[]` too.

- [ ] **Step 1: Write the failing tests.**
  - `parseCookies('a=1; b=x%20y')` gives `{a:'1', b:'x y'}`.
  - `serializeCookie('sid','t',{maxAge:604800})` contains `Max-Age=604800`, `HttpOnly`, `Secure`, `SameSite=Lax` and `Path=/`.
  - In `test/api.test.js`, `'routes see cookies and ip; ip never appears in logs'` uses a throwaway route table that echoes `input.cookies` and `input.ip`.
- [ ] **Step 2: Run them.** **Expected:** FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`. **Expected:** PASS.
- [ ] **Step 5: Commit** `feat(http): cookies and client ip on route input`.

### Task 3: Rate limits backed by the database

**Files:**
- Create: `src/repo/rateLimits.js`, `src/services/limits.js`
- Test: `test/services/limits.test.js`

**Interfaces:**
- Produces:
  - `hitLimit(db, { key: string, limit: number, windowSeconds: number, now: Date }) => Promise<void>`. It upserts the `(key, window_start)` row, where `window_start` is `now` floored to the window, and throws `RateLimited` (`src/http/errors.js`) once `hits > limit`.
  - `LIMITS`, frozen, as `{ name: { limit, windowSeconds } }`:
    - `signIn` {10, 900}, keyed by IP
    - `addPreview` {60, 3600}
    - `add` {20, 3600}
    - `edit` {60, 3600}
    - `followUps` {10, 3600}
    - `setName` {5, 3600}
    - `deleteAccount` {3, 86400}
    - `report` {5, 3600}, keyed by IP (used in 2b)
  - `limit(deps, name: keyof LIMITS, subject: string) => Promise<void>`. The key is `${name}:${subject}`. For IP subjects, `subject` is `ip:` plus a hex SHA-256 of `AUTH_SECRET + ip`, so raw IPs are never stored. A null IP uses `ip:unknown`.
  - Old rows are deleted opportunistically: one `delete … where window_start < now() - interval '2 days'` on about 1% of hits. Wrap the random roll as `deps.random ?? Math.random` so tests can pin it.

- [ ] **Step 1: Write the failing tests.**
  - `'the 21st add in an hour is rate limited'`
  - `'a new window starts fresh'`
  - `'ip subjects are hashed, never stored raw'` asserts that no `rate_limits.key` contains `203.0.113.5`.
- [ ] **Step 2: Run them.** **Expected:** FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them.** **Expected:** PASS.
- [ ] **Step 5: Commit** `feat: database-backed rate limits`.

### Task 4: Sessions and the signed-in user

**Files:**
- Create: `src/repo/sessions.js`, `src/services/session.js`
- Modify: `src/repo/accounts.js` (adds `linkXAccountToUser`)
- Test: `test/services/session.test.js`

**Interfaces:**
- Produces:
  - `SessionUser = { id: string, via: 'x'|'google', xUserId: string|null, handle: string|null, displayName: string|null, isOwner: boolean, isBlocked: boolean, translatorAccountIds: number[] }`
  - `signInUser(deps, { via, subject, handle }) => Promise<{ user: SessionUser, cookie: string }>`:
    - The user ID is `x:<numericId>` or `google:<sub>`.
    - It upserts `users`. `role='owner'` only when `via==='x' && subject === site.ownerXUserId`.
    - For X, it sets `meta.handle` and calls `linkXAccountToUser(tx, { externalId: subject, userId })`, which sets `accounts.user_id` where `platform='x' and external_id=$1`.
    - It inserts a session with `expires_at = now + 7 days`. It stores only `sha256(token)`, where the token is 32 random bytes in base64url.
    - The SQL actor is the user's own ID.
    - A user row with `deleted_at` set is restored on sign-in, with `display_name` null.
  - `currentUser(deps, input: RouteInput) => Promise<SessionUser|null>` reads cookie `sid`, ignores expired sessions, and caches the result on `input` for the request.
  - `requireUser(deps, input, { allowBlocked = false } = {}) => Promise<SessionUser>`. It throws `Unauthorized` (new in `src/http/errors.js`, mapped to 401 `{error:'signed_out'}`) when signed out, and `Forbidden` (new, 403 `{error:'blocked'}`) when blocked, unless `allowBlocked` is set.
  - `requireOwner(deps, input) => Promise<SessionUser>` throws 403 `{error:'forbidden'}` for anyone who isn't the owner.
  - `signOut(deps, input) => cookie string`, which deletes the session and clears the cookie.
  - `signOutEverywhere(deps, userId) => Promise<void>`.

- [ ] **Step 1: Write the failing tests.**
  - `'x sign-in creates the user, links their credited account, and recognises them as translator'` uses `insertAccount` with an `external_id`.
  - `'only the owner X id gets role owner'`
  - `'a session expires after 7 days'` uses `deps.now`.
  - `'the token is stored hashed'`
  - `'a blocked user is refused by requireUser but still read by currentUser'`
  - `'sign out everywhere ends every session of that user only'`
- [ ] **Step 2: Run them.** **Expected:** FAIL.
- [ ] **Step 3: Implement.** Add `Unauthorized` and `Forbidden` to `src/http/errors.js`, and map them in `errorResponse`.
- [ ] **Step 4: Run them.** **Expected:** PASS.
- [ ] **Step 5: Commit** `feat: sessions and signed-in user`.

### Task 5: Sign in with X

**Files:**
- Create: `src/services/xSignIn.js`, `src/services/oauthState.js`, `src/routes/authX.js`
- Modify: `src/routes/index.js`
- Test: `test/services/xSignIn.test.js`, `test/routes/authX.test.js`

**Interfaces:**
- Consumes: `signInUser` and `limit` from Tasks 3 and 4.
- Produces:
  - `oauthState.js` provides:
    - `issueState(env, { verifier: string|null, returnTo: string, nonce?: string }) => { state: string, cookie: string }`. This is a cookie named `oauth` whose value is an HMAC-SHA256-signed (`AUTH_SECRET`) JSON with a 10-minute expiry. `returnTo` must be a same-site path starting with `/`, and anything else becomes `/me`.
    - `takeState(env, input, state) => { verifier, returnTo, nonce }`. It throws `BadRequest` when the cookie is missing, the signature is bad, the state doesn't match or the state has expired. Its response always clears the cookie, and a used state is single-use because the cookie is cleared.
  - `xSignIn.js` provides:
    - `authorizeUrl({ clientId, redirectUri, state, challenge }) => string`. It points at `https://x.com/i/oauth2/authorize` with `response_type=code`, `scope=users.read tweet.read`, `code_challenge_method=S256`.
    - `exchangeCode(deps, { code, verifier, redirectUri }) => Promise<string>`, which returns the access token from `POST https://api.x.com/2/oauth2/token` with Basic auth from `X_CLIENT_ID` and `X_CLIENT_SECRET`.
    - `fetchMe(deps, token) => Promise<{ id: string, username: string }>` calls `GET https://api.x.com/2/users/me`. The ID must match `/^\d+$/`.
  - Routes:
    - `GET /api/auth/x/start?return=/add` checks `limit(signIn, ip)`, then sets the state cookie and redirects (302) to X.
    - `GET /api/auth/x/callback?code&state`: if both succeed, it signs in and redirects to `returnTo` with the `sid` cookie. If `fetchMe` fails, it records setting `xSignInFailedAt` (an ISO string) and redirects to `/me?signin=failed`. Any other failure also redirects to `/me?signin=failed`, except a bad state, which is a 400.
    - Both routes take `query` names `['return']` and `['code','state','error']`, and use cache `no-store`.
  - The redirect URI is `${input.origin}/api/auth/x/callback`.
- The implementer confirms the endpoint URLs and parameters against X's current OAuth 2.0 docs (Authorization Code with PKCE, and `GET /2/users/me`) and cites them in the commit message. The main design's 2026-10-21 test showed sign-in and `/2/users/me` work on a zero-credit app.

- [ ] **Step 1: Write the failing tests.** Use a fake `fetchImpl`.
  - `'authorize url asks for exactly users.read tweet.read with S256'` asserts `new URL(u).searchParams.get('scope') === 'users.read tweet.read'`.
  - `'callback signs in and sets sid, redirecting to returnTo'`
  - Review Focus 4: `'callback rejects a missing, tampered, mismatched or expired state with 400 and no user row'`
  - `'a replayed state fails once the cookie is cleared'`
  - `'returnTo outside the site falls back to /me'` (`//evil.example`, `https://evil.example`)
  - `'users/me failure records xSignInFailedAt and redirects to /me?signin=failed'`
  - `'no email or image is requested or stored'`
- [ ] **Step 2: Run them.** **Expected:** FAIL.
- [ ] **Step 3: Implement.** The PKCE verifier is 32 random bytes in base64url, and the challenge is the base64url SHA-256 of the verifier (`crypto.subtle`).
- [ ] **Step 4: Run them.** **Expected:** PASS.
- [ ] **Step 5: Commit** `feat: sign in with X (users.read tweet.read, PKCE)`.

### Task 6: Sign in with Google, me API, display name, sign out, dev sign-in

**Files:**
- Create: `src/services/googleSignIn.js`, `src/domain/displayName.js`, `src/routes/authGoogle.js`, `src/routes/me.js`, `src/routes/authDev.js`
- Modify: `src/routes/index.js`
- Test: `test/domain/displayName.test.js`, `test/routes/me.test.js`, `test/routes/authGoogle.test.js`

**Interfaces:**
- Produces:
  - `googleSignIn.js` provides:
    - `authorizeUrl({ clientId, redirectUri, state, nonce, challenge })` for `https://accounts.google.com/o/oauth2/v2/auth` with `scope=openid`, PKCE S256 and a `nonce`.
    - `exchangeCode(deps, …) => Promise<{ sub: string }>`, from `https://oauth2.googleapis.com/token`. It reads `sub` from the `id_token` payload and checks `iss`, `aud === GOOGLE_CLIENT_ID`, `exp` and `nonce`. The token comes directly from Google's token endpoint over TLS, so it's used without signature verification. The implementer cites the OpenID Connect Core section that allows this, or verifies the signature if they find it doesn't.
  - Routes `GET /api/auth/google/start` and `/api/auth/google/callback` behave like Task 5's X routes.
  - `cleanDisplayName(raw: string) => { ok: true, name: string } | { ok: false, reason: 'empty'|'too_long'|'looks_like_handle' }`:
    - It applies NFKC, strips `\p{Cf}`, `\p{Cc}` and bidi controls, collapses whitespace and trims.
    - A leading `@` is rejected as `looks_like_handle`, not stripped, so a typed handle never becomes a name.
    - The cleaned name must be 1–30 characters.
  - Me routes:
    - `GET /api/me` returns `{ user: null }` or `{ user: { via, handle, displayName, isOwner, isTranslator, needsName } }`, where `needsName = via==='google' && !displayName`. It uses `no-store` and a `query` of `[]`.
    - `POST /api/me/name {name}` checks `limit(setName)`, then stores `cleanDisplayName(...).name` as `users.display_name`, or returns 400 with the reason.
    - `POST /api/auth/signout` clears the session.
    - `POST /api/auth/signout-all` ends every session of the caller.
  - `POST /api/auth/dev {as: 'owner'|'member'|'google'}` works only when `env.DEV_SIGN_IN === '1'` **and** `env.VERCEL` is unset. Otherwise it's a 404. It's used by e2e and local dev.

- [ ] **Step 1: Write the failing tests.**
  - Review Focus 3: `cleanDisplayName` cases. `'@vacantvolcanic'` gives `looks_like_handle`. `'ab​c'` gives `'abc'`. `'‮abc'` gives `'abc'`. `'  a   b '` gives `'a b'`. 31 chars gives `too_long`. `''` gives `empty`.
  - `'google sign-in requests openid only and stores no name or email'`
  - `'id_token with wrong aud or nonce is refused'`
  - `'GET /api/me signed out is { user: null }'`
  - `'a google user needs a name until they set one'`
  - `'dev sign-in is 404 when VERCEL is set'`
- [ ] **Step 2: Run them.** **Expected:** FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them.** **Expected:** PASS.
- [ ] **Step 5: Commit** `feat: Google sign-in, me API, display names, sign out`.

### Task 7: Line fixes and subbed in the translation kind (reading side)

**Files:**
- Create: `src/domain/lineFixes.js`
- Modify:
  - `src/kinds/translation/repo.js` (`loadDetails`, plus `fixesOf`, `setLineFixes`, `dropFixesForPart` and `subbedOf`)
  - `src/kinds/translation/presenter.js` (`keyedBubbles`, `castOf`, `previewLines`)
  - `src/kinds/translation/search.js` (`textClause`, `matchLines`)
  - `src/kinds/translation/domain.js` (`speakerPeopleOf`)
  - `src/kinds/translation/upkeep.js` (the edit-window re-fetch)
- Test: `test/domain/lineFixes.test.js`, plus additions in the translation kind's existing tests

**Interfaces:**
- Produces:
  - `LineFix = { part: number, line: number, as: 'plain' } | { part: number, line: number, as: 'speech', speaker: Speaker }`. Here `line` is the index among that part's **non-blank** lines, which is how `splitLines` counts them.
  - `partLines(parts: string[], fixes: LineFix[]) => FixedLine[]`, where `FixedLine = Line & { part: number, line: number, fixed?: Speaker }`:
    - A `plain` fix returns `{kind:'plain', text: <the raw trimmed line, marker included>}`.
    - A `speech` fix returns a speech line, keeping the parser's marker and text when it found one, else `marker:''`, `markers:[]` and the raw text, with `fixed: speaker`.
    - A fix pointing past a part's lines is ignored.
  - `unmappedMarkers(parts, fixes, map) => MissingMarker[]` counts only lines that aren't fixed.
  - `validateFixes(parts, fixes) => void` throws `BadRequest` for an out-of-range part or line, a duplicate `(part,line)`, or a speech fix with no speaker.
  - `TranslationDetails` gains `fixes: LineFix[]` and `subbed: boolean`. It keeps `parts` as an array of texts.
  - The presenter builds bubbles from `partLines(details.parts, details.fixes)`. A line with `fixed` resolves its speaker from `fixed`, not the marker map. Everything else is unchanged, including footnotes and joint lines.
  - The cast list and "who's in it" (`speakerPeopleOf`) include fixed speakers.
  - `textClause` adds `and not tp.pending` and excludes `translations.subbed` items. `matchLines` uses fixed lines.
  - Upkeep: when the edit-window re-fetch changes a part's body, it calls `dropFixesForPart(tx, itemId, position)` in the same transaction.
  - Item details report `unmapped: MissingMarker[]` for the item page and edit screen.

- [ ] **Step 1: Write the failing tests.**
  - `partLines` cases:
    - a plain fix on a speech line shows the raw line;
    - a speech fix on a plain line;
    - a speech fix overriding a marker's mapping for one line only;
    - an out-of-range fix is ignored.
  - `unmappedMarkers` skips fixed lines.
  - `validateFixes` refusals.
  - The presenter: an unmapped marker still renders as itself, and a fixed line uses the person's emoji and colour.
  - Search: a typed query doesn't return a subbed item, but a filter-only browse does (through `src/services/search.js`).
  - Review Focus 2: `'a refreshed part loses its line fixes; marker speakers stay'`. Use fixture `EDITED_OLD`/`EDITED_NEW` and the pattern in `test/routes/refresh.test.js`.
- [ ] **Step 2: Run them.** **Expected:** FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`. **Expected:** PASS, with the existing bubble, cast and search tests unchanged.
- [ ] **Step 5: Commit** `feat(translation): line-level speaker fixes and subbed entries`.

### Task 8: Ingest for the web (writing side)

**Files:**
- Modify:
  - `src/services/ingest.js` (`IngestRequest`, `readiness`, `ingestNew`, `attachIfFollowUp`)
  - `src/services/ingestWrite.js`
  - `src/kinds/translation/domain.js` (`draft`)
  - `src/kinds/translation/persist.js`
  - `src/kinds/defineKind.js` (`DraftOverrides`, `Kind.appendFollowUp`)
  - `src/repo/lookups.js` (adds `findLookup`)
  - `test/fixtures/tweets/build.mjs` (adds `NO_MARKERS` and `SUBBED`)
- Test: `test/services/ingest.test.js` (additions)

**Interfaces:**
- Consumes: `LineFix`, `validateFixes`, `unmappedMarkers` and `setLineFixes` from Task 7.
- Produces:
  - `IngestRequest` gains:
    - `dryRun?: boolean`. Steps 1–5 run and nothing is written. It returns `{status:'ready', sourceId, draft, unmapped, lines: FixedLine[], newTags}`, or the same refusals as now.
    - `allowUnmapped?: boolean`. When set, `readiness` skips the `needs_speakers` refusal. The CLI leaves it unset and keeps today's behaviour.
    - `lineFixes?: LineFix[]`, checked by `validateFixes` against the fetched parts.
    - `subbed?: boolean`
    - `lookups?: 'create'|'existing'` (default `'create'`). With `'existing'`, a category or client name that isn't already in the list gives `BadRequest('unknown category'|'unknown client')`, through new `findLookup(tx, table, name) => Promise<number|null>`.
  - `subbed: true` means: no speaker step, `draft.missing = []`, and persist sets `translations.subbed = true`.
  - Persist writes `lineFixes` through `setLineFixes`.
  - **An attached follow-up respects review.** `appendFollowUp` gains `{ pending: boolean }`. A follow-up attached by paste is `pending = (await reviewStateOf(...)) === 'pending'`, using the same rule `ingestWrite.js` applies to items, so pending parts are hidden by Task 7. The status stays `attached`, plus `pending: true` when held.

- [ ] **Step 1: Write the failing tests.**
  - Review Focus 1: `'a text-only tweet with no markers saves as added with allowUnmapped'` and `'…and is refused needs_speakers without it'` (the CLI path is unchanged).
  - `'unmapped markers are allowed with allowUnmapped and reported in dryRun'`
  - `'dryRun writes nothing'` (row counts unchanged)
  - `'PHOTO and POST fixtures add with allowUnmapped'`
  - `'subbed skips speakers and sets translations.subbed'`
  - `'lineFixes are stored and invalid ones refused before any write'`
  - `"lookups:'existing' refuses a new category and a new client"`
  - `'a pasted follow-up is held pending when approvalRequired is on'`
- [ ] **Step 2: Run them.** **Expected:** FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`, then the Neon run. **Expected:** PASS.
- [ ] **Step 5: Commit** `feat(ingest): dry run, unmapped allowed, line fixes, subbed, existing lookups only`.

### Task 9: Add API

**Files:**
- Create: `src/routes/add.js`, `src/services/addFlow.js`
- Modify: `src/routes/index.js`
- Test: `test/routes/add.test.js`

**Interfaces:**
- Consumes: `requireUser` and `limit` (Tasks 3–4), and `ingestItem` (Task 8).
- Produces:
  - `GET /api/add/options` (signed in, `no-store`) returns `{ people: {id, displayName, emoji, igHandle}[], roles: Role[], events: {id, name, slug, occurredOn}[], categories: string[], clients: string[] }`. It lists the events most recent first, capped at 200.
  - `POST /api/add/preview {url, overrides?, chosen?, lineFixes?, subbed?}` goes through `limit(addPreview)`, then `ingestItem` with `dryRun:true, allowUnmapped:true, lookups: owner ? 'create' : 'existing'`. It returns the result as-is, plus `addingAs: handle|displayName`.
  - `POST /api/add` takes the same body, goes through `limit(add)`, and calls `ingestItem` with `addedVia:'submit'` and `actor: user.id`. It returns the `IngestResult` and adds `url` (the item page) when the status is `added`, `attached` or `duplicate`.
  - Both routes refuse:
    - 401 when signed out;
    - 403 `blocked` for a blocked user;
    - 409 `needs_name` for a Google user with no display name;
    - 400 for a URL the kind doesn't match.
  - Also adds `POST /api/people {displayName, igHandle}` ("＋ add a new person"). It's signed in, goes through `limit(edit)`, requires an IG handle matching `/^[a-z0-9._]{1,30}$/i`, and returns `{id}`. Reuse the people repo. A handle that's already known returns that person.

- [ ] **Step 1: Write the failing tests.** Use dev sign-in or `signInUser` to get a `sid` cookie.
  - `'preview returns ready with unmapped markers and writes nothing'`
  - `'add saves and returns the item url'`
  - `'opted-out, duplicate, deleted and removed outcomes pass through'`
  - Review Focus 5: `'a blocked user gets 403 and nothing is written'`
  - `'a google user without a name gets 409 needs_name'`
  - `'a member cannot create a category; the owner can'`
  - `'the 21st add in an hour is 429'`
  - `'foreign Origin is 403'`
- [ ] **Step 2: Run them.** **Expected:** FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them.** **Expected:** PASS.
- [ ] **Step 5: Commit** `feat: add API (preview, add, options, new person)`.

### Task 10: Editing, history and revert, check for follow-ups

**Files:**
- Create: `src/services/editItem.js`, `src/routes/edit.js`, `src/routes/followUps.js`
- Modify:
  - `src/repo/items.js` (`updatePlacement`, `updateLookups`)
  - `src/kinds/translation/upkeep.js` (`checkFollowUps` gains `pending`)
  - `src/routes/index.js`
- Test: `test/services/editItem.test.js`, `test/routes/edit.test.js`, `test/routes/followUps.test.js`

**Interfaces:**
- Consumes: `remapSpeakers` (the kind), `setLineFixes` (Task 7), `reviewStateOf` (export it from `ingestWrite.js`) and `requireUser`.
- Produces:
  - `EditableFields = { placement, eventId, categoryName, clientName, speakers: SpeakerMap, lineFixes: LineFix[], subbed: boolean }`. **There is no text field.**
  - `canEdit(user, item) => 'submitter'|'translator'|'owner'|null` returns:
    - `owner` when the user is the owner;
    - `translator` when `item.credited_account_id` is in `user.translatorAccountIds`;
    - `submitter` when `item.created_by === user.id`;
    - otherwise `null`.
  - `editableOf(db, itemId) => Promise<EditableFields>`
  - `editItem(deps, { kind, sourceId, changes: Partial<EditableFields>, actor: SessionUser }) => Promise<{ editId: number }>`:
    - It runs in one transaction under `actor.id`.
    - It validates the changes. Lookups are `'existing'` unless the actor is the owner. Fixes go through `validateFixes`. `placement:'event'` requires an existing `eventId`.
    - It applies the changes. Moving to another event recomputes `sort_key` the way `ingestWrite.js` does for a new item, and never touches the event row. Speakers go through `kind.remapSpeakers` (this also updates `item_people`).
    - It writes `item_edits {before, after}` with only the changed keys.
    - It refuses `BadRequest('nothing to change')` when nothing changed.
  - `revertEdit(deps, { editId, actor }) => Promise<{ editId: number }>` is owner only. It applies `before` through `editItem` with `reverts = editId`. It refuses an edit that's already been reverted.
  - Routes:
    - `GET /api/item/:kind/:sourceId/edit` returns `{ role, fields: EditableFields, parts: string[], lines: FixedLine[], unmapped, history: {id, at, by, changed: string[], reverted: boolean}[] }`. The history is shown only to the owner. `by` is the handle or display name, and "a fan" for a deleted user.
    - `POST /api/item/:kind/:sourceId/edit {changes}` goes through `limit(edit)`.
    - `POST /api/item/:kind/:sourceId/edits/:editId/revert` is owner only.
    - `POST /api/item/:kind/:sourceId/follow-ups` is for the translator, the submitter or the owner, and goes through `limit(followUps)`. It calls `kind.checkFollowUps(deps, itemId, { actor, pending })`, where `pending` follows `reviewStateOf` for the caller. It returns `{ added, pending }`.
  - Item detail (`GET /api/item/...`) gains `canEdit: boolean` and `canCheckFollowUps: boolean` for the signed-in caller. This makes it per-user, so when a session cookie is present the route must answer `cache-control: private, no-store`. It keeps `PUBLIC_CACHE` when signed out. Pin this with a test.

- [ ] **Step 1: Write the failing tests.**
  - `'submitter edits placement and event; event row unchanged'`
  - `'translator edits speakers and line fixes; a text field in changes is 400'`
  - `'a stranger gets 403'`
  - Review Focus 5: `'a blocked user gets 403 on edit and follow-ups and nothing changes'`
  - `'every edit writes item_edits and audit_log'`
  - `'owner reverts an edit; reverting twice is 409'`
  - `'history is owner-only'`
  - `'check for follow-ups adds the THREAD_FOLLOWUP part; held pending when approval is on'`
  - `'item detail is private no-store with a session, public without'`
- [ ] **Step 2: Run them.** **Expected:** FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`, then the Neon run. **Expected:** PASS.
- [ ] **Step 5: Commit** `feat: editing with history and owner revert; check for follow-ups`.

### Task 11: Delete my account

**Files:**
- Create: `src/services/deleteAccount.js`
- Modify: `src/routes/me.js`, and wherever "added by" is presented (`addedBy` in `src/services/itemView.js` or its repo)
- Test: `test/services/deleteAccount.test.js`

**Interfaces:**
- Produces: `POST /api/me/delete {confirm: 'delete'}` goes through `limit(deleteAccount)`. It runs one transaction under the user's own ID:
  - deletes every session of the user;
  - sets `users.deleted_at`, `display_name = null` and `meta = '{}'`;
  - sets `accounts.user_id = null` where it was this user.
  - It returns the cleared cookie. Items stay, and "added by" shows the copy key `item.addedByFan` ("a fan") for a deleted user.
  - Signing in again creates a fresh link (Task 4), and old items stay "a fan", because `created_by` points to the deleted row and that row's name is null.

- [ ] **Step 1: Write the failing tests.**
  - `'delete removes sessions and name; past items show a fan'`
  - `'without confirm it is 400'`
  - `'a translator who deletes their account keeps credit on their translations'` (credit is the X account, not the user)
- [ ] **Step 2: Run them.** **Expected:** FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them.** **Expected:** PASS.
- [ ] **Step 5: Commit** `feat: delete my account`.

### Task 12: Sign-in screen and me page (web)

**Files:**
- Create:
  - `src/html/add.html`, `src/html/me.html` (same shell as `account.html`)
  - `public/js/pages/me.js`
  - `public/js/components/signIn.js`, `public/js/components/nameForm.js`
  - `public/js/core/session.js` (`getMe()`, `postJson(path, body)`, alongside `getJson` in `core/api.js`)
  - `src/styles/components/signIn.css`, `me.css`
- Modify:
  - `src/pages.js`: `/add` → `add.html`, `/me` → `me.html`
  - the engine copy file that defines `nav.add` (new keys under `signIn.*`, `me.*`)
- Test: `test/components/signIn.test.js`, `test/components/nameForm.test.js`, and an e2e spec `e2e/me.spec.js` (the folder Playwright's config uses)

**Interfaces:**
- Consumes: `GET /api/me`, `POST /api/me/name`, `/api/auth/*` and `POST /api/me/delete`.
- Also adds (with its own route test in `test/routes/me.test.js`) `GET /api/me/added?offset`. It's signed in, uses `private, no-store`, and returns `{ items: Preview[], hasMore }` of the caller's items in every review state, 20 per page. Each one carries `reviewState`, so pending and rejected items are labelled.
- Produces:
  - `signIn.render({ returnTo })`, matching mockup `translator-signin-v2.html`:
    - logo, wordmark, FAN-MADE badge;
    - a black "sign in with X" button first, then "sign in with Google";
    - the "what's kept" note.
    - Both are links to `/api/auth/{x|google}/start?return=…`, and they keep their text because the provider names are needed.
  - The me page shows signed out: the sign-in screen. Signed in, it shows:
    - "added by me" cards (reusing `previewCard`) with an edit icon button on each;
    - the name form for Google users who need one;
    - sign out and sign out everywhere (icon buttons);
    - delete my account (a confirm dialog that types `delete`).
  - `?signin=failed` shows the copy key `signIn.failed`.
  - The translator parts of me are **2b**. Don't add them.

- [ ] **Step 1: Write the failing component tests.**
  - signIn renders X before Google, and the hrefs carry `return`.
  - nameForm shows the server's reason copy for `looks_like_handle`.
  - Each icon button has `title` and `aria-label`.
- [ ] **Step 2: Run them.** **Expected:** FAIL.
- [ ] **Step 3: Implement.** Run `npm run build`.
- [ ] **Step 4: Run** `npm test` and `npm run e2e`. The e2e uses `DEV_SIGN_IN=1` to sign in as a member: me lists "added by me", and axe shows no violations at both widths. **Expected:** PASS.
- [ ] **Step 5: Commit** `feat(web): sign-in screen and me page`.

### Task 13: Add page and edit page (web)

**Files:**
- Create:
  - `public/js/pages/add.js`
  - `public/js/components/addLink.js` (step 1)
  - `public/js/components/addDetails.js` (step 2)
  - `public/js/components/speakerStep.js` (step 3: marker dropdowns + line list)
  - `public/js/components/lineFixSheet.js`
  - `public/js/components/personPicker.js`
  - `src/html/edit.html`, `public/js/pages/edit.js`
  - `src/styles/components/add.css`
- Modify: `src/pages.js` (`/edit/:kind/:sourceId` → `edit.html`, a reserved prefix), the copy keys (`add.*`, `edit.*`), and `public/js/pages/itemFooter.js` (edit and check-for-follow-ups icon buttons when `canEdit` / `canCheckFollowUps`)
- Test: `test/components/speakerStep.test.js`, `test/components/lineFixSheet.test.js`, `test/components/addDetails.test.js`, `e2e/add.spec.js`

**Interfaces:**
- Consumes: Task 9's and Task 10's APIs.
- Produces the add page:
  - **Step 1, paste a link.** It shows "adding as @handle" and maps every `IngestResult` status to a screen with copy keys `add.status.<status>`: duplicate, removed, opted_out, deleted, unavailable, attached (with `pending`), pending. Each one links onward, and none is a dead end.
  - **Step 2, check the details.**
    - The preview reuses `mediaBox`, `quoteCard` and `carousel`. A text-only post shows no pinned area.
    - The placement choice and event box offer the match, a new event with a typed title, or the picker from `/api/add/options`.
    - Type and client are selects from the lists. Only the owner sees "＋ new".
    - Hashtags (from `newTags`), clip by, and follows-on (the offer to add the quoted post too).
    - "this clip is already subbed" is a checkbox with a label, since a checkbox needs its text.
  - **Step 3, who's speaking.**
    - It's skipped when subbed.
    - One dropdown per marker, with "remembered" labels. Known people come first, then search, then "＋ add a new person" (calls `POST /api/people`), then roles.
    - Below that is every line as it will show. Tapping a line opens `lineFixSheet` with speech / plain and the speaker picker, and writes a `LineFix`.
    - The `N not mapped yet — you can fix this later` note (`add.unmappedNote`) shows while anything is unmapped. **Save is never disabled for unmapped markers.**
    - Every change re-runs `POST /api/add/preview`, debounced 300 ms, to refresh the lines.
  - **Save** calls `POST /api/add` and goes to the item URL.
  - The edit page has the same steps 2 and 3, filled from `GET …/edit` and saved with `POST …/edit`. The owner sees the history list with a revert icon button on each entry.
  - The item footer gets edit (pencil) and check-for-follow-ups icon buttons. Both have tooltips and `aria-label`.

- [ ] **Step 1: Write the failing component tests.**
  - `speakerStep` with markers `🐶🐱` and 1 unmapped shows `1 not mapped yet`, and Save is enabled.
  - `speakerStep` with `subbed` renders nothing.
  - `lineFixSheet` choosing plain emits `{part, line, as:'plain'}`.
  - `addDetails` hides "＋ new type" for a member.
  - Status screens: each status renders its copy key.
- [ ] **Step 2: Run them.** **Expected:** FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`, `npm run build` and `npm run e2e`. The e2e, as a dev member:
  - adds `NO_MARKERS` and saves with no mapping;
  - adds `LONG`, maps one marker and fixes one line to plain, and the item page shows the plain line;
  - edits it back.
  - axe is clean on add, edit and me at both widths.
  - **Expected:** PASS.
- [ ] **Step 5: Commit** `feat(web): add flow and edit page`. List any text-only buttons in the message.

### Task 14: Docs, version and release

**Files:**
- Modify: `CHANGELOG.md` (0.2.0), `package.json` (0.2.0), `docs/start-your-own.md`, `docs/limits.md`, `docs/architecture.md`, `.env.example` (if present)
- Test: the existing purity and doc tests (`test/purity.test.js`)

- [ ] **Step 1: Write the docs.**
  - **start-your-own:** creating the X app (OAuth 2.0, web app, callback `https://<domain>/api/auth/x/callback`, scopes `users.read tweet.read`) and the Google OAuth client (scope `openid`, callback `/api/auth/google/callback`, set **In Production**).
  - The env vars: `AUTH_SECRET` (32+ random bytes), `X_CLIENT_ID`, `X_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `DEV_SIGN_IN` (local only, never on Vercel).
  - **limits:** the rate-limit table from Task 3.
  - **CHANGELOG 0.2.0 upgrade steps:** merge the tag; set the env vars; `npm run migrate` (002); the new copy keys; `npm run build`; redeploy. Also: the item page is private for signed-in users.
- [ ] **Step 2: Run** `npm run check`, `npm test`, `npm run build` and `npm run e2e`. **Expected:** all PASS, and the purity scan is clean (no fandom names in the engine docs).
- [ ] **Step 3: Commit** `Release 0.2.0: sign-in, adding and editing` and tag `v0.2.0` locally. **Ask the owner before pushing** `fan-archive` or merging into `emibonnie-archive`.

---

## Calls made in this plan (owner to check)

- **Hand-written OAuth instead of Better Auth.** The engine has two runtime dependencies and a custom `Db` wrapper over Neon and PGlite. A small `fetch`- and WebCrypto-based flow keeps ADR 0001 and avoids an auth library's database adapter. The spec allowed this as long as the scope, session and storage rules hold, which they do (Global Constraints).
- **Google asks for `openid` only.** That's enough for a stable account number, and Google never sends a name or email.
- **The rate-limit numbers** are in Task 3.
- **The item page becomes private (uncached) for signed-in visitors**, so it can show edit buttons. Signed-out readers keep the cached page.
- **Moved to 2b (owner section)**, not done in 2a:
  - the owner editing an **event's own details**;
  - **reordering** entries within an event.
  - The spec's editing section lists both. They're owner and translator tools that fit the 2b owner work.
- **A local-only dev sign-in** (`DEV_SIGN_IN=1`, refused on Vercel) exists so the add flow can be tested end to end without real OAuth.
