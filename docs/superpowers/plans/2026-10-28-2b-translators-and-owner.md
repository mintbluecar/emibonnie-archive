# Plan 2b: translators and the owner — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give recognised translators control of their own work (welcome, my translations, remove/restore, opt out/in), give the owner the minimum moderation tools (approval switch, waiting list, reports, users and blocking), add the public report form, and make every removal purge the CDN so removed content really leaves.

**Architecture:** All code goes in the engine repo `fan-archive` (plain JS + JSDoc, no framework; ADRs 0001–0006), then merges into `emibonnie-archive` as release 0.3.0. Three new services sit on the existing layers: `translator` (lists, remove/restore, opt-out), `owner` (waiting, reports, users, blocking), `reports` (public intake), plus `cache` (tag computation and purge). Public GET responses gain a `Vercel-Cache-Tag` header; every write that changes a public page calls `invalidateByTag` through `@vercel/functions`, deferred so the response isn't delayed. **No schema change**: `items.deleted_at/deleted_reason`, `accounts.opted_out_at`, `users.blocked_at`, `reports`, `settings` and `item_edits` already cover everything; the translator welcome flag lives in `users.meta`.

**Tech Stack:** Node ≥22, `node:test`, PGlite and Postgres (Neon), `@neondatabase/serverless`, `@vercel/functions` (already a dependency, v3.10.2), Playwright and axe, Vercel (one function, `api/index.js`).

**Spec:** `docs/superpowers/specs/2026-10-26-plan-2-accounts-and-adding-design.md` (the "Plan 2 design"), sections "The me page", "Remove, opt-out, hide and the cache", "Reports", "Security", "Build order" → 2b; building on `docs/superpowers/specs/2026-10-21-translation-archive-design.md` and on the 2a code already shipped in 0.2.0.

## Global Constraints

- **The translator's text is never changed.** Remove, restore, opt-out, block, hide, reject and report write only shared columns (`items.deleted_at/deleted_reason`, `accounts.opted_out_at`, `users.blocked_at`, `reports`, `settings`) — never `translation_parts.body`.
- **Recognition and owner checks use only the numeric X ID** from the sign-in record (`site.ownerXUserId`), never a handle.
- **Credit only ever goes to an author ID returned by a source.**
- **Deleted content leaves every public surface**: search, event, person and translator sections, item pages, link-preview meta, `/api/home`, `/api/filters` results and the CDN cache.
- **Writes are POST-only** and go through the existing Origin check (`src/http/origin.js`). Every write is rate-limited (Task 3's `LIMITS` additions).
- **Cache tags:** `Vercel-Cache-Tag` (comma-separated, ≤128 tags, ≤256 bytes each, no commas). Invalidation is `invalidateByTag()` from `@vercel/functions`, which purges the CDN cache, Runtime Cache and Data Cache. Purging is available on all plans; Hobby allows 50 purge calls/s per team (docs: https://vercel.com/docs/caching/cdn-cache/purge, read 2026-10-28; API: https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package, section `invalidateByTag`).
- **Report reason:** 1–2,000 characters after trimming (the `reports.reason` check).
- **Translator copy says "remove", never "hide".** The opt-out box reads: "removes all N of your translations and stops anyone adding your tweets in future. you can opt back in any time." Its label is "opt out"; its button is full width and reads "yes, i would like to opt out".
- **Removed entries stay listed, faded, with "restore".**
- **New buttons are icons with a `title` tooltip and an `aria-label` from one copy key.** Text labels stay only where an icon can't be understood alone (the remove bar, the opt-out button, report submit); each task lists its text-only buttons in the commit message for the owner.
- **The engine stays fandom-neutral.** New UI strings are copy keys (`src/site/copyDefaults.json`), defaults in English; tests and fixtures never name a real site's people (`test/purity.test.js` guards this).
- **No request headers or query strings in logs.** A purge failure logs one line with no target data.
- Each task runs `npm run check` and `npm test` (PGlite) green before committing. Run `TEST_DATABASE_URL=… npm test -- --test-concurrency=1` against Neon at the end of Tasks 1, 3, 8 and 10.
- Commit as the fan identity (`car`) in `fan-archive`. Never push without the owner's go-ahead.

## Review Focus

1. **A removal must be gone everywhere.** A translator removes an entry that was open in another tab and is in a shared link preview: the item page, its event, person and translator pages, search, home and the meta HTML all stop serving it, and the CDN entries carrying its tags are invalidated. Test in Task 5.
2. **An opted-out translator's work disappears and stays unaddable.** Every item credited to their X accounts leaves every public surface (including the translator page, which says only "this translator has opted out"), pasting one of their tweets is refused with `opted_out`, and opting back in restores exactly those items — not ones the owner hid. Test in Task 6.
3. **A blocked submitter can't act and their submissions vanish**, while items merely credited to their X account stay. Their session still answers `403 blocked` on add, edit, remove, restore and follow-ups, and unblocking restores only `blocked_submitter` items. Test in Task 10.
4. **Reports can't be used to probe or flood.** Reporting a hidden or unknown target is `404`; a 2,001-character reason is `400`; signed-out reports are rate-limited by hashed IP; a foreign Origin is `403`. Test in Task 7.
5. **The approval switch actually holds things.** With it on, a new add and a pasted follow-up are `pending`; approving publishes and purges; rejecting hides the entry from the public but the submitter still sees it in "added by me" as "not accepted". Test in Task 8.

---

### Task 1: Item state — soft delete, restore, review state, listings

**Files:**
- Modify: `src/repo/items.js` (append the exports below)
- Modify: `src/repo/cards.js` (`loadCardsAny`)
- Modify: `src/services/cards.js` (`previewsForAny`)
- Test: `test/repo/itemsState.test.js`

**Interfaces:**
- Produces (all `tx` are `src/db/common.js` `Tx`; `actor` is a user id):
  - `softDeleteItem(tx, { itemId, reason, actor }) => Promise<boolean>` — sets `deleted_at = now()`, `deleted_reason = reason`, `deleted_by = actor` **only where `deleted_at is null`**; returns whether a row changed.
  - `restoreItem(tx, { itemId, reason }) => Promise<boolean>` — clears `deleted_at`, `deleted_reason`, `deleted_by` **only where `deleted_reason = reason`**; returns whether a row changed. (Restoring a hide can never restore a removal, and vice versa.)
  - `setReviewState(tx, { itemId, state }) => Promise<boolean>` — `state` is `'pending'|'published'|'rejected'`, only where the value differs.
  - `findItemIdBySource(db, { kind, platform, externalId }) => Promise<number|null>` — like `findVisibleItemId` but with **no visibility filter** (resolves `source_aliases` too); for owner and translator actions on hidden entries.
  - `translatorItemIds(db, accountIds, { limit, offset }) => Promise<{ ids: number[], hasMore: boolean }>` — items whose `credited_account_id` is in `accountIds`, **every review state and deletion except `deleted_reason = 'erased'`**, newest first, `limit + 1` fetched to compute `hasMore`.
  - `translatorStates(db, itemIds) => Promise<Map<number, { reason: string|null, reviewState: 'pending'|'published'|'rejected' }>>` — the deletion reason and review state for those ids (used to mark a row "removed by you" or "hidden").
  - `translatorTotals(db, accountIds) => Promise<{ translations: number, events: number, sharedStories: number }>` — counted **visible** items (published, not deleted, account not opted out): all, distinct `event_id`, and `placement = 'shared_story'`.
  - `pendingItemIds(db, { limit }) => Promise<number[]>` — `review_state = 'pending' and deleted_at is null`, oldest first.
  - `loadCardsAny(db, itemIds) => Promise<Map<number, Card>>` (in `src/repo/cards.js`) — like `loadOwnCards` but **includes soft-deleted items** (still requires the event not to be deleted).
  - `previewsForAny(deps, itemIds, ctx) => Promise<{ card: Card, preview: Preview }[]>` (in `src/services/cards.js`) — `loadCardsAny` + `presentCards(..., { includePending: true })`; order follows `itemIds`.

- [ ] **Step 1: Write the failing tests** in `test/repo/itemsState.test.js`. Use `freshDb()` (`test/helpers/db.js`) and `insertItem`, `insertEvent`, `insertAccount`, `insertPerson`, `insertUser` (`test/helpers/seed.js`).

```js
test('softDeleteItem sets the reason and actor once; restoreItem clears only that reason', async () => {
  // live item -> softDeleteItem(removed_by_account) true; again false;
  // restoreItem(hidden_by_owner) false; restoreItem(removed_by_account) true.
});
test('setReviewState writes only a real change, and the audit log has both rows', async () => {
  // pending -> published true; published again false; audit_log counts 2 for items/<id>.
});
test('findItemIdBySource sees hidden items and older source ids', async () => {
  // insertSource + softDeleteItem; findVisibleItemId null, findItemIdBySource returns the id;
  // a source_aliases row resolves too.
});
test('translatorItemIds lists every state of the credited account but never erased, newest first', async () => {
  // 4 items: published, pending, removed_by_account, erased -> 3 ids, newest first; hasMore with limit 2.
});
test('translatorTotals counts visible credited items, their events and shared stories', async () => {
  // 2 published on one event (1 shared_story), 1 removed, 1 pending -> {translations:2, events:1, sharedStories:1}.
});
test('pendingItemIds lists held items only, oldest first', async () => {
});
test('previewsForAny presents a removed item with its review state', async () => {
  // previewsForAny returns the removed item; previewsFor (public) returns none.
});
```

- [ ] **Step 2: Run them.** `node --test test/repo/itemsState.test.js` — **Expected:** FAIL (`not a function` / missing export).

- [ ] **Step 3: Implement.** Every mutation helper writes through the passed `tx` (never the outer `db`) and returns `rowCount > 0` (PGlite and Neon both report it through `tx.query`). `translatorItemIds` and `translatorTotals` take `accountIds` as `bigint[]`; an empty array returns no ids (`{ translations: 0, events: 0, sharedStories: 0 }`).

- [ ] **Step 4: Run the new test, then `npm test`.** **Expected:** PASS, with the existing item and card tests unchanged.

- [ ] **Step 5: Commit** `feat(repo): item removal, restore, review state and translator listings`.

### Task 2: Cache tags on every public page

**Files:**
- Create: `src/domain/cacheTags.js`
- Create: `src/http/cacheTags.js`
- Modify: `src/routes/home.js`, `src/routes/search.js`, `src/routes/event.js`, `src/routes/person.js`, `src/routes/account.js`, `src/routes/item.js`
- Modify: `src/routes/meta.js`, `src/services/meta.js`, `src/services/itemPage.js`
- Test: `test/http/cacheTags.test.js`, `test/routes/tags.test.js`

**Interfaces:**
- Produces:
  - `src/domain/cacheTags.js`: `HOME_TAG = 'home'`, `SEARCH_TAG = 'search'`, `itemTag(id) => 'item:<id>'`, `eventTag(slug) => 'event:<slug>'`, `personTag(handle) => 'person:<lowercased handle>'`, `accountTag(handle) => 'account:<lowercased handle>'`.
  - `src/http/cacheTags.js`: `withCacheTags(response, tags)` — sets `Vercel-Cache-Tag` to the deduped, non-empty tags joined by `,`; returns the same `Response` untouched when `tags` is empty.
  - `src/services/itemPage.js`: `itemPage(...)` returns `{ view, refresh, tags }`, where `tags` is `[itemTag(id), ...(event ? [eventTag(slug)] : []), ...people.map(personTag), ...(account ? [accountTag(handle)] : [])]`.
  - `src/services/meta.js`: `itemMetaPage` and `eventMetaPage` return `{ html, found, tags }` (the same tags as the API page; `[]` when not found).
  - Each public route builds its tags: home `[HOME_TAG]`, search `[SEARCH_TAG]`, event `[eventTag(view.event.slug)]`, person `[personTag(view.person.igHandle)]` (plus the requested handle when `redirectTo` is set), account `[accountTag(view.account.handle)]`, item `page.tags`, meta `page.tags`.
  - The item route tags only the public (`jsonWithCache(view, PUBLIC_CACHE)`) response: a signed-in viewer's `private, no-store` response gets no tag.

- [ ] **Step 1: Write the failing tests.**

```js
// test/http/cacheTags.test.js
test('tags are stable and lower-case', () => {
  assert.equal(personTag('LunaMoon'), 'person:lunamoon');
  assert.equal(eventTag('an-event'), 'event:an-event');
  assert.equal(itemTag(7), 'item:7');
});
test('withCacheTags dedupes and sets one comma-separated header', async () => {
  const res = withCacheTags(Response.json({}), ['home', 'home', itemTag(1)]);
  assert.equal(res.headers.get('vercel-cache-tag'), 'home,item:1');
  assert.equal(withCacheTags(Response.json({}), []).headers.get('vercel-cache-tag'), null);
});
// test/routes/tags.test.js — through apiFor() and the seeded fixtures (test/helpers/ingest.js seededDeps)
test('home, search, event, person, account and item responses carry their page tags', ...);
test('a signed-in item view is private and carries no cache tag', ...); // signInUser + cookie
test('the item and event meta pages carry the same tags', ...); // res.headers too
```

- [ ] **Step 2: Run them.** **Expected:** FAIL.

- [ ] **Step 3: Implement.** Routes that returned plain objects now return `withCacheTags(jsonWithCache(body, PUBLIC_CACHE), tags)`; keep each route's `cache: PUBLIC_CACHE`. `meta.js`'s `htmlResponse` takes `tags` and sets the header. Never tag a `NOT_FOUND_CACHE` meta page or `PRIVATE_NO_STORE`.

- [ ] **Step 4: Run them, then `npm test`.** **Expected:** PASS.

- [ ] **Step 5: Commit** `feat(cache): tag public pages with Vercel cache tags`.

### Task 3: Purge on every write that changes a public page

**Files:**
- Create: `src/services/cache.js`
- Modify: `src/services/limits.js` (`LIMITS`)
- Modify: `src/services/addFlow.js` (or `src/routes/add.js` where the save result returns), `src/services/editItem.js`, `src/routes/refresh.js`, `src/services/deleteAccount.js`
- Test: `test/services/cache.test.js`, additions in `test/routes/add.test.js`, `test/routes/edit.test.js`

**Interfaces:**
- Produces in `src/services/cache.js`:
  - `itemTagData(db, itemId) => Promise<{ id, eventSlug: string|null, personHandles: string[], accountHandle: string|null } | null>` — one query joining `items`, `events`, `item_people`/`people`, `accounts`.
  - `itemChangeTags(db, itemId) => Promise<string[]>` — `[HOME_TAG, SEARCH_TAG, itemTag(id), eventTag(slug)?, ...personHandles.map(personTag), accountTag(handle)?]`.
  - `accountChangeTags(db, accountId) => Promise<string[]>` — `[HOME_TAG, SEARCH_TAG, accountTag(handle)]` plus every credited item's tags (cap 200 items; `deleted_reason = 'erased'` skipped).
  - `purgeTags(deps, tags) => Promise<void>` — dedupe; **no-op when `!deps.env?.VERCEL`**; otherwise `await (deps.invalidateByTag ?? (await import('@vercel/functions')).invalidateByTag)(tags)`; catches every error and logs exactly `cache purge failed` (no tags, no headers).
  - `purgeItem(deps, itemId)` / `purgeAccount(deps, accountId)` — compute the tags, then `deps.defer ? deps.defer(() => purgeTags(deps, tags)) : await purgeTags(deps, tags)`.
- Wiring (each after its transaction commits, never inside it): the add route on `status` `added` or `attached`; `editItem`; the refresh route when it changed anything; `deleteAccount` for the deleted user's items.
- `LIMITS` gains `remove: { limit: 30, windowSeconds: 3600 }`, `restore: { limit: 30, windowSeconds: 3600 }`, `optOut: { limit: 3, windowSeconds: 86400 }`, `owner: { limit: 300, windowSeconds: 3600 }`.

- [ ] **Step 1: Write the failing tests.**

```js
// test/services/cache.test.js — pure/service level, fake deps
test('itemChangeTags names the item, its event, its people and its translator', ...);
test('nothing is purged when the request is not on Vercel (no VERCEL env)', ...);
test('a purge failure is swallowed and logged once, never thrown', ...); // invalidateByTag rejects; assert no throw + log line
test('purgeItem defers the call when deps.defer exists', ...); // defer collects; assert not called until run
// test/routes/add.test.js (new case): a foreign-origin add is 403 and purges nothing
test('an add on Vercel purges home, search and the new item tags', ...); // env: {VERCEL:'1'}, fake invalidateByTag, settle()
// test/routes/edit.test.js (new case)
test('an edit on Vercel purges the item tags', ...);
```

- [ ] **Step 2: Run them.** **Expected:** FAIL.

- [ ] **Step 3: Implement.** `api/index.js`'s `makeDeps` gains `invalidateByTag` (imported from `@vercel/functions` beside `waitUntil`) so production never relies on the dynamic import; the dynamic import is the fallback for scripts and tests. Inject the fake through `apiFor(deps)` in tests.

- [ ] **Step 4: Run them, then `npm test`.** **Expected:** PASS. Run the Neon suite: `TEST_DATABASE_URL=… npm test -- --test-concurrency=1`.

- [ ] **Step 5: Commit** `feat(cache): purge the CDN after adds, edits and account deletion`.

### Task 4: Translator list, totals and the one-time welcome flag

**Files:**
- Create: `src/services/translator.js`
- Modify: `src/routes/me.js` (`meRoute`, new `translationsRoute`, new `welcomedRoute`), `src/routes/index.js`
- Modify: `src/services/session.js` (`SessionUser.welcomedTranslator`)
- Modify: `src/http/contracts.js` (typedefs)
- Test: `test/services/translator.test.js`, additions in `test/routes/me.test.js`, `test/services/session.test.js`

**Interfaces:**
- Produces:
  - `SessionUser` gains `welcomedTranslator: boolean` (read from `users.meta.translatorWelcomedAt != null` in `loadSessionUser`).
  - `GET /api/me` adds `showTranslatorWelcome: boolean` = `isTranslator(user) && !user.welcomedTranslator`.
  - `GET /api/me/translations?offset` (signed in, `PRIVATE_NO_STORE`) returns `{ items: TranslatorPreview[], hasMore: boolean, totals: TranslatorTotals }`.
  - `TranslatorPreview = AddedPreview & { removedByYou: boolean, hidden: boolean }` — `removedByYou` is `deleted_reason = 'removed_by_account'`, `hidden` is any other deletion (or none) with `review_state = 'rejected'` folded into `reviewState` as today.
  - `POST /api/me/welcomed` (signed in, `NO_STORE`) sets `users.meta.translatorWelcomedAt` and returns `{ ok: true }`; idempotent.
  - `translatorList(deps, user, { offset })`, `markWelcomed(deps, userId)` in `src/services/translator.js`; `TRANSLATOR_PAGE_SIZE = 20`.

- [ ] **Step 1: Write the failing tests.**

```js
// test/services/translator.test.js (seeded DB; insertUser/insertAccount/insertItem credited by account id)
test('the list holds every credited item of every linked account, removed ones flagged', ...);
test('it never lists another translator\'s items nor erased ones', ...);
test('totals count visible items, their events and shared stories', ...);
test('markWelcomed is idempotent and flips showTranslatorWelcome off', ...); // through GET /api/me
// test/routes/me.test.js
test('GET /api/me/translations wants a session', ...); // 401
test('a member with no credited account gets an empty list and zero totals', ...);
```

- [ ] **Step 2: Run them.** **Expected:** FAIL.

- [ ] **Step 3: Implement.** `markWelcomed` runs `update users set meta = meta || jsonb_build_object('translatorWelcomedAt', $2) where id = $1` with an ISO string, so an existing `meta.handle` survives. `translatorList` maps `translatorItemIds` through `previewsForAny`, then merges `translatorStates` (Task 1) into each preview: `removedByYou = reason === 'removed_by_account'`, `hidden = reason !== null && !removedByYou`.

- [ ] **Step 4: Run them, then `npm test`.** **Expected:** PASS.

- [ ] **Step 5: Commit** `feat: translator list, totals and the one-time welcome flag`.

### Task 5: Remove and restore

**Files:**
- Modify: `src/services/translator.js` (`removeEntries`, `restoreEntries`)
- Modify: `src/routes/me.js` (two routes), `src/routes/index.js`
- Test: `test/services/translator.test.js`, `test/routes/meTranslations.test.js`

**Interfaces:**
- Produces:
  - `removeEntries(deps, user, entries) => Promise<{ removed: number }>` and `restoreEntries(deps, user, entries) => Promise<{ restored: number }>`, where `entries` is `{ kind: string, sourceId: string }[]`, **1 to 50**.
  - Both run one transaction under `actor: user.id`. Each entry must resolve through `findItemIdBySource` and have `creditedAccountId` in `user.translatorAccountIds`, else `403 forbidden`; an unresolved entry is `400 unknown item` and **nothing in the batch changes**.
  - Remove: `softDeleteItem(..., reason: 'removed_by_account')`, and an entry already removed is a no-op. Restore: only when `deleted_reason = 'removed_by_account'`; anything else is `409 not_removed_by_you`.
  - Routes `POST /api/me/translations/remove` and `POST /api/me/translations/restore`, both `NO_STORE`, body `{ items: entries }`, rate-limited `remove`/`restore` by `user.id`, each purging `purgeItem` per changed item **after** the commit.
  - `TranslatorPreview.removedByYou` drives the row's "restore" control (Task 11).

- [ ] **Step 1: Write the failing tests.**

```js
// Review Focus 1
test('a removed entry disappears from the item page, search, its event, person and translator pages, and is purged', async () => {
  // seed a visible credited item via ingest helpers; POST remove as its translator;
  // GET /api/item -> 404; /api/search?q=... -> no match; /api/event/:slug section excludes it;
  // /api/account/:handle -> null or no items; invalidateByTag called with home, search, item:<id>, event:<slug>, ...
});
test('a batch with one item of another translator changes nothing', ...); // 403, first item still visible
test('more than 50 entries, or none, is 400', ...);
test('restoring an entry the owner hid is 409', ...);
test('the 31st remove in an hour is 429', ...);
```

- [ ] **Step 2: Run them.** **Expected:** FAIL.

- [ ] **Step 3: Implement.** Resolve all entries first, validate all, then mutate in the same transaction; collect changed item ids for the purge. A 0-change batch still returns 200 with `{ removed: 0 }`.

- [ ] **Step 4: Run them, then `npm test`.** **Expected:** PASS.

- [ ] **Step 5: Commit** `feat: translators remove and restore their own entries`. Text-only controls added later in Task 11 are listed there.

### Task 6: Opt out and opt back in

**Files:**
- Modify: `src/services/translator.js` (`setOptOut`)
- Modify: `src/routes/me.js` (two routes), `src/routes/index.js`
- Test: `test/services/translator.test.js`, `test/routes/meTranslations.test.js`

**Interfaces:**
- Produces:
  - `setOptOut(deps, user, optedOut: boolean) => Promise<{ optedOut: boolean, entries: number }>` — sets/clears `accounts.opted_out_at` for **every** X account with `user_id = user.id` (one transaction, actor `user.id`), returns how many items are affected (`entries` = credited items not erased). A user with no linked account gets `403 not_a_translator`.
  - `POST /api/me/translations/opt-out` and `POST /api/me/translations/opt-in`, `NO_STORE`, rate-limited `optOut` by `user.id`, purging `purgeAccount` after the commit.
  - Opting out does **not** soft-delete anything: `accounts.opted_out_at` already hides items in `src/repo/visibility.js`, `src/repo/hubQueries.js` and `src/repo/itemSources.js`.
  - `GET /api/me` gains `isOptedOut: boolean` = every linked account has `opted_out_at` (false when none), so the page can show "opt back in".

- [ ] **Step 1: Write the failing tests.**

```js
// Review Focus 2
test('opting out hides every credited item everywhere, including the translator page, and purges', async () => {
  // /api/item -> 404, /api/home count drops, /api/account/:handle -> { account: { handle, optedOut: true } }, purge called
});
test('pasting an opted-out translator\'s tweet is refused with opted_out', ...); // POST /api/add/preview
test('opting back in restores exactly the credited items, not one the owner hid', ...);
test('a Google user with no X account cannot opt out', ...); // 403 not_a_translator
test('the 4th opt-out in a day is 429', ...);
```

- [ ] **Step 2: Run them.** **Expected:** FAIL.

- [ ] **Step 3: Implement.** `setOptOut` updates by `user_id` (never by handle) and returns the account count for the error case. Both routes return the new state so the page can re-render without a reload.

- [ ] **Step 4: Run them, then `npm test`.** **Expected:** PASS.

- [ ] **Step 5: Commit** `feat: translators opt out and back in`.

### Task 7: The public report form's API

**Files:**
- Create: `src/services/reports.js`
- Create: `src/routes/reports.js`
- Modify: `src/routes/index.js`
- Modify: `src/http/contracts.js` (`ReportTarget`)
- Test: `test/services/reports.test.js`, `test/routes/reports.test.js`

**Interfaces:**
- Produces:
  - `ReportTarget = { type: 'item', kind: string, sourceId: string } | { type: 'event', slug: string }`.
  - `createReport(deps, { target, reason, reporter }) => Promise<{ id: number }>` — resolves the target to a **visible** item (`findVisibleItemId`) or visible event (`getVisibleEventBySlug`), else `NotFound`; inserts `reports { target_table, target_id, reason, created_by }` with `target_table = 'items'|'events'`, actor `reporter?.id ?? 'system'`.
  - `POST /api/reports`, `NO_STORE`, body `{ target, reason }`, rate-limited `report` by `input.ip` (signed in or not), Origin-checked by the handler.
  - Reason is trimmed; empty or over 2,000 characters is `BadRequest('reason must be 1-2000 characters')`. Duplicate open reports are allowed.
  - Response `{ id }` with 200.

- [ ] **Step 1: Write the failing tests.**

```js
// Review Focus 4
test('a signed-out report on a visible item is stored with no creator', ...);
test('a hidden or unknown target is 404 and writes nothing', ...); // item, and event
test('a 2001-character reason is 400 and a 2000-character one is accepted', ...);
test('the 6th report in an hour from one ip is 429', ...);
test('a foreign origin is 403', ...);
test('a signed-in reporter\'s user id is recorded', ...);
```

- [ ] **Step 2: Run them.** **Expected:** FAIL.

- [ ] **Step 3: Implement.** Reuse `src/http/errors.js` (`BadRequest`, `NotFound`). The route takes `['reason','target']` from the JSON body only (no query). Never log the reason.

- [ ] **Step 4: Run them, then `npm test`.** **Expected:** PASS.

- [ ] **Step 5: Commit** `feat: report intake for items and events`.

### Task 8: Owner API — approval switch and the waiting list

**Files:**
- Create: `src/services/owner.js`
- Create: `src/routes/owner.js`
- Modify: `src/services/session.js` (`requireOwner`)
- Modify: `src/routes/index.js`
- Modify: `src/http/contracts.js` (`OwnerView`, `OwnerUser`, `ReportVM`)
- Test: `test/services/owner.test.js`, `test/routes/owner.test.js`

**Interfaces:**
- Produces:
  - `requireOwner(deps, input) => Promise<SessionUser>` — `requireUser` then `Forbidden('forbidden')` unless `user.isOwner`.
  - `ownerView(deps) => Promise<OwnerView>` = `{ approvalRequired, signInFailedAt: string|null, waiting: AddedPreview[], reports: ReportVM[] }`; waiting is `pendingItemIds({ limit: 50 })` through `previewsForAny` (no deleted items), reports starts as `[]` until Task 9.
  - `setApproval(deps, required: boolean, actor) => Promise<{ approvalRequired: boolean }>` — `settings.approvalRequired`, actor = owner id.
  - `reviewItem(deps, { kind, sourceId, state, actor }) => Promise<{ state }>` — owner only; `findItemIdBySource` (so a pending item is found), `setReviewState`; purges the item after commit.
  - Routes, all owner-only and `PRIVATE_NO_STORE`/`NO_STORE`:
    - `GET /api/owner` (query `[]`) → `OwnerView`
    - `POST /api/owner/approval {required}` (limit `owner`)
    - `POST /api/owner/items/:kind/:sourceId/review {state: 'published'|'rejected'}` (limit `owner`)
  - A non-owner gets `403 forbidden` on all three; a signed-out caller gets `401 signed_out`.

- [ ] **Step 1: Write the failing tests.**

```js
// Review Focus 5
test('with approval on, a new add is pending; it is not public, and the submitter still sees it in added by me', ...);
test('approving publishes it and purges; rejecting hides it but leaves it in the submitter\'s list as rejected', ...);
test('a pasted follow-up added while approval is on is held pending', ...);
test('approvalRequired round-trips through settings and the audit log', ...);
test('a member is 403 on every owner route; a signed-out visitor is 401', ...);
test('the 301st owner write in an hour is 429', ...);
```

- [ ] **Step 2: Run them.** **Expected:** FAIL.

- [ ] **Step 3: Implement.** `reviewItem` rejects an unknown state with `400`. `signInFailedAt` reads `settings.get(db, 'xSignInFailedAt')` and is `null` when missing. `setApproval` is idempotent (writes only a change).

- [ ] **Step 4: Run them, then `npm test`.** **Expected:** PASS. Run the Neon suite.

- [ ] **Step 5: Commit** `feat: owner approval switch, waiting list and review`.

### Task 9: Owner API — the reports queue

**Files:**
- Modify: `src/services/owner.js` (`reportQueue`, `hideReportTarget`, `restoreReportTarget`, `dismissReport`), `ownerView`
- Modify: `src/routes/owner.js`, `src/routes/index.js`
- Test: `test/services/owner.test.js`, `test/routes/owner.test.js`

**Interfaces:**
- Produces:
  - `ReportVM = { id: number, at: string, reason: string, reporter: AddedByVM|null, status: 'open'|'resolved'|'dismissed', target: { type: 'item'|'event', url: string, label: string, hidden: boolean } }`. `url` is `${kind.urlPrefix}${sourceId}` for items and `/e/${slug}` for events; `label` is the event name or the item's preview lines' first line; `hidden` is whether the target is soft-deleted now; `reporter` is `addedByOf(...)` for the report's `created_by` (null for a signed-out or deleted reporter).
  - `reportQueue(deps) => Promise<ReportVM[]>` — every report with `status = 'open'`, newest first, limit 50; a report whose target is gone also appears with `hidden: true` and `url: ''`.
  - `hideReportTarget(deps, { reportId, actor })` — owner; item target → `softDeleteItem(hidden_by_owner)`; event target → `softDeleteEvent` (1a's helper; its items move to unsorted and stay archived); purges the item(s), home and search. **The report stays open** so the row can offer restore.
  - `restoreReportTarget(deps, { reportId, actor })` — only for an item hidden by that action (`restoreItem(hidden_by_owner)`), else `409 not_hidden`; purges.
  - `dismissReport(deps, { reportId, actor })` — sets `status = 'dismissed'` (does not touch the target).
  - Routes: `POST /api/owner/reports/:id/hide`, `/restore`, `/dismiss`, owner-only, limit `owner`.
  - `OwnerView.reports` is `reportQueue(deps)`.

- [ ] **Step 1: Write the failing tests.**

```js
test('open reports list their reason, reporter and a link to the target', ...);
test('hiding an item report soft-deletes it everywhere, keeps the report open, and purge runs', ...);
test('restore brings it back, and restoring twice is 409', ...);
test('hiding an event report soft-deletes the event and moves its items to unsorted, still archived', ...);
test('dismissing resolves nothing public and keeps the target', ...);
test('a signed-out reporter shows as a fan; a deleted one too', ...);
test('only the owner may hide, restore or dismiss', ...);
```

- [ ] **Step 2: Run them.** **Expected:** FAIL.

- [ ] **Step 3: Implement.** Resolve the report row, refuse a missing id with `NotFound`; refuse `status != 'open'` for hide/dismiss with `409 not_open`. Event purge needs the event's item ids: reuse `listVisibleItemIds({ eventId })` before `softDeleteEvent` (it moves them to unsorted, so collect first, tag each item afterwards).

- [ ] **Step 4: Run them, then `npm test`.** **Expected:** PASS.

- [ ] **Step 5: Commit** `feat: owner reports queue with hide, restore and dismiss`.

### Task 10: Owner API — users, blocking and the sign-in alert

**Files:**
- Modify: `src/services/owner.js` (`searchUsers`, `setBlocked`, `clearSignInAlert`), `ownerView`
- Modify: `src/routes/owner.js`, `src/routes/index.js`
- Test: `test/services/owner.test.js`, `test/routes/owner.test.js`

**Interfaces:**
- Produces:
  - `OwnerUser = { id: string, handle: string|null, displayName: string|null, blocked: boolean, isTranslator: boolean, addedCount: number }`.
  - `searchUsers(deps, q) => Promise<OwnerUser[]>` — trimmed `q` of at least 2 characters (else `[]`), matches `lower(users.id)`-independent `accounts.handle` or `users.display_name` with `%q%`, excludes `role = 'system'` and `deleted_at is not null`, limit 20. `handle` is the first X account's current handle; `addedCount` counts `items.created_by = users.id` not erased.
  - `setBlocked(deps, { userId, blocked, actor }) => Promise<{ hidden: number, restored: number }>` — one transaction: set/clear `users.blocked_at`; on block `softDeleteItem(blocked_submitter)` for every live item with `created_by = userId`; on unblock `restoreItem(blocked_submitter)` for that user's items only. Refuses the owner's own id and `system` with `409`.
  - `clearSignInAlert(deps, actor)` — `settings.set('xSignInFailedAt', null)`.
  - Routes: `GET /api/owner/users?q=` (`PRIVATE_NO_STORE`, query `['q']`), `POST /api/owner/users/block {userId}`, `POST /api/owner/users/unblock {userId}`, `POST /api/owner/sign-in-alert/dismiss`; owner-only, limit `owner`, purge after each block/unblock.
  - `OwnerView` stays `{ approvalRequired, signInFailedAt, waiting, reports }`; users are fetched by the page only when the owner searches.

- [ ] **Step 1: Write the failing tests.**

```js
// Review Focus 3
test('blocking hides every live submission of that user and refuses their next add with 403 blocked', ...);
test('a blocked user\'s session still reads, but add, edit, remove, restore and follow-ups are 403', ...);
test('blocking does not hide an item merely credited to their X account', ...);
test('unblocking restores only blocked_submitter items, not owner-hidden ones', ...);
test('the owner cannot block themselves or the system user', ...);
test('users are searchable by handle or display name, never the system user', ...);
test('clearing the sign-in alert empties signInFailedAt', ...);
```

- [ ] **Step 2: Run them.** **Expected:** FAIL.

- [ ] **Step 3: Implement.** Search with one SQL query and `%` escaped for `_`/`%` in `q`; blocking uses the repo helpers, never raw SQL in the service. A block count of 0 still succeeds.

- [ ] **Step 4: Run them, then `npm test`.** **Expected:** PASS, plus the Neon run and the end-of-plan full pass.

- [ ] **Step 5: Commit** `feat: owner users search, blocking and the sign-in alert`.

### Task 11: Me page — translator welcome, my translations, remove/restore, opt out/in

**Files:**
- Create: `public/js/components/meTranslations.js`
- Modify: `public/js/pages/me.js`
- Modify: `src/styles/components/me.css`
- Modify: `src/site/copyDefaults.json`
- Modify: `src/routes/authDev.js` (`as: 'translator'` for e2e)
- Test: `test/components/meTranslations.test.js`, additions in `test/routes/me.test.js`, `e2e/me-translator.spec.js`

**Interfaces:**
- Consumes: Task 4's `GET /api/me/translations` and `POST /api/me/welcomed`; Task 5's remove/restore; Task 6's opt-out/opt-in; `me.translations.*`, `me.optOut.*`, `me.welcome.*` copy keys.
- Produces:
  - `meTranslations.render({ state })` where `state = { items, hasMore, totals, selected: Set<string>, optedOut, welcome: boolean }`, and `meTranslations.bind(root, state)`. One component owns the section, including the selection bar, removed rows and the opt-out box.
  - The me page for a translator shows, in order: the one-time welcome (when `showTranslatorWelcome`), then a segmented control **my translations · added by me**, then the selected tab's list. The head's handle gains the badge `me.translatorBadge` ("✓ translator"). A non-translator sees only "added by me", exactly as in 2a. A translator's default tab is "my translations".
  - Copy keys (add all to `copyDefaults.json`): `me.translatorBadge` ("✓ translator"), `me.translations.title` ("my translations"), `me.translations.addedByMe` ("added by me"), `me.translations.empty` ("no translations yet"), `me.translations.selected` ("{count} selected"), `me.translations.remove` ("remove from archive"), `me.translations.removedByYou` ("removed by you"), `me.translations.hidden` ("hidden"), `me.translations.restore` ("restore"), `me.translations.more` ("more"), `me.translations.failed` ("couldn't save that — try again"), `me.optOut.title` ("opt out"), `me.optOut.body` ("removes all {count} of your translations and stops anyone adding your tweets in future. you can opt back in any time."), `me.optOut.confirm` ("yes, i would like to opt out"), `me.optOut.done` ("you have opted out"), `me.optOut.back` ("opt back in"), `me.welcome.hi` ("hi @{handle}"), `me.welcome.badge` ("✓ recognised as a translator"), `me.welcome.totals` ("{translations} translations · {events} events · {sharedStories} shared stories"), `me.welcome.add` ("add a translation"), `me.welcome.see` ("see my translations").
  - Icon buttons: none new in this task except per-row checkbox controls; the text-only controls are "remove from archive", "restore", "opt out"/"yes, i would like to opt out" and "opt back in" — name them in the commit message.
  - `POST /api/auth/dev {as: 'translator'}` signs in as the first X account with an `external_id` (order by `accounts.id`), returning `{ ok: true, handle }`; no account → `404`. Dev-only, as today.
  - Welcome persistence: the page posts `/api/me/welcomed` once the welcome has rendered, so a reload opens straight to the list.

- [ ] **Step 1: Write the failing tests.**

```js
// test/components/meTranslations.test.js (miniDom)
test('a removed entry renders faded with a restore control; a hidden one has none', ...);
test('selecting two entries shows "2 selected" and enables remove', ...);
test('the opt-out box names the translator\'s total and its button is the full-width confirm', ...);
test('opted out: the box offers "opt back in" instead', ...);
test('the welcome shows the handle, badge and totals, then disappears once marked', ...); // via composer state
// test/routes/me.test.js
test('the dev translator sign-in returns a handle and a session', ...); // env DEV_SIGN_IN=1
// e2e/me-translator.spec.js
test('translator signs in: welcome once, then my translations; remove shows restore; opt back in works', ...);
test('axe is clean on /me as a translator at both widths', ...); // checkPage + assertNoSeriousA11yViolations
```

- [ ] **Step 2: Run them.** **Expected:** FAIL.

- [ ] **Step 3: Implement.** Keep `me.js` under the lint line limit: the component owns the markup, the page owns fetching and state. Selection is a `Set<"kind:sourceId">`; after a successful remove the page refetches `/api/me/translations` and re-renders; a failed write shows `me.translations.failed` in a `role="status"` line. The welcome's totals come from the translations response (the page fetches both on load when signed in and a translator).

- [ ] **Step 4: Run** `npm test`, `npm run build`, `npm run e2e`. **Expected:** PASS.

- [ ] **Step 5: Commit** `feat(web): translator welcome, my translations, remove/restore and opt out`. List the text-only controls.

### Task 12: The report form on item and event pages

**Files:**
- Create: `public/js/components/reportForm.js`
- Create: `src/styles/components/report.css`
- Modify: `public/js/pages/itemFooter.js`, `public/js/pages/item.js`, `public/js/pages/event.js`
- Modify: `src/site/copyDefaults.json`
- Test: `test/components/reportForm.test.js`, `e2e/report.spec.js`

**Interfaces:**
- Consumes: Task 7's `POST /api/reports`.
- Produces:
  - `reportForm.render({ target })` → a `<dialog>` with a `<textarea maxlength="2000">`, the reason label, a submit button and cancel; `reportForm.bind(root, { target })` wires the page's `[data-action="report"]` trigger to `showModal()` and the form to `postJson('/api/reports', { target, reason })`.
  - `target` is `{ type: 'item', kind, sourceId }` on the item page and `{ type: 'event', slug }` on the event page.
  - The item footer's `.c-item__footer-link` to `/takedown` becomes `<button type="button" data-action="report">` with the same `item.report` copy; the event page's `.c-event__report` link becomes the same kind of trigger.
  - Copy keys: `report.title` ("report this"), `report.reason` ("what's wrong?"), `report.submit` ("send report"), `report.cancel` ("cancel"), `report.done` ("thanks — the owner will look at it"), `report.failed` ("couldn't send that — try again"), `report.tooLong` ("keep it under 2,000 characters").
  - The dialog is one instance per page, mounted with the page's markup. Submitting disables the button, shows `report.done` (a `role="status"` line) and closes after success; a failure keeps the dialog open and shows `report.failed`.

- [ ] **Step 1: Write the failing tests.**

```js
// test/components/reportForm.test.js
test('the dialog is labelled, caps the reason at 2000 and has a submit and cancel', ...);
test('submitting posts the page\'s target and the trimmed reason', ...); // fake fetch through getJson/postJson stub
test('success announces and closes; failure keeps it open with a message', ...);
test('the item footer and the event page render a report trigger, not a /takedown link', ...);
// e2e/report.spec.js
test('reporting an item from its page shows the thank-you and reaches the owner queue', ...);
test('axe is clean with the report dialog open at both widths', ...);
```

- [ ] **Step 2: Run them.** **Expected:** FAIL.

- [ ] **Step 3: Implement.** Reuse the dialog plumbing already used by `zoomDialog.js`/`filterSheet.js` (focus trap, Escape, return focus). The event page knows its slug from the fetched view, so `bind` receives the target after the fetch.

- [ ] **Step 4: Run** `npm test`, `npm run build`, `npm run e2e`. **Expected:** PASS.

- [ ] **Step 5: Commit** `feat(web): report form on item and event pages`.

### Task 13: The owner section on the me page

**Files:**
- Create: `public/js/components/ownerSection.js`
- Create: `src/styles/components/owner.css`
- Modify: `public/js/pages/me.js`
- Modify: `src/site/copyDefaults.json`
- Test: `test/components/ownerSection.test.js`, `e2e/owner.spec.js`

**Interfaces:**
- Consumes: Tasks 8–10 (`GET /api/owner`, approval, review, reports hide/restore/dismiss, users search/block/unblock, sign-in alert dismiss).
- Produces:
  - `ownerSection.render({ owner })` where `owner = { approvalRequired, signInFailedAt, waiting, reports, users: OwnerUser[]|null, query: string }`, plus `ownerSection.bind(root, state)`. Shown only when `me.user.isOwner`.
  - Layout, in order: the sign-in alert (when `signInFailedAt`), the approval switch (a labelled checkbox), "waiting" rows (preview card + approve and reject icon buttons), "reports" rows (reason, reporter, target link, and hide / restore / dismiss icon buttons), and "users" (search input, results with a block/unblock icon button).
  - Every icon button carries `title` + `aria-label` from one copy key; the only text controls are the approval switch's label and the users search input's label.
  - Copy keys: `owner.title` ("owner"), `owner.alert` ("an X sign-in failed at {time}"), `owner.alertDismiss` ("dismiss"), `owner.approval` ("new submissions need approval"), `owner.waiting` ("waiting"), `owner.waitingEmpty` ("nothing waiting"), `owner.approve` ("approve"), `owner.reject` ("reject"), `owner.reports` ("reports"), `owner.reportsEmpty` ("no open reports"), `owner.reportBy` ("reported by {who}"), `owner.hide` ("hide"), `owner.restore` ("restore"), `owner.dismiss` ("dismiss report"), `owner.hidden` ("hidden"), `owner.users` ("users"), `owner.usersSearch` ("search by handle or name"), `owner.block` ("block"), `owner.unblock` ("unblock"), `owner.blocked` ("blocked"), `owner.noUsers` ("no matches"), `owner.failed` ("couldn't save that — try again").
  - Actions re-render from the server's answer or refetch `GET /api/owner`; a failed write shows `owner.failed` in a `role="status"` line.
  - The section is inside the me page, under the "added by me" content, and never shown to a member.

- [ ] **Step 1: Write the failing tests.**

```js
// test/components/ownerSection.test.js
test('the approval switch reflects and posts its state', ...);
test('a waiting row links to the entry and offers approve and reject', ...);
test('a report row shows the reason and reporter, and hide then restore replaces the action', ...);
test('users search renders matches with block/unblock and a blocked badge', ...);
test('the sign-in alert shows its time and a dismiss control', ...);
test('every icon button in the section has both title and aria-label', ...);
// e2e/owner.spec.js
test('owner toggles approval, an add waits, approve publishes it', ...);
test('owner hides a reported item and restores it', ...);
test('owner blocks and unblocks a user', ...);
test('axe is clean on /me as the owner at both widths', ...);
```

- [ ] **Step 2: Run them.** **Expected:** FAIL.

- [ ] **Step 3: Implement.** Keep the page under the lint line limit by letting `ownerSection` own its markup and binds. Use `pageShell`/`previewCard` as the me page already does. The e2e's pending add reuses `add.spec.js`'s fixture tweet URL constant; the owner adds it while approval is on.

- [ ] **Step 4: Run** `npm test`, `npm run build`, `npm run e2e`. **Expected:** PASS.

- [ ] **Step 5: Commit** `feat(web): owner section for approval, waiting, reports and users`.

### Task 14: Docs, version and release

**Files:**
- Modify: `CHANGELOG.md` (0.3.0), `package.json` (0.3.0)
- Modify: `docs/start-your-own.md`, `docs/limits.md`, `docs/architecture.md`
- Test: the existing purity and doc tests (`test/purity.test.js`, `test/docs.test.js` if present)

- [ ] **Step 1: Write the docs.**
  - **start-your-own:** nothing new to configure; note that cache tagging needs no setup and is a no-op outside Vercel.
  - **limits:** the four new rate limits (remove 30/h, restore 30/h, opt-out 3/day, owner writes 300/h) and Vercel's purge limits (Hobby 50 calls/s, ≤128 tags per response, cited from the purge docs page).
  - **architecture:** the tag scheme (`home`, `search`, `item:<id>`, `event:<slug>`, `person:<handle>`, `account:<handle>`), which writes purge, and that a purge never fails a write.
  - **CHANGELOG 0.3.0 upgrade steps:** merge the tag; **no migrations**; the new copy keys (`me.translations.*`, `me.optOut.*`, `me.welcome.*`, `report.*`, `owner.*`); `npm run build`; redeploy. Note that removed content stops being served once the new deployment is live, and that the item page's report link is now a form.
- [ ] **Step 2: Run** `npm run check`, `npm test`, `npm run build`, `npm run e2e`. **Expected:** all PASS, and the purity scan clean (no fandom names in engine docs).
- [ ] **Step 3: Commit** `Release 0.3.0: translators and the owner` and tag `v0.3.0` locally. **Ask the owner before pushing** `fan-archive` or merging into `emibonnie-archive`.

---

## Calls made in this plan (owner to check)

- **Cache tags are coarse and per page, not per item everywhere.** `home` and `search` are single tags; event, person, translator and item pages carry their own. A change purges all of an item's tags in one `invalidateByTag` call, deferred through `waitUntil`; a failure is logged and never fails the write. Purging is also added to **new adds**, **approve/restore/unblock** and **account deletion**, beyond the spec's "remove, opt-out, hide, block, reject and edit", because those also change cached pages.
- **No migration in 2b.** Every column and table it needs exists from 001/002; the welcome flag is `users.meta.translatorWelcomedAt`.
- **Owner hide keeps the report open**, so the row can offer "restore" — that is where the spec's "only the owner can undo a hide" lives. Dismiss is the separate action that closes a report.
- **An event report's hide soft-deletes the event** and moves its items to unsorted (1a's `softDeleteEvent`), so the items stay archived. Only the event page disappears.
- **Reject is `review_state = 'rejected'`, not a soft delete.** It leaves the public surfaces (visibility already filters on `published`) and stays in the submitter's "added by me" list as "not accepted".
- **Blocking hides submissions only** (`items.created_by`), not items merely credited to the same X account. Translator credit is governed by opt-out.
- **Opt-out sets `accounts.opted_out_at` on every X account linked to the user**; it never soft-deletes. That is what makes opt-in restore exactly those items.
- **Bulk remove/restore is capped at 50 entries and all-or-nothing**, so a partly-invalid batch changes nothing.
- **Duplicate reports are allowed** (rate-limited by IP); the owner dismisses the extras.
- **The welcome is marked seen when it is shown**, so a reload opens straight to "my translations".
- **`as: 'translator'` dev sign-in** picks the first credited X account in the local database; it exists only under `DEV_SIGN_IN=1` with no `VERCEL`, as today.
- **Text-only controls** (flagged per commit): "remove from archive", "restore", "opt out" / "yes, i would like to opt out", "opt back in", "send report", the approval switch's label, and the users search input's label.
