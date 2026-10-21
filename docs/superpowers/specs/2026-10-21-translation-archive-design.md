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

## Goals

1. **Preserve.** Once a translation is archived, its text and credits survive even if the tweet is deleted or the account is suspended.
2. **Find by what was said.** Full-text search across translation text, including Thai characters that appear in translations.
3. **Browse by event.** An events timeline is the home screen. Each event page lists its translations in the order things happened.
4. **Low-effort intake.** Anyone signed in pastes a tweet link. The site fills in everything it can, and the submitter confirms or corrects it.
5. **Watch while reading.** The clip plays in a player that stays in view while the translation scrolls.
6. **Respect translators.** Credit is always shown. Translators can remove their entries or opt out entirely.
7. **Near-zero running cost.** The site runs on free tiers.

## Non-goals (this version)

- Collecting tweets automatically from translators' accounts. Every entry starts from a link someone provides (pasted, bulk-pasted, or imported). Watching timelines may come later.
- Storing copies of video files. Clips are played from X's servers and are only linked, never copied.
- Subtitles on full-length streams (matching clips to their place in the original stream). See "Later" below.
- Moderation by anyone other than the owner.
- Native mobile apps.

## Anti-goals (would make it a failure even if it works)

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

### Translation (one archived entry)

**Entries have no title** (owner's decision). A tweet stands for itself. Wherever entries are listed (event pages, search, person pages), each one shows the opening lines of its translation text, with speaker emoji, as its preview.

One translator's translation of one clip, or one moment. It has these fields, which mirror the translator's Notion columns:

| Field | Source | Notes |
|---|---|---|
| Date | tweet's posted date, editable | date the moment happened if known, otherwise post date |
| Artist(s) | derived from mapped speakers, editable | the known people in the entry |
| Type | submitter picks from a list the owner manages | e.g. show / interview, fan meet / fan day, live |
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

A group of translations from the same occasion (a fan meeting, a show appearance, a livestream). It's identified by **keyword and/or hashtag**. Translations from different translators that share the event's keyword or hashtag land on the same event page automatically.

- An event has a display name (defaults to the keyword), a date, keyword(s), hashtag(s), a type, and an optional client/media.
- **Ignored hashtags:** the owner keeps a list of general hashtags (e.g. #EmiBonnie) that are never used for grouping.
- **Unsorted:** a translation that doesn't match any event (e.g. a personal livestream with no hashtag) goes to an Unsorted list. The owner files it into an existing event or creates a new one, e.g. "bonnie personal live, 9 Oct 2026". The owner can also move any translation to a different event.
- If a tweet's keyword or hashtag doesn't match an existing event, a new event is created automatically and flagged for the owner to look over.

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

**Generic roles** cover people who don't need telling apart: Host, Fan, Speaker. They have a neutral style and no person page.

### Speaker mapping

Translators each use their own speaker markers: 🐰/🦊/🦁/🌧️ for one, 💜/🧡 for others, and sometimes a line has no marker at all. When an entry is submitted:

1. The site finds speaker markers: an emoji or short label at the start of a line, followed by a colon.
2. For each marker, it pre-fills a guess. 💜 → bonnie and 🧡 → emi by default. After that, it uses that translator's previous mappings (e.g. for @vacantvolcanic: 🐰 → bonnie, 🦊 → emi, 🦁 → leo).
3. The submitter confirms each marker using a dropdown: known people, "add a new person", or a generic role (Host / Fan / Speaker).
4. The confirmed mapping is saved on the entry and also remembered for that translator.
5. 🗣️ (crowd) is pre-mapped to a crowd-reaction style.

### Speaker display

The **chosen style is chat bubbles, everyone on the left in one column**, with a cast list at the top (mockup approved during brainstorming):

- Each line that starts with a speaker marker becomes a bubble. The bubble shows the person's **standard emoji** (not the translator's), their name, and a tint in their colour.
- When the same speaker has several lines in a row, the emoji and name show only on the first bubble.
- Crowd reactions (🗣️) render as small inline notes between bubbles.
- Lines without a marker (headers, context like "[After 'Number One Girl'…]", and footnotes marked * / **) render as plain text in place. Footnotes go at the end.
- A "show original" toggle shows the verbatim tweet text.

## Intake: adding a translation

1. The submitter signs in and pastes a tweet link.
2. The server fetches the tweet from two free, unofficial sources:
   - **X syndication** (`cdn.syndication.twimg.com/tweet-result`, the endpoint used by Vercel's react-tweet). It confirms the tweet exists, detects deleted tweets (`TweetTombstone`), and returns the author ID, handle, created date, media details (including video variants and the original clip's URL via `expanded_url`), the quoted tweet, and the parent tweet for replies. **It cuts off long posts** (when `note_tweet` is present).
   - **FxTwitter** (`api.fxtwitter.com/2/status/{id}`). It returns the **full text of long posts**. Tested at 2,502 characters.
   - Rule: the text comes from FxTwitter whenever the post is long or the two sources disagree. Everything else comes from syndication. If both fail, the submitter can paste the text by hand. A manually entered entry is marked as such.
3. **Duplicates:** if the tweet ID is already archived, the submitter is sent to the existing entry.
4. **Quotes:** if the tweet quotes another tweet by the same translator, the site offers to archive that one too and link it as "follows on from". If it quotes someone else's tweet that holds the clip, that becomes Original media.
5. **Threads** (follow-up replies by the same translator, for extra context or overflow text): the free sources show a reply's parent but not its children. The submitter can paste any follow-up tweet links, and the site appends their text to the same entry, in order. If the pasted tweet is itself a reply in the translator's own thread, the site walks up through the parents and offers to include them.
6. The site pre-fills Keyword, Hashtags, Event match, Artist(s), and the speaker map. The submitter confirms speakers and any details that weren't found, then saves.
7. The entry is **live immediately**. It records who added it.

Tested examples (2026-10-21):
- `vacantvolcanic/status/2030321729902641632`: a long post with a 2½-min clip.
- `vacantvolcanic/status/2110438810274414709`: a long post that quotes the same translator's earlier clip.
- `danaNYB/status/2108748780564816034` and `SugarHoneyz13/status/2108532547101856124`: two translators covering the same event with the same keyword and hashtag. Both clips were posted by other accounts.

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

- **Sign in with X** for everyone (OAuth 2.0 with PKCE, scopes `users.read tweet.read`). After sign-in, one call to `GET /2/users/me` gets the user's numeric ID and handle.
  - Tested 2026-10-21 on an X developer app with **zero credit**: sign-in and `/2/users/me` both succeeded. The rate limit is 75 per 15 minutes per user. X's pricing page lists user lookups at $0.010, so this may start being charged or refused in future. Pre-paid credit means the worst case is failure, not a bill.
  - **Store the numeric X user ID**, not the handle, because handles change.
- **Sign in with Google** is a backup, so the site stays usable if X sign-in breaks.
- **Translator recognition is automatic:** if a signed-in user's X ID matches a translator ID on archived entries, they're that translator. No claim step. (Google-only users can't act as a translator.)
- **Translator powers:** remove any of their own entries; opt out entirely.
  - **Remove** (owner's decision): the entry disappears from the site, including search, event pages, and public outputs, and that tweet can't be submitted again. The data is kept privately, not deleted, and stays in the private backup marked as removed.
  - **Opt out:** applies to the whole account. Every entry by that translator disappears from the site the same way, and nothing they posted can be added again by anyone, through submission, bulk paste, or Notion import. Submitters get a clear message. Imports skip those tweets and list them as skipped.
  - **Undo (my call):** a translator can restore entries they removed, or opt back in, since the data was never deleted.
  - The owner's **hide** works the same way, but only the owner can undo it.
- **Owner:** a single admin, set by X user ID in config.
- **Editing (my call):** a submitter can edit their own entries. A translator can edit the details of their own translations (speaker map, type, event, order) but not the translation text, which stays verbatim. The owner can edit everything. Every edit is logged (who, when, before/after), so a wrong change can be undone.
- **"Added by" (my call):** shows the submitter's X handle. Google-only users choose a public display name when they first submit. Names and emails from Google are never shown publicly, and emails are never exported.
- **Blocking:** the owner can block a user. Their submissions are hidden and they can't submit again.
- **Approval switch:** a site setting "new submissions need approval". It's **off** at launch (entries go live immediately). When it's on, new entries wait in the owner's review list.
- If X sign-in fails at the step where the site asks X who the user is, the site shows a clear message, and the owner sees an alert in the admin page.

## Pages

The approved mockups (phone and web) are in `.superpowers/brainstorm/` during brainstorming. That folder is not committed, so the descriptions below are the source of truth.

- **Home: events timeline.** Events newest first, grouped by month. Each event shows its name, date, hashtag, and number of translations. Search is one tap away (🔍). Web uses the same layout, wider.
- **Search.** A search box with filters for person, event, translator, type, and date range. Results show a short excerpt of the matching text with the match highlighted.
- **Event page.** Name, date, keyword, hashtag, type, client/media, number of translations, and translators. Filter by person and translator. The list is in event order (the order things happened), with a toggle for newest first.
- **Translation page.**
  - **Web:** the video is on the left and stays fixed while the right column scrolls. **Phone:** the video is pinned to the top while the text scrolls underneath.
  - Then the date, translator, "clip by" credit, tags (people, type, client, keyword, hashtag), and the speaker bubbles.
  - At the bottom: original tweet link, original media link, "follows on from" / "next" links, added by, Copy link, and Report.
  - **If the tweet is deleted:** the video area is replaced by "Original tweet is no longer available. Translation kept below."
- **Person page.** The person's emoji, colour, and name, with their translations grouped by event.
- **Translator page.** The translator's handle (as last seen) and their translations. Shows "opted out" if they have.
- **Add page.** Paste a link → review the pre-filled details → map speakers → save.
- **Me page.** My submissions. For translators, also: my translations, remove, opt out.
- **Admin pages.** Import (Notion CSV, bulk paste, progress), needs speakers, check these, Unsorted, recently added, reports, events (merge, rename, reorder entries), people (edit, merge), ignored hashtags, Type and Client/Media lists, blocked users, approval switch, and the X sign-in health alert.

## Video player

- It plays the clip from X's own servers (the `video.twimg.com` MP4 URLs from the syndication media variants), in the site's own player, so it can be pinned. It picks a small variant on phones. Video files are never stored or re-hosted.
- The video URLs are fetched fresh when the page loads (or cached briefly), not stored permanently, since they can change.
- **Early check for the builder:** confirm that X's video URLs play when embedded on another site (no hotlink blocking or expiring signatures). **Fallback** if they don't: show X's standard tweet embed in the video area, unpinned on phone.

## Tweet health check

A scheduled **GitHub Actions** job (daily) re-checks archived tweets through syndication and updates Tweet status. Deleted or unavailable tweets switch the translation page to the "no longer available" state. Archived text is never touched.

## Search

- Postgres full-text search on the English text, plus trigram (`pg_trgm`) matching so that Thai, which has no spaces between words, and partial words still match.
- Search covers: translation text, Keyword, hashtags, event names, people names, and translator handles.

## Technical setup

These choices are mine. They follow the owner's other fan projects (plain JS, Vercel, `node --test`, GitHub Actions), and the owner asked to see the reasons.

| Piece | Choice | Why | Passed over |
|---|---|---|---|
| Front end | Plain HTML/CSS/JS, no framework | Matches the owner's other projects. Fast on phones. | React/Astro: more than a browse-and-search site needs |
| Hosting + server | Vercel (free), serverless functions | The owner already uses it. Covers sign-in, intake, and admin. | Cloudflare: also good, but a new platform for the owner |
| Database | Neon Postgres (free plan, **signed up with Neon directly**, not via the Vercel Marketplace, which moves billing to Vercel) | Full-text + trigram search for Thai (`pg_trgm` 1.6 supported). Free: 1 GB per project, 100 compute-hours a month, no card. Sleeps after 5 min idle, so expect a slower first query after a quiet spell. No documented deletion of inactive free projects. | Supabase: pauses free projects after a week without activity. GitHub-as-DB: submitters would need GitHub accounts |
| Auth | Better Auth (MIT, self-hosted in the app) | One library for X + Google, stored in our own DB, no per-user fees | Hand-rolled OAuth |
| Tweet data | X syndication + FxTwitter, server-side, cached | Free. Long-post text. Detects deletions. | Paid X API ($0.005 per post read) |
| Scheduled and long jobs | GitHub Actions (private repo, free org: 2,000 min a month; it stops at the limit, with no charge, when no card is on file) | Daily tweet health check, nightly backup, bulk import runs. Expected about 300 to 450 min a month plus imports | Vercel Cron: once a day at most, and functions are capped at 5 min |
| Backup | Nightly export of public archive data (translations, credits, links, events, people) to JSON in a **private** `mintbluecar` repo | Survives the site or database dying | Provider-only backups |

**Backup and removals (my call):** the backup repo is **private**, because removed and opted-out entries are kept in it, marked as removed. A public repo would keep them reachable. Submitter account details (emails, sign-in tokens) are never exported.

**Deploying (my call):** Vercel Hobby can't connect to repos owned by a GitHub organisation, so pushes to `main` deploy through a GitHub Actions workflow using the Vercel CLI (`vercel deploy --prebuilt --prod`) and a Vercel token stored as a repo secret. Pull requests get preview deploys the same way. Checking that this works is one of the first build steps.

**Free-tier check (2026-10-21, official pricing pages):** Vercel Hobby is free and allows non-commercial use. Over-limit usage pauses the feature, with no bill. Neon Free, Better Auth (the framework; only their hosted dashboard is paid), Google sign-in (basic scopes; the app must be set to "In Production" to avoid the 100-user testing cap), and GitHub Actions are all $0. Sign in with X was tested working on a zero-credit app.

**Unofficial sources are fragile.** Both tweet sources are undocumented or third-party and can break when X changes things. Intake must fail gracefully: it falls back to the other source, then to manual text entry. The owner gets an alert when one source has been failing.

**Secrets** (X client ID and secret, Google OAuth, database URL, Better Auth secret) live only in Vercel environment variables and local untracked env files. They are never committed.

**Identity:** this is a fan project. The repo lives in the GitHub org `mintbluecar` and commits as the fan identity. The Vercel, Neon, Google Cloud, and X developer accounts must be the fan-side accounts. No public content (README, committed files) names the owner's personal account, real name, or local file paths.

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
