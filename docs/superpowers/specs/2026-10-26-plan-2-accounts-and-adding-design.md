# Plan 2: accounts and adding — design

Date: 2026-10-26
Status: draft for owner review
Builds on: `2026-10-21-translation-archive-design.md` (the "main design"). Where this document is silent, the main design stands. Where they differ, this document wins.

## Why this exists

After Plans 1a and 1b, the archive can be read but only the owner can add to it, through the CLI. Plan 2 opens it up: anyone can sign in and add a tweet, translators get control over their own work, and the owner gets the minimum tools to keep the site clean, until the full admin pages arrive in Plan 3.

The owner's biggest worry (2026-10-26) is that **tweets are handwritten, so the possible formats never end**. The add flow must work for whatever turns up, not just for the formats the parser knows. That shapes everything below.

## Goals

1. **Anyone signed in can add any tweet that carries a translation.** That includes a clip, still pictures, a text-only post, a quoted post, and a clip that is **already subbed** (English burned into the video).
2. **The adder is the source of truth.** The parser gives a head start. Whatever it misses, the adder can fix, and nothing is ever refused because of how it's written.
3. **Mistakes can be fixed after saving.** Entries can be edited later, and every change is logged.
4. **Translators control their own work.** They're recognised automatically, and they can remove, restore, opt out and opt back in.
5. **The owner can keep the site clean without the admin pages.** That means blocking, the approval switch, held entries and reports.
6. **The main design's privacy and security rules hold.** Narrow X scopes, rate limits backed by the database, and removed content leaving every public surface.

## Non-goals (Plan 2)

- The admin pages, bulk import (Notion or paste), the health check, the weekly backup and the erasure script. These are Plan 3.
- **Search for subbed clips** (owner, 2026-10-26: "subbed clips can be unsearchable for now"). They're archived, credited and browsable on their event and translator pages, but search won't find them by what's said in the video.
- New parser rules for rare formats. The fix for a badly parsed tweet is a better adder tool, not another rule (owner, 2026-10-23).
- More moderators besides the owner.

## Anti-goals

The main design's anti-goals all apply. In addition:
- **A tweet that can't be archived because of how it's formatted or what media it has.**
- **The parser deleting or rewriting the translator's text.** It may recognise markers and tags. Any clean-up is a person's edit, and the original text is always kept verbatim (owner, 2026-10-23).
- **An entry that shows publicly after it's been removed, opted out, hidden or blocked**, including copies in the CDN cache.
- **A Google display name, or anything that looks like an X handle, passing as a translator.**

## Who does what

Roles are as in the main design ("Who uses it", "Sign-in and roles"), unchanged:

| | Reader | Signed-in fan | Translator (X sign-in matches a credited account) | Owner |
|---|---|---|---|---|
| Browse, search, report | ✓ | ✓ | ✓ | ✓ |
| Add a tweet | | ✓ | ✓ | ✓ |
| Edit entries they added | | ✓ | ✓ | ✓ |
| Edit details of their own translations (not the text) | | | ✓ | ✓ |
| Remove / restore their own translations; opt out / in | | | ✓ | |
| Hide anything; block users; approval switch; held entries; reports | | | | ✓ |
| Delete their own account | | ✓ | ✓ | ✓ |

## Sign-in

As in the main design, "Sign-in and roles":
- **X** uses OAuth 2.0 with PKCE and the scopes `users.read tweet.read` only. A test checks the scopes requested. One `GET /2/users/me` call after sign-in gets the numeric ID and handle. No email or picture is stored.
- **Google** is the backup sign-in. Google users pick a public display name the first time they add something. That name is cleaned (no leading `@`, no invisible characters) and shown differently from an X handle.
- **Store only the chosen public name in `users.display_name`.** Never the Google profile name, since "added by" shows it publicly (carried over from 1a).
- **Sessions last 7 days.** The owner can sign out all of their own sessions. Better Auth's telemetry is off. Request headers never go into error logs.
- **Owner:** set by numeric X user ID in site config.
- **Translator recognition:** by numeric X ID only, never by handle.
- If X fails at the `/2/users/me` step, the user gets a clear message and the failure is recorded for the owner. In Plan 2 it shows on the owner section of the me page (see below).
- The sign-in screen is as in mockup `translator-signin-v2.html`.

Library: the main design names **Better Auth**. The builder confirms it works with the engine's plain-JS, no-framework setup (ADR 0001) and its layer rules (ADR 0002), with its tables added through a normal migration (ADR 0004). If it doesn't fit, a small hand-written OAuth flow is fine, as long as the scope, session and storage rules above hold.

## Adding a tweet

The three steps from the main design ("Intake", "The add flow, in three steps") stand: **paste a link → check the details → who's speaking**. Plan 2 changes the third step and widens what's accepted.

### 1. Paste a link

- The step shows "adding as @handle", or the chosen name for a Google user.
- The existing intake outcomes each get a clear screen, never a dead end:
  - **Duplicate:** a link to the existing entry.
  - **Already removed, opted out, or blocked submitter:** a plain explanation.
  - **Attached:** "added as a follow-up to …", with a link.
  - **Deleted / unavailable:** the main design's manual-text fallback. The entry is held for approval unless the translator is the one adding it.
  - **Pending:** "waiting for the owner to approve".
- Pasting a follow-up's link on its own attaches it to its translation, as now.

### 2. Check the details

As in the main design and mockups `add-flow-v1.html`, `add-flow-live.html`, `add-flow-separate.html` and `shared-stories-v2.html`:
- Placement: event, shared story, post, or unsorted.
- Event: the match, a new event (with a typed title, as of 0.1.5), or the picker.
- Hashtags, type, client/media, clip by, "follows on from", and "＋ add follow-up tweet".

**Any media shape is accepted, with no extra questions.** The engine already detects and displays each one: a clip, pictures, a quote card (with its own pictures or clip), or a text post with nothing pinned. This step just previews whatever was found.

**Already subbed.** The adder can tick "this clip is already subbed". A subbed entry:
- needs no speaker mapping (step 3 is skipped);
- stores the tweet's own text verbatim as its text, as every entry does (often just a caption and hashtags);
- is **left out of text search** (the non-goal above), but is listed on its event, person and translator pages like any other entry;
- shows a small "subbed" marker on its card and item page.

The translator credit goes to the tweet's author, as for every translation. Whether "subbed" is a new Type value or a separate flag on the entry is the builder's call. A flag is the safer choice, since Type is an owner-managed list.

### 3. Who's speaking (changed: it helps, it doesn't gate)

The main design's step 3 kept Save disabled until every marker was mapped. **That gate goes.** The engine's `needs_speakers` refusal must not block a submitted entry.

- **Markers found:** each one has a dropdown, pre-filled with remembered and default answers (labelled "remembered"). Known people with IG handles come first, then search, then "＋ add a new person" (asks for the IG handle), then the generic roles. As now.
- **Unmapped markers are allowed.** The entry saves, and those lines show as the marker itself, as the presenter already does for an unmapped marker. A gentle note says "N not mapped yet — you can fix this later".
- **No markers found:** the entry saves as plain text, with no speakers. That's a normal outcome, not an error.
- **Line-by-line fixing.** For any line, the adder can:
  - mark it as **speech** or **plain** (overriding the parser's `isSpeechLine` guess);
  - **pick its speaker**, even where the parser found no marker, or where one marker means different people on different lines.
  - These choices are stored **beside** the text, never in it. The text stays verbatim and the bubbles are a view on top of it. Search uses the same view, so a speaker picked by hand counts for "who's in it".
- Marker-level answers are still remembered per translator for next time. Line-level fixes are per entry and aren't remembered.

**Storage.** Today speakers are stored per marker (`translation_speakers`). Line-level overrides need somewhere to live, such as a per-entry list of `{ part, line, speech|plain, personId|role }`. The shape is the builder's call. It must leave the text untouched, go through the audit log, and work with the existing remap.

### Saving

- The entry is **live immediately**, unless the approval switch is on, the text was entered by hand, or the submitter is blocked.
- "Added by" shows the X handle, or the chosen name for a Google user.
- Rate limits apply (see Security).

### Follow-ups (carried over from 1a)

- The **"check for follow-ups"** button on the translation page is wired to the kind's `checkFollowUps` method. It's shown to the translator, the submitter and the owner. New same-author follow-ups are added as new parts, logged.
- **An attached follow-up respects the approval switch.** When approval is on, or the submitter would otherwise be held, the new part waits for the owner like a new entry would. Today it ignores `approvalRequired`.
- **User-facing intake can only pick existing categories** (types). `ensureLookup` must not create one from a submitter's input. Only the owner adds to the Type and Client/Media lists.

## Editing after saving

Editing is in Plan 2 (owner, 2026-10-26). As in the main design's "Editing":
- **The submitter** can edit entries they added: placement, event, details, the speaker map and line fixes. Moving an entry to another event never changes that event's own details.
- **The translator** can edit the details of their own translations (speaker map, line fixes, type, event, order), **but not the text**.
- **The owner** can edit everything, including an event's own details.
- The edit screen is the add flow's steps 2 and 3, opened on the saved entry, with no new layout.
- **Every edit is logged** (who, when, before and after) through the existing audit trigger. The owner can undo a change from the log. In Plan 2 that's a revert of a single edit from the entry's history. A full history browser waits for admin in Plan 3.
- Editing doesn't re-fetch the tweet. "Check for update" and "check for follow-ups" do that.

## The me page

As in the main design, mockup `people-me-v1.html`:
- **Everyone** sees "added by me", with edit on each entry, and **delete my account**. That removes their sign-in records, and their past "added by" shows as "a fan".
- **Translators** also get the ✓ translator badge and "my translations":
  - multi-select, then "remove from archive";
  - removed entries stay listed, faded, with "restore";
  - the solid red **opt out** box, worded as in the main design, with the full-width button "yes, i would like to opt out";
  - when opted out, an "opt back in" control.
- Translator copy says "remove", never "hide".
- **First sign-in as a translator:** the one-time welcome ("hi @handle", "✓ recognised as a translator", the totals, then the four options with opt out as the solid red bar). After that, "me" opens straight to their translations.

### Owner section (my call, until admin in Plan 3)

The owner's me page gets an **owner** section, shown only to the owner, with four lists:
1. **Approval switch:** "new submissions need approval", on or off. It's a row in `settings`. Off at launch.
2. **Waiting:** held entries (`review_state = 'pending'`) with approve or reject.
3. **Reports:** open reports with a link to what was reported, then hide it or dismiss the report.
4. **Users:** search by handle or name, then block or unblock. Blocking hides that user's submissions (`deleted_reason = 'blocked_submitter'`) and stops them adding.

It also shows the X sign-in failure note, if there's one. These are plain lists. Plan 3's admin can take them over.

## Remove, opt-out, hide and the cache

- **Remove** (translator), **opt out** (translator, whole account), **hide** (owner) and **block** (owner) all soft-delete with their `deleted_reason`. The entry leaves search, event pages, person and translator pages, link previews and every API response. Undo restores it, and only the owner can undo a hide or a block.
- **Opted-out accounts** can't be added again by anyone. The submitter gets a clear message. The translator page says only "this translator has opted out", as now.
- **The CDN cache must forget removed content** (carried over from 1a). Public pages are cached with `s-maxage=300, stale-while-revalidate=86400`, so without purging, a removed entry could still be served from the cache. On remove, opt-out, hide, block, reject and edit, the site purges the affected pages: the entry, its event, its people, its translator, home and search. The builder checks **Vercel's current cache-tag documentation** (tagging responses and invalidating by tag, as exposed through `@vercel/functions`) and cites it in the plan. If tagging isn't available on the free tier, the fallback is shorter `stale-while-revalidate` on hub pages. That fallback is the owner's decision, so bring it back to them.

## Reports

- Report links (event and translation pages) open a short form: a reason of up to 2,000 characters, which matches the `reports` table. That replaces today's placeholder page.
- Reporting doesn't need sign-in. It's rate-limited by IP and needs a POST with an Origin check.
- Reports land in the owner section. Reports and the audit log are pruned after 12–24 months, as in the main design. The pruning job itself is Plan 3.

## Security

From the main design, "Security basics", now built:
- **Rate limits backed by the database** on sign-in and every write: add, edit, remove, opt-out, report, check for update, check for follow-ups, delete account. They're keyed by user, and by IP for signed-out reports. The builder picks the limits and lists them in the plan.
- Writes are POST-only with an Origin check, using the existing same-origin rule plus `ALLOWED_ORIGINS`.
- Credit only ever goes to an author ID returned by a source, never to a typed handle.
- Recognition and owner checks use only the numeric X ID from the sign-in record.
- The app's database role can't edit or delete audit rows, as now.
- Session cookies are `HttpOnly`, `Secure` and `SameSite=Lax`.

## Template rules

The engine stays fandom-neutral. Everything new is in the engine (`fan-archive`) with copy keys and no emibonnie names. Each release lists upgrade steps in the CHANGELOG, as for 0.1.x. New buttons are **icons with a `title` tooltip and an `aria-label` from a copy key** (owner preference, 2026-10-23). Text stays only where an icon can't be understood alone, and the builder flags each of those to the owner. New site config (owner X ID, OAuth client IDs) goes in `site/` and env vars, documented in `start-your-own.md`.

## Build order (two plans)

- **2a: sign-in, adding and editing.**
  - Sign-in with X and Google, sessions, rate limits.
  - The add page (all three steps, the subbed tick, line-level fixes, no speaker gate).
  - Editing with the audit revert.
  - Check for follow-ups.
  - The approval switch as a setting, and the attached-follow-up and category fixes.
  - The me page's "added by me" and delete account.
- **2b: translators and the owner.**
  - Translator recognition and welcome, remove and restore, opt-out and opt back in.
  - The owner section: waiting, reports, users and blocking, sign-in alert.
  - The report form.
  - CDN purge on every removal path.

2a ships first so real people can start adding. Until 2b, removal requests still go through the contact link, as in the 1b launch checklist.

## Calls made while writing this (owner to check)

- **Owner section on the me page** stands in for admin until Plan 3.
- **Subbed in search:** a typed query skips subbed entries. Browsing with only filters (empty box) includes them, so they're still reachable from the filter sheet.
- **Line fixes after a text update:** if "check for update" replaces a part's text (the edit-window exception), that part's line-level fixes are dropped and the entry gets an "N not mapped yet" note again. Marker-level answers are kept.
- **Undo in Plan 2** means reverting a single edit from an entry's history, owner only.
- **Reporting needs no sign-in**, rate-limited by IP.
- **2a before 2b**, with removal requests going through the contact link in between.

## Left to the builder

- The storage shape for line-level speaker fixes and the "subbed" flag, within the rules above.
- Rate-limit numbers and the table design.
- Better Auth or a small hand-written flow (see Sign-in).
- The page layout for the edit screen and owner section, reusing existing components and the icon-button rule.
- The cache-tag scheme, cited from Vercel's docs.

## Later

- Search for subbed clips: typed key lines, or subtitles from the video.
- A full history browser and the rest of admin (Plan 3).
