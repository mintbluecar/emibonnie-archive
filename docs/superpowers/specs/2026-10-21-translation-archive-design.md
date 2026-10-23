# EmiBonnie Translation Archive: design

Date: 2026-10-21
Status: draft for owner review

## Why this exists

Fans of emi and bonnie watch Thai-language clips and streams. Fan translators on X clip moments and post the English translation as a tweet, with the clip attached. X is a poor long-term home for this:

- Tweets get deleted and accounts get suspended. When that happens, the translation is lost.
- X search is too weak to find a particular line. Today the owner finds an old translation by remembering the line, working out which event it came from, looking up the event's date in a personal chat full of saved links, and then scrolling a translator's profile filtered by date. This works when there is one translator. It breaks down as more translators appear.
- New fans have no way to catch up on what was said at past events.

One translator keeps a detailed Notion database of their own work. It's thorough but covers only that translator and is maintained by hand.

The archive is a website, friendly on mobile and on desktop, that keeps the translations permanently with correct credit and makes them easy to browse and search.

## Long-term vision (owner's, 2026-10-21)

Translations are the **immediate need** and the only thing this version builds. In the long run, the archive becomes a full history of the pair, modelled on the owner's private Telegram channel. Its topics map to the archive like this:
- **projects:** series and campaigns, e.g. MOONSHADOW, LOVE OF…
- **songs:** lyrics as Thai / romanisation / English triplets, plus audio
- **people pages:** emi, bonnie
- **milestones:** "notes to self"
- **media:** photos and videos from events, linked or embedded, not copied
- **YouTube videos and interviews**
- **translations**

So the design is built around **hubs** (people, events, later projects) with **item kinds** attached. A translation is the first item kind. New kinds are added through one recipe without reworking existing ones. A Telegram export could later become another import source.

## Goals

1. **Preserve.** Once a translation is archived, its text and credits survive even if the tweet is deleted or the account is suspended.
2. **Find by what was said.** Full-text search across translation text, including Thai characters that appear in translations.
3. **Browse by event.** An events timeline is the home screen. Each event page lists its translations in the order things happened.
4. **Low-effort intake.** Anyone signed in pastes a tweet link. The site fills in everything it can, and the submitter confirms or corrects it.
5. **Watch while reading.** The clip plays in a player that stays in view while the translation scrolls.
6. **Respect translators.** Credit is always shown. Translators can remove their entries or opt out entirely.
7. **Near-zero running cost.** The site runs on free tiers.
8. **Reusable by other fandoms** (owner's dream). Anyone who wants an archive for their favourite pair or group can copy the project as a template, fill in one `site/` folder, and deploy their own. They can keep pulling in improvements without conflicts. emibonnie is the first site built on it.

## Non-goals (this version)

- Collecting tweets automatically from translators' accounts. Every entry starts from a link someone provides (pasted, bulk-pasted, or imported). Watching timelines may come later.
- Storing copies of video files. Clips are played from X's servers and are only linked, never copied.
- Subtitles on full-length streams (matching clips to their place in the original stream). See "Later" below.
- Moderation by anyone other than the owner.
- Native mobile apps.

## Anti-goals (would make it a failure even if it works)

- The shared template shipping anyone's real translations, or anything that names the owner.
- Engine code that hardcodes one fandom (names, colours, emoji, hashtags), so another fandom would have to edit the engine.

- A translation shown without credit to its translator, or attributed to the wrong person.
- Altering a translator's words. The original text is always stored and displayable exactly as posted. Any formatting (speaker bubbles) is a view on top of it.
- Removed or opted-out content still being publicly reachable through the site or its public outputs.
- A dull wall of text. Speaker presentation should feel lively (see "Speaker display").
- A bill that grows with usage, or depending on the paid X API to function.

## Who uses it

- **Readers** (no sign-in needed): browse events, search, read translations, and watch clips.
- **Submitters** (signed in): paste tweet links, confirm details, and map speakers.
- **Translators** (signed in with X): everything submitters can do, plus remove their own entries and opt out.
- **Owner** (single admin): sort, edit, reorder, hide, block users, manage people and events, and set ignored hashtags.

## Core concepts

### Items and item kinds

Everything archived is an **item** of some **kind**. This version has one kind: `translation`.
- **Fields every item shares:** the event it belongs to (or none), placement (`event` / `shared_story` / `unsorted`), date, people, the credited X account (the translator, for translations), source link and ID, source status (live / deleted / unavailable), added by, how it was added, removal fields, and order within the event.
- **Kind-specific fields** live in that kind's own table (e.g. `translations`: text, speaker map, keyword, follow-ups, clip source).
- **Remove and opt-out work on the shared fields,** so they cover every future kind automatically. A translator who opts out has every item credited to them removed, whatever its kind.
- **Event, person and search pages show items in per-kind sections.** This version has only the translations section. A new kind adds a section.
- **Projects** (a series or campaign that groups events) are a later hub, added as their own table that events point to.

### Data model principles (owner's request: minimise future schema changes, normalise)

- **Every main table has the same bookkeeping columns:** created/updated time and by whom, soft-delete time and by whom, and a `meta` field for display-only extras. Nothing is hard-deleted.
- **An automatic audit log** records every change and who made it. This is the edit log.
- **Repeated values are stored once and referenced:** platforms, categories (types), clients, tags (hashtags and keywords), and accounts.
- **Relations are join tables:** people on items (with role: present / sharing / about), tags, sources (primary, follow-ups, media/clip source, quoted, full video), links between items (follows on), and translation speakers.
- **Accounts and sources are multi-platform** (X, Instagram, TikTok, YouTube, Weverse, Telegram). A person's identity is their Instagram account.
- **Already in place for what's planned:** projects, reports, users, runtime settings, the import queue, and an approval state on items.
- **Expert review fixes:**
  - **Audit log:** it stores only what changed. It also covers the linked tables, so speaker and people edits can be undone, and it refuses writes with no known actor.
  - **Dates** are always read back as plain `YYYY-MM-DD`.
  - **Integrity checks:** "placed in an event" requires an event; one primary source per item; one identity account per person.
  - **Joint lives:** handled through an event–people link.
  - **Lists that will grow** (source roles, how an item was added, removal reasons) are small lookup tables, so new values need no migration.

The full schema and conventions are in the implementation plan (Task 9) and ADR 0006.

### Time zones (owner's decision)

- **Exact moments** (posted, created, edited, a live's start time) are stored as `timestamptz`.
- **Calendar days** (the day an event happened) are stored as plain dates, **in the site's time zone** (`site.json` `timezone`, e.g. `Asia/Bangkok` for emibonnie). Every event's date and time refers to that zone, including events held abroad. There is no per-event time zone.
- **Every "which day" calculation uses the site's time zone,** never UTC or the viewer's: the posted-date fallback, the ±1-day live window, month grouping, and parsing `12/2` or `[260212]`.
- **Display:**
  - **Dates** show as stored, so "12 Feb 2026" reads the same for everyone.
  - **Exact times** show the viewer's own time first (detected from their device and labelled by city), then the site's: "4:00 pm paris · 10:00 pm bangkok". If both zones are the same, it's shown once.

### Translation (the first item kind)

**Entries have no title** (owner's decision). A tweet stands for itself. Wherever entries are listed (event pages, search, person pages), each one shows the opening lines of its translation text, with speaker emoji, as its preview.

One translator's translation of one clip, or one moment. It has these fields, which mirror the translator's Notion columns:

| Field | Source | Notes |
|---|---|---|
| Date | tweet's posted date, editable | date the moment happened if known, otherwise post date |
| Artist(s) | derived from mapped speakers, editable | the known people in the entry |
| Kind | submitter, suggested | **part of an event** or **shared story** (see below) |
| Type | submitter picks from a list the owner manages | e.g. show / interview, fan meet / fan day, live, **shared story** |
| Client / Media | submitter, optional, list the owner manages | e.g. EFM Station |
| Keyword | parsed from tweet (the all-caps title line), editable | e.g. "EMIBONNIE AT EFM", "ANY LOVE EMIBONNIE SESSION D1" |
| Hashtag(s) | parsed from tweet, minus ignored hashtags | e.g. #EmiBonniexFANDOMLIVE |
| Translation link | the pasted tweet URL | plus the tweet's numeric ID |
| Translator | tweet author | numeric X user ID, plus handle and display name at time of archiving |
| Original media | from the tweet's media data, editable | the source tweet of the clip when it was posted by someone else (e.g. a fan clipper); credited as "clip by @…" |
| Translation text | full tweet text, plus any follow-up text (see below) | stored verbatim |
| Speaker map | submitter | emoji (or other marker) → person or role, for this entry |
| Follows on from | detected from quote tweets, editable | link to another archived translation |
| Full video + start time | optional, manual | placeholder for the later subtitle work; not shown prominently |
| Added by | the signed-in submitter | |
| Tweet status | checked periodically | live / deleted / unavailable |
| Order within event | defaults to date, then post time; the owner can drag to reorder | |

### Event

A group of translations from the same occasion (a fan meeting, a show appearance, a livestream). Translations from different translators about the same occasion land on the same event page automatically. An event is matched in one of two ways:

1. **Keyword and/or event hashtag.** Used for organised events, e.g. "EMIBONNIE ANY HAPPY FAMILY" / #GMMTVFANIVAL2026HappyFamilyxEB.
2. **Who + where + when.** Used for lives and other occasions with no event hashtag, e.g. `#beonnnie TikTok live [260212]` (`vacantvolcanic/status/2021992269596045801`):
   - **who** comes from a person hashtag (see Person). #beonnnie → bonnie.
   - **where** comes from a platform phrase: "TikTok live", "IG live", and similar.
   - **when** comes from a date in the text, e.g. `[260212]` (YYMMDD) or `12/2`. If there's none, the tweet's post date is used.
   - The event is named like "bonnie tiktok live · 12 Feb 2026".
   - A second translation matches it if it has the same person, same platform, and a date **within one day either side**. That covers lives that run past midnight and translations posted the next day. (Approved as fine by the owner.)

Rules:
- An event has a display name (defaults to the keyword, or who + where for lives), a date, keyword(s), hashtag(s), a type, and an optional client/media.
- **Ignored hashtags:** the owner keeps a list of general hashtags (e.g. #EmiBonnie, #NamtanFilm) that are never used for grouping.
- **Choosing a different event:** in the add flow, tapping the event opens a picker. It has a search box, then suggested events from nearby dates with the current match ticked, then a **"＋ this is a separate event"** button. That button creates a new event even when one matched (e.g. bonnie went live twice on one day). Same-named events are told apart by start time if the tweet gives one, otherwise by a number: "bonnie tiktok live · 12 Feb 2026 (2)".
- **Creating an event:** when a translation starts a new event, the submitter sets its details (name, date, type, client/media, keywords/hashtags) right there in the add flow. **Once saved, only the owner can edit the event** (owner's decision). Anyone else who spots a mistake uses **Report** on the event page, which lands in the owner's reports list.
- **Unsorted:** a translation that's neither matched to an event nor marked a shared story goes to an Unsorted list for the owner to file. The owner can also move any translation to a different event.
- New events are flagged in the owner's admin so they can be looked over.

### Shared story

A translation that **isn't tied to an event**: someone else talking about emi and/or bonnie. For example, michirujjang on the Starlympics (`vacantvolcanic/status/2003413749940834557`). The translator calls these "shared stories".

- The add flow asks "part of an event, a post, or a shared story?". Shared story is never guessed from a tag's shape: the submitter picks it (see **Hashtags** below).
- A shared story records **who's sharing** (a person; an IG-like hashtag such as #michirujjang is suggested as a new person) and **who it's about** (people).
- "Shared story" shows up as an option in the type filter. Underneath, it's the item's **placement** (`shared_story`), not a stored type, so there's one source of truth (expert review). It is **not a home tab** (owner's decision: a tab would make it too prominent). Shared stories appear in search results, on the shared-story type filter, and on the pages of everyone involved. They never appear on the events timeline.

### Posts (owner's decision, 2026-10-21)

A translation of something **the people themselves posted**: emi's own tweet, bonnie's IG story, a handwritten note they shared. It's a fourth placement, alongside event, shared story and unsorted.
- **The add flow suggests "post"** when there's no event keyword, event hashtag or live pattern, and **either**:
  - the translated content comes from a known person's own account (the quoted tweet, or the clip/picture source, belongs to an account linked to that person), **or**
  - the header's only tags are **known people's own handle tags**, e.g. `#emiamily #beonnnie` for their IG story exchange (`vacantvolcanic/status/2112869493643034998`). The tagged people become the authors.

  The submitter can change it. When a post quotes the same translator's earlier translation, it's linked as "follows on from" it.
- **The person is recorded as the post's author** (`item_people` role `author`). Posts show on that person's page and as a **"posts"** option in the type filter. They never appear on the events timeline.
- **A known person's other accounts** (e.g. their X handle) can be listed in settings, so posts can be recognised. Matching by handle is only used for this suggestion and never grants anyone powers.

### Person

A known personality: emi, bonnie, leo (a host), and others as they appear.

- **Identity is the Instagram handle** (owner's decision). It's the unique key for a person. Emoji are not unique, since there won't be enough of them as the cast grows, and display names can collide.
- Each person has an IG handle (unique), a **display name**, a **standard emoji**, a **colour**, and their own page listing translations they appear in. Emoji and colour may repeat across people. The display name and IG handle are always shown next to them, so people stay distinguishable.
- emi (@emiamily): 🧡, orange. bonnie (@beonnnie): 💜, purple. These two are fixed.
- **Display names are lowercase** (owner's preference): "emi", "bonnie", "leo", across the whole site, in bubbles, tags, the cast list, and person pages. New people's display names are saved in lowercase. Text written by translators (translation text, keywords, hashtags) is never changed.
- "Add a new person" asks for the IG handle first. If it already exists, the submitter is pointed to that person instead, which prevents duplicates. Then it asks for display name, emoji, and colour, with suggestions.
- **(my call)** Someone with no Instagram account can't be added as a known person by submitters. They're mapped to a generic role, and the owner can create them by hand with a placeholder key.
- **(my call)** IG handles can change. The owner can edit a person's handle. Existing translations stay linked, because links are by internal person ID, not by handle.
- The owner can edit people and merge duplicates.
- **Hashtags: known tags decide, new tags get asked** (owner's decision, 2026-10-22). Hashtags can be anything, so the engine never guesses what a tag *is* from its shape. Each header tag is one of:
  - **ignored:** on the ignore list, so it's dropped.
  - **a known person:** matches a person's IG handle or extra hashtags.
  - **a known event tag:** attached to an existing event, so it matches that event.
  - **new:** anything else. A new tag steers nothing on its own: no event is proposed from it, and no person or shared story is guessed.
- **The add flow (Plan 2) asks about each new tag,** shown as chips: *an event* (new, or attach it to an existing one), *a person* (new, by IG handle), *just a tag*, or *ignore*. Answers are remembered only through things the archive already keeps:
  - the tag joins that event's tags
  - it becomes the person's extra hashtag
  - it goes on the ignore list
  - "just a tag" stores nothing, and is asked again next time

  So there's no extra storage: each answer adds at most one row to an existing table.
- **Bulk import (Plan 3):** tweets with new tags go to "check these".
- **The all-caps keyword line** and **live patterns** still propose events, because they're translator conventions rather than guesses.
- **Person hashtags are their IG handles** (owner's information): #beonnnie means @beonnnie, which is bonnie. The site recognises a person from a hashtag that matches their stored IG handle. The owner can add extra hashtags to a person if a fandom tag differs from the handle. Person hashtags identify **who** (for lives, shared stories and tagging). They never create or match an event by themselves.

**Generic roles** cover people who don't need telling apart: host, fan, speaker. They have a neutral style and no person page. A translator's own emoji is kept for a generic role (e.g. 🌧️ shown as "speaker"), since generic roles have no standard emoji. 🗣️ is pre-mapped to **crowd reaction**, and 💬 (chat/comments) is suggested as **fan**.

### Speaker mapping

**Principle (owner, 2026-10-23):** translations are handwritten and formats vary without end. The goal is to **cater for as many possibilities as possible, not to identify every pattern**. The parser recognises only basic, common patterns as a head start. Any other format must still be possible to archive, because **the person adding the tweet is the source of truth**: they can map, correct or override whatever the parser missed or got wrong in the add flow. Nothing in intake may depend on the parser being right. Flexibility comes from the adder's tools, not from more parser rules.

Translators each use their own speaker markers: 🐰/🦊/🦁/🌧️ for one, 💜/🧡 for others, and sometimes a line has no marker at all. When an entry is submitted:

1. The site finds speaker markers: an emoji or short label at the start of a line, followed by a colon. **A bare colon with no marker before it** (e.g. `: Bonnie, mommy has sth to tell you`) is its own marker, shown in the add flow as "(no emoji)" and mapped like any other (owner decision, 2026-10-23: @danaNYB uses it for a generic fan). A bare `:` followed by no words, such as `:)`, stays text.
2. For each marker, it pre-fills a guess. 💜 → bonnie and 🧡 → emi by default. After that, it uses that translator's previous mappings (e.g. for @vacantvolcanic: 🐰 → bonnie, 🦊 → emi, 🦁 → leo).
3. The submitter confirms each marker using a dropdown: known people, "add a new person", or a generic role (Host / Fan / Speaker).
4. The confirmed mapping is saved on the entry and also remembered for that translator.
5. 🗣️ (crowd) is pre-mapped to a crowd-reaction style.

### Speaker display

The **chosen style is chat bubbles, everyone on the left in one column**, with a cast list at the top (mockup approved during brainstorming):

- Each line that starts with a speaker marker becomes a bubble. The bubble shows the person's **standard emoji** (not the translator's), their name, and a tint in their colour.
- When the same speaker has several lines in a row, the emoji and name show only on the first bubble.
- **Several generic speakers of the same role** (e.g. 👦🏻 and 👩🏻 both mapped to host) each keep the translator's own emoji, so they read "👦🏻 host" and "👩🏻 host". No numbering is added.
- **Joint lines (owner's decision, 2026-10-22):** a line whose marker is two or more markers run together (e.g. `👩🏻👦🏻: 😆`, both hosts reacting at once) renders as **one shared bubble** showing each speaker's emoji and their names joined with " & " (e.g. "host & host", "emi & bonnie"), in a neutral style. Each component marker is mapped on its own like any other marker, so a joint line needs no extra question and no extra storage. A combined marker whose parts aren't all recognised markers stays a plain line.
- Crowd reactions (🗣️) render as small inline notes between bubbles.
- Lines without a marker (headers, context like "[After 'Number One Girl'…]", and footnotes marked * / **) render as plain text in place. Footnotes go at the end.
- A "show original" toggle shows the verbatim tweet text.

## Intake: adding a translation

1. The submitter signs in and pastes a tweet link.
2. The server fetches the tweet from two free, unofficial sources:
   - **X syndication** (`cdn.syndication.twimg.com/tweet-result`, the endpoint used by Vercel's react-tweet). It confirms the tweet exists, detects deleted tweets (`TweetTombstone`), and returns the author ID, handle, created date, media details (including video variants and the original clip's URL via `expanded_url`), the quoted tweet, and the parent tweet for replies. **It cuts off long posts** (when `note_tweet` is present).
   - **FxTwitter** (`api.fxtwitter.com/2/status/{id}`). It returns the **full text of long posts**. Tested at 2,502 characters.
   - Rule: the text comes from FxTwitter whenever the post is long or the two sources disagree. Everything else comes from syndication. If both fail, the submitter can paste the text by hand. A manually entered entry is marked as such and **held for owner approval** unless the translator entered it themselves. Credit only ever goes to an author ID returned by a source, never to a handle typed by a submitter (security review).
3. **Duplicates:** if the tweet ID is already archived, the submitter is sent to the existing entry.
3b. **Edited tweets (X Premium's 1-hour edit window; owner's decision, 2026-10-21).** Syndication's `edit_control` gives `editable_until_msecs` and `edit_tweet_ids` (every version; each edit has a new ID), plus `isStaleEdit` on old versions.
   - **Pasting an old version's link** archives the newest version. Every version's ID is remembered, so pasting any version later counts as a duplicate.
   - **The window is stored.** After it closes, the tweet (and any follow-up still in its window) is re-fetched **once**. If it was edited, that part's text is updated to the final version, and the audit log keeps the earlier wording. This is the one exception to "parts are never rewritten".
   - **When:** not exactly on the hour, and **no daily job** (owner's decision). Two triggers:
     - **Automatically,** in the background, the next time anyone opens that translation after the window closes.
     - **A "check for update" button** on the translation page, shown to **anyone** while any of its tweets is still inside its edit window (and until the final check has run). It re-fetches the tweet and updates the text if it changed. It's throttled **in the browser** (owner's decision: no rate-limit table): after each press the button locks for 1 min, then 5 min, then 15 min, per translation. The server also skips a re-fetch when that translation was already checked in the last 60 seconds (one timestamp on the source row) and returns the current text, so X can't be hammered through the site.
   - The translation is visible throughout.
4. **Quotes:** if the tweet quotes another tweet by the same translator, the site offers to archive that one too and link it as "follows on from". If it quotes someone else's tweet that holds the clip, that becomes Original media.
5. **Threads** (follow-up replies by the same translator, for extra context or overflow text): **FxTwitter's thread lookup (`/2/thread/{id}`) returns the translator's own follow-up replies** (verified 2026-10-21 on `SugarHoneyz13/status/2112858824172531819`, which has 1 follow-up). The site pulls them in when the translation is added. Each tweet's text is stored as **its own part** (part 1 = the main tweet, then follow-ups in order), verbatim, so adding a part never rewrites earlier ones. Search covers every part.
   - **Follow-ups posted later (owner's decision, 2026-10-21):** there's no automatic checking.
     - A **"check for follow-ups"** button on the translation page (Plan 2, for the translator, the submitter and the owner) re-runs the thread lookup and adds any new same-author follow-ups as new parts. The audit log records it.
     - **Pasting a follow-up link by itself:** if it's a reply in the thread of an already-archived translation by the same translator, the site **attaches it to that translation** as a new part, instead of creating a separate entry, and tells the submitter.
   - If the lookup fails, the submitter can paste follow-up links by hand.
6. The site pre-fills Keyword, Hashtags, Event match, Artist(s), and the speaker map. The submitter confirms speakers and any details that weren't found, then saves.
7. The entry is **live immediately**. It records who added it.

Tested examples (2026-10-21):
- `vacantvolcanic/status/2030321729902641632`: a long post with a 2½-min clip.
- `vacantvolcanic/status/2110438810274414709`: a long post that quotes the same translator's earlier clip.
- `danaNYB/status/2108748780564816034` and `SugarHoneyz13/status/2108532547101856124`: two translators covering the same event with the same keyword and hashtag. Both clips were posted by other accounts.
- `vacantvolcanic/status/2021992269596045801`: a TikTok live with no event hashtag (who + where + when).
- `vacantvolcanic/status/2003413749940834557`: a shared story. The clip is from @nxris_s.

**"Clip by"** is always shown, even when the clip's source is the translator (owner's decision). It names the account X reports the video came from. X only gives one level, so if that account had itself reposted the video, we can't see further back. The submitter can correct it.

**The add flow, in three steps** (mockups `add-flow-v1.html`, `add-flow-live.html`, `add-flow-separate.html`, `shared-stories-v2.html`):
1. **Paste a link.** Shows "adding as @handle". Explains what happens for duplicates and opted-out translators.
2. **Check the details.** Tweet preview with clip thumbnail. "Part of an event / shared story" choice. Event box: the match ("✓ matches N"), or a new event with its details editable inline, or the event picker. Hashtags, type, client/media (optional), clip by, "follows on from" (quoted post, with an offer to add it too), "＋ add follow-up tweet" for threads. For shared stories: who's sharing and who it's about.
3. **Who's speaking?** Each marker with a dropdown. Remembered and default answers are pre-filled and labelled "remembered". The dropdown has known people (with IG handles) and a search box, then "＋ add a new person" (asks for IG handle), then the generic roles. Save stays disabled until every marker is mapped ("N left to map").

## Bulk import (launch content)

The archive launches with existing content, not empty. The owner will not paste links one at a time.

Bulk import is a separate admin feature, **for the owner only**. Regular submitters add one tweet at a time. Both use the same intake pipeline (fetching, event matching, remembered speaker mappings, duplicate and opt-out checks), so entries look the same whichever way they came in. Import adds batching, a background queue, and per-translator speaker mapping on top. There are two sources:

1. **The translator's Notion database** (the owner has the translator's permission to import it). Its columns are Name, Date, Artist(s), Type, Client / Media, Keyword, Hashtag, Translation link, and Original media. **The Name column is ignored** (owner's decision). It's that translator's own titling, and entries don't have titles.
   - **(my call)** The owner exports the database from Notion as CSV and uploads it on an admin import page. This needs no Notion integration or token.
   - Each row's Translation link is fetched like a normal submission.
   - The Notion values for Date, Artist(s), Type, Client/Media, Keyword, Hashtag, and Original media take priority over anything parsed from the tweet, since the translator curated them.
2. **The owner's own collection of links**, held in a personal chat.
   - **(my call)** An admin "bulk paste" box accepts any block of text, such as a chat export or a copied conversation. It pulls out every `x.com` / `twitter.com` status link, skips ones already archived, and queues the rest.
   - Not every link in the collection is a translation (some are event links). Imported tweets without translation-like text, such as no speaker markers and little text, go to a "check these" list instead of going live.

Both imports:
- Run as a background queue, throttled (my call: a few tweets per second) so the free tweet sources don't block the server. The queue lives in the database. A **GitHub Actions job** works through it, because Vercel functions are capped at 5 minutes per run and a large import takes longer. The admin page starts the job and shows progress and failures, with retry.
- **Speakers are mapped before entries go live** (owner's decision). Fetching is quick (about 1–2 s per tweet, so roughly 10–15 min for 500), and mapping is grouped so it stays manageable:
  - After fetching, the import shows **one mapping screen per translator**. It lists every speaker marker that translator used, how often each appears, and an example line, with the default and remembered guesses filled in. One answer covers all of that translator's entries.
  - Entries whose markers are all mapped this way go live together.
  - Entries with anything still unclear (a marker that means different people in different entries, or no markers at all) stay in a **"needs speakers"** list for the person who ran the import. They aren't public until they're resolved.
- Credit the import to the owner as "Added by". The Notion import is also marked as coming from that translator's archive.
- Tweets that are already deleted: if Notion supplies no text, they're listed for the owner. They can't be recovered automatically.

## Sign-in and roles

- **Sign in with X** for everyone (OAuth 2.0 with PKCE, scopes `users.read tweet.read` **only**). Better Auth's X provider asks for `offline.access users.email` by default, so the defaults must be overridden and a test must check the requested scopes. After sign-in, one call to `GET /2/users/me` gets the user's numeric ID and handle. No email or profile image is stored for X users.
  - Tested 2026-10-21 on an X developer app with **zero credit**: sign-in and `/2/users/me` both succeeded. The rate limit is 75 per 15 minutes per user. X's pricing page lists user lookups at $0.010, so this may start being charged or refused in future. Pre-paid credit means the worst case is failure, not a bill.
  - **Store the numeric X user ID**, not the handle, because handles change.
- **Sign in with Google** is a backup, so the site stays usable if X sign-in breaks.
- **Translator recognition is automatic:** if a signed-in user's X ID matches a translator ID on archived entries, they're that translator. No claim step. (Google-only users can't act as a translator.) Recognition and the owner check use only the numeric X ID from the sign-in record, never a handle. Accounts known only by handle (clip sources, Notion rows) never give anyone powers. Google display names are cleaned up (no leading `@`, no invisible characters) and shown differently from X handles, so nobody can pass as a translator.
- **Translator powers:** remove any of their own entries; opt out entirely.
  - **Remove** (owner's decision): the entry disappears from the site, including search, event pages, and public outputs, and that tweet can't be submitted again. The data is kept privately (soft delete), not deleted. Backups age out within 35 days (see Backups).
  - **Opt out:** applies to the whole account. Every entry by that translator disappears from the site the same way, and nothing they posted can be added again by anyone, through submission, bulk paste, or Notion import. Submitters get a clear message. Imports skip those tweets and list them as skipped.
  - **Undo (my call):** a translator can restore entries they removed, or opt back in, since the data was never deleted.
  - The owner's **hide** works the same way, but only the owner can undo it.
- **Owner:** a single admin, set by X user ID in config.
- **Editing (my call):** a submitter can edit their own entries (this can move an entry to a different event, but never changes an event's own details; only the owner can do that). A translator can edit the details of their own translations (speaker map, type, event, order) but not the translation text, which stays verbatim. The owner can edit everything. Every edit is logged (who, when, before/after), so a wrong change can be undone.
- **"Added by" (my call):** shows the submitter's X handle. Google-only users choose a public display name when they first submit. Names and emails from Google are never shown publicly, and emails are never exported.
- **Blocking:** the owner can block a user. Their submissions are hidden and they can't submit again.
- **Approval switch:** a site setting "new submissions need approval". It's **off** at launch (entries go live immediately). When it's on, new entries wait in the owner's review list.
- If X sign-in fails at the step where the site asks X who the user is, the site shows a clear message, and the owner sees an alert in the admin page.
- **Delete my account** (security review): anyone can delete their own account from "me". It removes their sign-in records and shows their past "added by" as "a fan". The owner has a script for full erasure on request, covering items, the audit log, and (by expiry) backups.

## Visual design

Approved with the owner on 2026-10-21 using mockups. The mockups are kept in `docs/superpowers/specs/mockups/` (static HTML; open in a browser). They are the reference for the look. Where a later mockup changes an earlier one, the later one wins, and the text below is the source of truth. Known superseded bits: the left phone in `shared-stories-v2.html` shows home tabs, which were dropped; shared story is a type filter instead.

- **Style:** "soft pastel on paper".
  - Background: warm paper `#f6efe3`. Cards: `#fffdf8`, rounded (about 16px), with a soft bottom shadow line `#eadfce`. Ink: `#2b2233`. Muted text: `#8a7f8f`.
  - Fonts: Nunito for Latin text, IBM Plex Sans Thai for Thai.
  - Month headings and section labels are small, bold, lowercase, and purple.
  - A dark theme is expected too, derived from the same tokens (builder's choice of exact values).
- **Brand:**
  - The emibonnie logo (`mockups/logo.png`, supplied by the owner) sits next to the wordmark **"emibonnie archive"**. "emibonnie" uses a gradient of the logo's colours: orange `#ff6a2b` → pink `#e03a85`.
  - The tagline "fan translations, kept" carries a small **FAN-MADE** badge, so the site is never mistaken for an official one.
  - Primary buttons use the same orange→pink gradient.
- **People colours:** emi orange `#ff8a3d`, bonnie **purple** `#9b6cff`. Bonnie stays purple even though the logo uses pink (owner's decision). Speaker bubbles use a light tint of the person's colour, and their name in a darker shade.
- **Bottom tab bar (phone):** home · search · ＋ add · me. On web these sit in a top bar, with "sign in with X".

## Pages

- **Home: events timeline** (`screens-v2.html`, header as in `search-v2.html`).
  - Logo, wordmark and FAN-MADE badge at the top. Then a search box with a **filter icon** (three stacked lines, not the word "filters").
  - Below that, events newest first, grouped by month. Each card shows the event name, date, hashtag, and a translation count.
  - **No tabs.** Home lists events only.
- **Search** (`search-v2.html`).
  - Opening search (from the tab bar or the home box) focuses the box with the keyboard up. Before typing, it shows recent searches and quick chips for people and types.
  - **Filter icon:** shows a small count badge when filters are on, and opens a sheet with:
    - **who's in it:** people chips, with an "any of / all of" switch.
    - **type** chips, including shared story.
    - **event, translator, client/media, date** dropdowns.
    - An apply button showing the live result count ("show 3 translations").
  - Active filters show as removable chips under the box, plus "clear all".
  - Results show the event and date, then the matching lines with the match highlighted, then people and translator.
  - Filters work with an empty search box, for browsing.
  - **Scoped search:** searching from a person, translator or event page opens the same screen with that filter already applied as a removable chip. Searching from the tab bar or home starts unfiltered.
- **Event page** (`screens-v2.html`).
  - Name, date, and translation and translator counts. Tag pills for hashtag and type. Filter chips for people and translator.
  - Entries show their opening lines, with standard speaker emoji, as a preview (no titles), plus people emoji, translator, a clip marker, and "follows on" where relevant.
  - Entries are in event order, with a toggle for newest first. There's a Report link for the event.
- **Translation page** (`screens-v2.html`).
  - **Phone:** the clip is pinned at the top, and below it scroll the credits ("tl @translator · clip by @source · date"), the cast list, and the bubbles.
  - **Web:** the clip stays in view on the left, with "‹ previous in event / next in event ›" under it, while the right column scrolls through the credits, tag pills, cast list and bubbles.
  - At the bottom: original tweet link, original media link, follows-on links, added by, Copy link, and Report.
  - **What sits in the pinned area depends on the source** (owner's decision, 2026-10-21). The engine detects which it is from the tweet, so nobody has to choose:
    - **A clip:** the video player.
    - **Pictures** (photo posts, IG story screenshots, handwritten notes): the image(s) from `pbs.twimg.com`, never copied, in the same capped area. Swipeable when there are several; tap to zoom full screen.
    - **A text post** (e.g. emi's own tweet in Thai): a quote card with the author's name, handle and the original text, in the same pinned spot, with the translation below. **If the quoted post has pictures or a clip, they show inside the quote card,** in the same capped area (e.g. `SugarHoneyz13/status/2112858824172531819` quotes @emiamily's photo tweet).
  - **Vertical clips (owner's decision, option A):** the pinned video area on a phone never takes more than about **40% of the screen height**. A clip of any shape is fitted inside it (letterboxed: a vertical 9:16 clip shows narrower and centred, with dark sides), and a **⤢ full screen** button opens it full screen. The clip's shape comes from the source's width and height, so the box is sized before it loads. On web, the clip fits its own column's height. (Mockup: `vertical-video.html`, option A.)
  - **If the tweet is deleted:** the video area is replaced by "Original tweet is no longer available. Translation kept below."
- **Person page** (`people-me-v1.html`).
  - A header in the person's colour, with emoji, lowercase name, IG handle, and counts (translations, events, shared stories).
  - Translations grouped by event, with shared stories included. Views: by event / all, newest / "with…" (narrows to moments that also include another person).
- **Translator page** (`people-me-v1.html`).
  - X handle (as last seen), a link to the profile, and totals. Translations by event.
  - If the translator has opted out, the page only says "this translator has opted out".
- **Add page:** see "Intake" above.
- **Sign in** (`translator-signin-v2.html`).
  - Tapping "me" or "＋ add" while signed out shows the logo, wordmark and FAN-MADE badge, a black **"sign in with X"** button first, and **"sign in with Google"** below it.
  - A short note says what's kept: X account number and handle (or a chosen display name for Google). Email is never shown and passwords are never seen. The site can't post or read DMs.
  - X's own approval screen asks for read access only (`users.read tweet.read`).
  - **First sign-in as a translator:** a one-time welcome ("hi @handle", "✓ recognised as a translator", totals for translations, events and shared stories). Options: see my translations, remove a translation, add a translation, and **opt out** as a **solid red bar**. Afterwards, "me" opens straight to their translations.
- **Me page** (`people-me-v1.html`).
  - Everyone: "added by me".
  - Translators also get a ✓ translator badge and "my translations". They can multi-select and "remove from archive". Removed entries stay listed, faded, with "restore".
  - A **solid red "opt out"** box explains the effect in "removes" wording ("Removes all N of your translations and stops anyone adding your tweets in future. You can opt back in any time."). Its button is full width and reads **"yes, i would like to opt out"**. The label is just "opt out", in red everywhere it appears. User-facing copy says "remove", never "hide", for translators.
- **Admin** (web, owner only; `admin-import-v1.html`).
  - **Sidebar:** import, needs speakers, check these, unsorted, reports, events, people, ignored hashtags, users & blocks, settings (approval switch, X sign-in health alert, Type and Client/Media lists).
  - **Import is three stages:**
    1. **Sources.** Notion CSV drop, showing how each column was matched, with Name shown as ignored. A paste box that highlights the tweet links it finds, with counts for already in Notion, already archived, and opted out. A tweet total and a time estimate.
    2. **Fetch.** A progress bar and time remaining. Counts for fetched, deleted (kept from Notion text / lost), "don't look like translations" (goes to check these), and failed (with retry). Safe to close the page.
    3. **Map speakers.** Translators are listed with how many markers are left to map. For the selected translator, a table shows each marker, how many entries use it, an example line, and a "who is it?" dropdown. A rare or inconsistent marker gets a "may be different people" warning with per-entry review. Buttons: "publish ready ones" / "publish all".

## Video player

- It plays the clip from X's own servers (the `video.twimg.com` MP4 URLs from the syndication media variants), in the site's own player, so it can be pinned. It picks a small variant on phones. Video files are never stored or re-hosted.
- **Video links are stored at intake** and refreshed by the health check. The page only asks X again when playback fails (cost review: fewer calls, less risk of being blocked). Only `video.twimg.com` URLs are ever served. The player sends no referrer.
- The clip plays only while its tweet is live. The official X embed stays available as a switchable fallback.
- **Early check for the builder:** confirm that X's video URLs play when embedded on another site (no hotlink blocking or expiring signatures). **Fallback** if they don't: show X's standard tweet embed in the video area, unpinned on phone.

## Tweet health check

A scheduled job re-checks archived tweets through syndication and updates their status. Deleted or unavailable tweets switch the translation page to the "no longer available" state. Archived text is never touched.
- **Rotating, so it scales** (cost review): tweets added in the last 30 days are checked daily, and 1/30 of the rest each day. At 10k+ items, a full daily check would use most of the free Actions minutes.
- It runs as a **daily Vercel Cron batch** (≤ 300 s, no Actions minutes), with Actions as the fallback.
- **It writes nothing when nothing changed.** Check timestamps live outside audited tables, so the audit log doesn't fill the database.

## Deleted tweets (owner's decision, option 3: keep, and tell the translator)

- When a translator's tweet is deleted, the translation **stays archived and visible** (the archive's purpose). The health check also **flags it for the owner** in an admin "deleted at source" list, with the translator's handle.
- The owner contacts the translator and asks whether to keep it. If they say no, the owner removes it (or the translator does it themselves from "me").
- Background (security review): X's developer policy asks for content deleted on X to be removed within 24 hours. It's written for content obtained through the X API. The archive gets tweet text from the free unofficial sources, and uses the API only for sign-in. The owner accepts the remaining risk. Translators keep full control through remove and opt-out.

## Search

- Trigram (`pg_trgm`) matching on the translation text, so that both English and Thai (which has no spaces between words) and partial words match. There's no separate full-text copy, to save space. Builders must confirm that Thai text produces trigrams on both Neon and PGlite.
- Queries are 2–100 characters, with a capped page offset (protects the database from abuse). Results have an explicit order.
- Search covers: translation text, Keyword, hashtags, event names, people names, and translator handles.

## Trust, safety and privacy (security review, 2026-10-21)

**Pages and wording:**
- **`/about`:** what the site is, credits policy, and "unofficial, not affiliated with the artists or their agency". The FAN-MADE badge stays.
- **`/takedown`:** who can ask, what to send, and that the response is "hide first, review second".
- **`/privacy`:** who runs it (the fan contact), what's collected and why, third parties (Vercel, Neon, GitHub, X video), retention, public vs private, translator remove/opt-out, account deletion and erasure, contact. No sale and no ads.
- A footer on every page links all three.
- The logo's origin is credited, and it's never used in a way that suggests an official site.

**Translators:** before launch, the owner contacts each translator with what's archived and how to opt out. The Notion permission is kept in writing, privately.

**Personal data, kept minimal:**
- No email or profile image for X users.
- Sign-in sessions last 7 days.
- No request headers in error logs, and Better Auth telemetry stays off.
- The audit log and reports are pruned after 12–24 months.
- Public: entries, handles, "added by" names. Everything else is private.

**Security basics:**
- Narrow X scopes.
- Database-backed rate limits on sign-in and on every write endpoint.
- Writes are POST-only, with an Origin check.
- Search bounds (see Search).
- Every link put on a page is checked (https, allowed hosts).
- Tweet fetching accepts only numeric IDs and refuses redirects.

**Headers:**
- A strict Content Security Policy (self, video.twimg.com for media, pbs.twimg.com for images), `frame-ancestors 'none'`, **`Referrer-Policy: no-referrer` site-wide** (Task 2 found `video.twimg.com` refuses requests that carry another site's Referer, and `<video>` has no per-element referrer attribute), nosniff, HSTS.
- Fonts are self-hosted, so visitors' IP addresses aren't sent to Google.

**Accounts and operations:**
- 2FA (authenticator app or passkey) on every fan account: X, Google, GitHub, Vercel, Neon, registrar.
- The owner can sign out all their sessions.
- The app's database role can't edit or delete audit rows.
- GitHub Actions are pinned to exact versions with read-only default permissions.
- Preview deploys use a separate Neon branch, never production.
- A short incident runbook (leaked secret, takedown) lives in the site's deploy docs.

**Identity separation checklist:**
- Sign up for Vercel and Neon with the fan email, not "Continue with GitHub".
- Use a neutral Vercel project slug.
- The Google consent screen's support and developer emails are the fan Gmail.
- Check the X app's authorize screen shows only fan-side names and links.
- The domain is registered with the fan email, with registrant data redacted.
- One fan contact address is used on every public page.

## Technical setup

These choices are mine. They follow the owner's other fan projects (plain JS, Vercel, `node --test`, GitHub Actions), and the owner asked to see the reasons.

| Piece | Choice | Why | Passed over |
|---|---|---|---|
| Front end | Plain HTML/CSS/JS, no framework | Matches the owner's other projects. Fast on phones. | React/Astro: more than a browse-and-search site needs |
| Hosting + server | Vercel (free), serverless functions | The owner already uses it. Covers sign-in, intake, and admin. | Cloudflare: also good, but a new platform for the owner |
| Database | Neon Postgres (free plan, **signed up with Neon directly**, not via the Vercel Marketplace, which moves billing to Vercel) | Full-text + trigram search for Thai (`pg_trgm` 1.6 supported). Free: 1 GB per project, 100 compute-hours a month, no card. Sleeps after 5 min idle, so expect a slower first query after a quiet spell. No documented deletion of inactive free projects. | Supabase: pauses free projects after a week without activity. GitHub-as-DB: submitters would need GitHub accounts |
| Auth | Better Auth (MIT, self-hosted in the app) | One library for X + Google, stored in our own DB, no per-user fees | Hand-rolled OAuth |
| Tweet data | X syndication + FxTwitter, server-side, cached | Free. Long-post text. Detects deletions. | Paid X API ($0.005 per post read) |
| Scheduled and long jobs | GitHub Actions (private repo, free org: 2,000 min a month; it stops at the limit, with no charge, when no card is on file) | Tweet health check (rotating: new items daily, older ones in rotation), weekly backup dump, bulk import runs. Kept well under the limit by rotation; the earlier 300 to 450 min estimate only held for small archives | Vercel Cron: once a day at most, and functions are capped at 5 min |
| Backup | **Weekly compressed `pg_dump` uploaded as a GitHub Actions artifact with 35-day retention** (owner's decision, 2026-10-21) | No growth (artifacts auto-expire, about 5 copies kept), no extra service, about 1 Actions minute a week, fits the free 500 MB artifact storage | A JSON export committed to a git repo: rejected, because it grows without limit and git isn't for data dumps. Neon's 6-hour restore alone: too short |

**Backups (owner's decision):**
- **Layers of protection:**
  - **Everyday mistakes:** soft delete plus the audit log.
  - **The last 6 hours:** Neon's point-in-time restore.
  - **Losing the database or the account:** a weekly dump.
- **The dump:**
  - A GitHub Actions workflow runs `pg_dump --format=custom` against the database, compresses it, and uploads it as a workflow artifact with `retention-days: 35`, from the site's **private** repo.
  - It excludes sessions and auth tokens.
  - Removed and opted-out content is gone from every backup within 35 days.
- **Restore:** `npm run restore <file>` restores into an empty database. The restore steps are documented and tested once a year.
- **If backup can't be on:** if a site's repo is public, artifacts are visible to anyone with read access, so backups stay off there and the docs say so.

**Deploying (my call):** Vercel Hobby can't connect to repos owned by a GitHub organisation, so pushes to `main` deploy through a GitHub Actions workflow using the Vercel CLI (`vercel deploy --prebuilt --prod`) and a Vercel token stored as a repo secret. Pull requests get preview deploys the same way. Checking that this works is one of the first build steps.

**Hosting settings (cost review, 2026-10-21):**
- **Caching:** every public read sends CDN cache headers (`s-maxage=300, stale-while-revalidate=86400, stale-if-error=86400`), so pages keep working while Neon sleeps or is suspended, and a viral day doesn't wake the database for every visitor.
- **Bundling:** front-end files are bundled into a few hashed files cached for a year (esbuild, at build time only), so a viral day doesn't exhaust Vercel's 1M monthly requests and trigger its 30-day pause.
- **Neon:** autoscaling is capped at 0.25 CU.
- **Region:** emibonnie runs in **Singapore**: Vercel `sin1` plus Neon AWS Singapore.
- **`robots.txt`** blocks `/api/` and `/search`.
- **One router function** handles every endpoint, staying within Hobby's function-count limits.
- **Handlers are written in the standard web style,** and routes come from one table, so moving to **Cloudflare (the documented plan B: a free tier that resets daily, $5/month paid)** stays cheap.

**Free-tier check (2026-10-21, official pricing pages):** Vercel Hobby is free and allows non-commercial use. Over-limit usage pauses the feature, with no bill. Neon Free, Better Auth (the framework; only their hosted dashboard is paid), Google sign-in (basic scopes; the app must be set to "In Production" to avoid the 100-user testing cap), and GitHub Actions are all $0. Sign in with X was tested working on a zero-credit app.

**Unofficial sources are fragile.** Both tweet sources are undocumented or third-party and can break when X changes things. Intake must fail gracefully: it falls back to the other source, then to manual text entry. The owner gets an alert when one source has been failing.

**Secrets** (X client ID and secret, Google OAuth, database URL, Better Auth secret) live only in Vercel environment variables and local untracked env files. They are never committed.

**Identity:** this is a fan project. The repos (template and emibonnie) live in the GitHub org `mintbluecar` and commits as the fan identity. The Vercel, Neon, Google Cloud, and X developer accounts must be the fan-side accounts. No public content (README, committed files) names the owner's personal account, real name, or local file paths.

## Reusable template (owner's decision: option 1, "copy the template")

Other fans start their own archive by copying a template repo, filling in `site/`, and deploying to their own free Vercel and Neon accounts. Each archive is fully independent: its own data, its own owner, its own moderation. One hosted site for many fandoms, and a published engine package, were both considered and rejected: the first is too much to run and moderate, the second too much upkeep.

**Engine vs. site boundary:**
- **The engine** is everything outside `site/`. It must not mention any fandom. A test enforces this: it fails if the engine contains the example site's or emibonnie's names, handles, or hashtags.
- **`site/`** is the only folder an archive owner edits:
  - `site.json`: archive name, wordmark split (the gradient part, e.g. "emibonnie" + "archive"), tagline, owner's X user ID, source language, **featured people** (IG handle, display name, standard emoji, colour), **default speaker markers** (e.g. 💜 → @beonnnie, 🧡 → @emiamily, 🗣️ → crowd, 💬 → fan), ignored hashtags, types, extra live platforms, and `lowercaseNames` (true for emibonnie).
  - `theme.css`: brand gradient, paper/card/ink colours, dark-mode values, font families. Fonts default to Nunito plus a Noto/IBM Plex font for the source language's script.
  - `logo.png`.
  - `copy.json`: every piece of user-facing wording (tagline, buttons, empty states, opt-out text), so a fandom can change the tone or translate the interface. The engine ships English defaults, and `copy.json` overrides them.
  - `seed/` (optional): tweets to load for local development.
- **Where the example lives** (architecture review): the template never commits a `site/` folder. Its example pair lives in `examples/solluna/`, and `npm run init-site` copies it into `site/` for a new archive. The engine reads `SITE_DIR` (default `site`). Setting docs live in `docs/site-settings.md`. This keeps `git pull upstream` conflict-free.
- **Defaults the engine provides:** the engine ships default theme tokens and default wording. A site's `theme.css` and `copy.json` only override them, so new engine tokens never break an older site.
- **Releases and upgrades:**
  - The engine is versioned with semver tags, and sites pull a tagged release.
  - Each release lists its upgrade steps in `CHANGELOG.md`.
  - **`npm run doctor`** checks a site's setup: Node version, settings, pending migrations, missing tokens or copy, env vars, engine version.
  - Deploys run database migrations automatically before going live on the GitHub Actions path and in the manual deploy script. On the Git-integration path (Vercel builds from GitHub), the owner runs `npm run migrate` before merging, because a Vercel build that migrates would hand a write-capable database URL to every preview build of PR code (controller ruling, 2026-10-23).
  - Engine migrations and a site's own migrations are numbered separately so they can't collide.
- **Licence:** **MIT** for the engine (owner's decision). A site's `site/` content isn't covered.
- **Two deploy paths** documented: Vercel's Git integration for fans whose repo is on a personal account (simplest), and the GitHub Actions + token path for org repos (emibonnie's case).
- **The "never add a card" rule:** never add a card to GitHub or X. Without one, limits stop usage instead of billing.
- **Also documented:** a "what happens at each limit" table, and a region choice step.
- **Setup:** `npm run setup` validates `site.json` (clear errors for missing or invalid fields), runs migrations, and seeds featured people, ignored hashtags and types from it. It's safe to rerun after editing `site.json`. Featured people are seeded from settings, not hardcoded in migrations.
- **Updates:** an archive owner adds the template as an `upstream` remote and runs `git pull upstream main`. Because they only change `site/`, this doesn't conflict. Engine changes that need a site change (a new required setting) must ship with a default or a clear setup error, plus a note in `CHANGELOG.md`.
- **Sample data:** the template's `site/` holds a fictional example pair, and its tests use **synthetic tweet fixtures**: real tweet structure, made-up handles and text, including a long post, a Thai line, a live header, a shared story, a clip from another account, and a deleted tweet. Real translators' tweets are never in the template. emibonnie's real example tweets live only in emibonnie's own `site/seed/`.
- **Docs:** `docs/start-your-own.md` is a step-by-step guide for a fan comfortable following instructions:
  1. use the template
  2. edit `site/`
  3. create the Neon, Vercel and X developer app, and Google sign-in
  4. add the secrets
  5. run `npm run setup`
  6. push to deploy
  7. pull updates

  `site/README.md` documents every setting.
- **Repos (my call, confirm):** the engine is developed in a template repo, `mintbluecar/fan-archive` (named broadly, since translations are only the first item kind). emibonnie is its own repo, `mintbluecar/emibonnie-archive`, created from the template with emibonnie's `site/` and real data, and it pulls engine updates from upstream. The template can go public when the owner chooses. It contains nothing personal or fandom-specific.
- **Languages:** the source language is a setting (Thai for emibonnie). Search already works for scripts without spaces (Thai, Chinese, Japanese) and for Korean, through trigram matching. Header parsing (all-caps keywords, `[YYMMDD]` and `d/m` dates, live platforms) is language-neutral. Extra platforms can be added in `site.json`.

## Later (designed around, not built)

- **Subtitles on full streams:** match a clip to its place in the full original stream (likely by audio fingerprinting rather than visual comparison) and show translations as timed subtitles. The examples show this needs real design work: translations are per clip, often overlap, and come from several translators. The "full video + start time" field exists so nothing blocks this.
- **Automated intake** from translators' timelines.
- **More moderators.**

## Left to the builder

- Database schema, API shape, and file layout.
- How the speaker-marker parsing handles edge cases (multi-character markers, names instead of emoji, e.g. "E:").
- Default colours and emoji for new people (must be readable in light and dark mode).
- Exact rules for matching a tweet to an existing event (exact keyword, normalised case and spacing, hashtag match).
- Caching durations for tweet fetches and video URLs.
- Site name and domain. "EmiBonnie Archive" is a working name only.
