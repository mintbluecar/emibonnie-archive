# Changelog

All notable changes to this project are documented here. Versions are semver tags (`vX.Y.Z`). Each release lists its **upgrade steps**; to take one, see `docs/start-your-own.md`, step 10.

## 0.1.5

UI polish. Entries and events browse as picture-led cards, translators get a linked credit line, events can have a typed title, and the embedded X post sits at the site's text size.

**Upgrade steps:**

1. `git fetch upstream --tags && git merge v0.1.5`.
2. **Copy keys.** If `site/copy.json` overrides any of these, remove the line (the build refuses unknown keys): `item.translator`, `event.allPeople`, `event.translatorFilterLabel`, `event.translatorAll`. New keys you may override: `item.translatedBy` ("translated by:"), `event.keywordLabel.one|other` ("keyword:"/"keywords:"), `event.hashtagLabel.one|other` ("hashtag:"/"hashtags:").
3. A site `theme.css` that styled `.c-event__people-filter`, `.c-event__account-filter` or `.c-event__account-select` can drop those rules: the elements are gone.
4. `npm run build`, then redeploy.

No migrations. Titles only apply to events created from now on; an existing event keeps its name.

- **Picture-led grids.** On the event, person and translator pages, translation entries are cards in a grid (thumbnail on top, text clamped to three lines, the credit pinned to the bottom).
- **Home event cards.** Events show as cards grouped by month: a representative picture (the first of an event's three opening items that has one), the name, the date, the hashtag on one line, and the count.
- **"translated by: @handle"** is a last line on every card and on the item page, linking to the translator's X profile in a new tab. Cards are `<article>`s with one stretched main link, so the credit link is never nested. Previews gain `accountUrl`; item credits gain `account.url`.
- **Event titles.** A draft's `overrides.eventName` names a new event; the slug still comes from the keyword. With none, the keyword is the name, as before.
- **The event page** shows the event's keyword(s) and hashtag(s) as labelled rows (each hashtag searches X, in a new tab), then the type/client pills. Its own people chips and translator dropdown are gone: the in-place search's filters do the same.
- **Dropdowns** draw their own inset chevron (`.c-select`, `src/styles/components/select.css`).
- **The embedded X post** is scaled to `--embed-zoom` (0.82) with CSS `zoom`, since X's iframe can't be styled and has no size option; on desktop it's now about 450px wide. The fallback blockquote keeps the site's sizes.

## 0.1.4

Search happens in place. There is no search page any more: home is the search, and the event, person and translator pages each search within themselves. Old `/search?…` links redirect home with the same query.

**Upgrade steps:**

1. `git fetch upstream --tags && git merge v0.1.4`.
2. **`/search` is gone.** The page (`src/html/search.html`, `public/js/pages/search.js`) is removed, and `vercel.json` now carries a 308 redirect from `/search` to `/` (from `src/pages.js`'s new `redirects`), which keeps the query string, so shared links like `/search?q=hug&people=2` still work. Nothing to do unless your site links to `/search` itself (a custom page or `copy.json` text): point it at `/` (or `/?q=…`).
3. **Copy keys.** If `site/copy.json` overrides any of these, remove the line (the build refuses unknown keys): `search.recentSearches`, `search.quickChips`, `event.search`, `person.search`. New keys you may override: `search.placeholderEvent` ("search this event…"), `search.placeholderPerson` ("search {name}…"), `search.placeholderAccount` ("search @{handle}…"), `search.typeToSearchAll` ("type to search everything"). `search.placeholder` is still home's, and the box's whenever a page's own filter is removed. `nav.search` now only labels the phone bar's search icon (on pages with no box), which goes home.
4. A site `theme.css` that styled `.c-search__recent-*`, `.c-search__quick-*`, `.c-search__blank`, `.c-event__search`, `.c-person__search`, `.c-header--live` or `.c-header__below--desktop` can drop those rules: the elements are gone. `src/styles/components/searchPage.css` is now `inlineSearch.css`.
5. `npm run build`, then redeploy. **Git-integration path:** commit the rebuilt `vercel.json` first (it gains `redirects` and loses the `/search` rewrite).

No migrations. `/api/search` is unchanged.

- **Home is the search.** The event list shows until you type in the box or set a filter; then the results replace it in place, in the same column, and clearing the box and filters brings it back. The URL follows along (`history.replaceState`, so "back" still leaves the page), so a search is a shareable link, and `/?q=…&people=…` opens straight into its results. Debounced 250ms, 2-100 characters for `q`, filters work with an empty box, and a late response never overwrites a newer one, as before.
- **Scoped search.** The event, person and translator pages have the same box, filter sheet and result cards, searching within that page: the event, person or translator is preset as a removable chip under the box (and shows as already selected in the sheet), and the placeholder says what's searched. Removing the chip searches the whole archive, still on that page; "clear all" brings it back. Results replace the page's entries (and their own people/translator/order controls) in place; the page's head stays. The URL is the page's own path with the query (`/e/x?q=hug`; `scope=all` once the preset filter is removed), so a reload shows the same thing. The person page's "with…" picker now searches in place too.
- **The box never navigates, and nothing autofocuses.** The old "focus the box → go to `/search`" wiring (`headerLinks.js`) and the autofocus rule (`state/searchFocus.js`) are removed. Pages with no in-place search (the item page, about/privacy/takedown, 404, not-found and error states, an opted-out translator) have no box; the phone bar's search icon there goes home.
- **Box placement.** On desktop the box sits at the top of the content column under the pinned bar on all four search pages; on a phone the search row stays pinned just below the bar on all four (home's tagline still scrolls away above it).
- **Tab bar: home · ＋ add · me.** The search tab is gone. The event and person pages' own search icons are gone too (the box is right there).
- **Recent searches and quick chips are gone.** Home's blank state is its event list. The active-filter chips use the chip padding tokens with no fixed height, and keep a ≥24px hit area.
- **Meta pages ignore their query entirely.** The event and item pages' function routes accepted any query but still parsed it, so a repeated param (`?people=1&people=2`, which the in-place search writes) would have answered 400. Now a route with `query: null` never parses its query.
- **Removing the page's own chip with nothing typed** shows a short hint, "type to search everything", in place of the page's list, since the box now searches the whole archive; "clear all" brings the chip and the list back.
- **Results are announced.** One polite live region (`role="status"`) reads out the count line, "no results" or the error after each search, and goes quiet when the list returns. Going back to the list empties the results, and a new search is `aria-busy` until it lands, so old results never flash up while it loads. One character in the box counts as an empty box.
- **Icon-only buttons and links have a `title`** matching their `aria-label` (the filter button, the phone bar's search icon, the dialogs' ✕ buttons, the image carousel's arrows, the video's play and full-screen buttons, the remove-filter chips). A test keeps every labelled button or link in `public/js` that way.
- **robots.txt** no longer lists `/search`; it keeps search results out of crawls with `Disallow: /*?q=` and `Disallow: /*?*scope=`. A site with its own `robots.txt` should do the same.
- **`npm run dev`** answers `vercel.json`'s `redirects` too (before rewrites, query kept). e2e gains `e2e/search.spec.js`.
- **The X embed fills the column, up to 550px.** The item page's embed no longer sets `data-width="350"`: X's embed "will adjust to the width of its containing element ... and will fill up to 550 horizontal pixels" (docs.x.com, embedded posts FAQ). Its box (and the fallback card) is `--embed-width: min(100%, 550px)`, centred in the column; the crop at `--embed-max-height`, the fade and the "show full tweet" switch are unchanged. A site `theme.css` that sets `--embed-width` should now use the same form (`min(100%, 400px)`, say): the box takes that width exactly, so a bare px value could overflow a phone's column.

## 0.1.3

Owner polish: a light/dark switch, thumbnails on cards, slimmer chips, hashtag links to X, a translate icon for translators, default emoji for generic roles, a favicon, a smaller cropped X embed, an owner command to fix a speaker on an archived item, and a dev watch mode. Fixes the item media jumping when it pins, long URLs overflowing (which also made the header stop short of the window's edge), off-centre emoji, and the item page's stray search row.

**Upgrade steps:**

1. `git fetch upstream --tags && git merge v0.1.3`.
2. **If your site's `theme.css` sets any colour for dark mode, rewrite it before you deploy.** The engine's own dark values now sit on `:root:not([data-theme="light"])` (inside `@media (prefers-color-scheme: dark)`) and `:root[data-theme="dark"]`, which are more specific (0,2,0) than a site's plain `:root` (0,1,0). So, as soon as you merge, an old `@media (prefers-color-scheme: dark) { :root { … } }` block **stops applying, even on a device in plain dark mode** (the engine's dark values win), and it also still applies on a dark device whose visitor forced light, mixing your dark values into the light page. Rewrite it into the two-block pattern: `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { … } }` plus an identical `:root[data-theme="dark"] { … }`. Put light values on a plain `:root`, not under `@media (prefers-color-scheme: light)`, and repeat in both dark blocks any token you set for light that the engine's dark block doesn't set itself (or it leaks into dark). `docs/site-settings.md`, "Light and dark", has a worked example.
3. If `site/copy.json` overrides `item.translatedBy`, remove it (the key is gone; the build refuses unknown keys). The translator icon's tooltip is the new `item.translator`.
4. Optional: `"favicon": "<file>.png"` in `site/site.json` (a .png or .svg in the site folder) to use something other than the logo as the browser icon; `"roleEmoji": { "host": "…" }` to change a role's default emoji.
5. `npm run build`, then redeploy. **Git-integration path:** commit the rebuilt `vercel.json` first.

No migrations.

- **Light/dark switch (f).** A header icon button cycles light → dark → follow the device; its tooltip and name come from `theme.*` copy. The choice is remembered per browser (`localStorage`, guarded: a private window still works, it just isn't remembered) and set as `data-theme` on `<html>` before first paint by a tiny external blocking script (`/build/boot-<hash>.js`, `{{asset:boot.js}}` in every page template; no inline script, so the CSP is unchanged). `tokens.css`'s dark values now live in two identical blocks (device dark unless forced light; forced dark), as do header.css's and filterSheet.css's dark rules and the example `theme.css`; a test keeps each pair identical. Person colours (`applyColours`) redraw on a switch; the X embed takes the page's theme on its next load. e2e runs axe on five pages with the theme forced the other way.
- **Default role emoji (a).** A generic role whose marker had no emoji (a bare `:`) shows 💬 fan, 🎤 host or 🗣 speaker in bubbles, compact previews, search lines and the cast. A translator's own emoji still wins; crowd keeps its inline note. The defaults are `ROLE_EMOJI` in `src/domain/constants.js`; a site may override any with `roleEmoji` in `site.json`.
- **`npm run remap` (b).** `npm run remap -- <sourceId> '<marker>=person:<igHandle>' '<marker>=role:<fan|host|speaker|crowd>' … [--kind <kind>]` re-points markers on an archived item (default kind translation), in one transaction with actor `system` (audited). It sets the speakers (`setSpeakers`) and swaps the item people the old speakers contributed for those the new ones do, derived exactly as intake derives them (`speakerPeopleOf`); people from tags, authors or a seed stay. The text never changes. It refuses a marker the text doesn't use, an unknown person or role, an id that isn't archived, a hidden or removed item, and a run with neither `DATABASE_URL` nor `PGLITE_DIR` (it never prints the connection string). Create a new person first (e.g. the seed's `createPeople`). Kinds opt in with an optional `remapSpeakers`.
- **Card thumbnails (c).** Preview cards (full and compact) and search results show a small picture beside the text: a clip's stored poster with a ▶ over it (replacing the 🎬, which stays for a clip with no poster), else a photo post's first picture, else nothing. Lazy, async, sized by the picture's own width/height at `--thumb-size`; alt text `item.thumbClip` / `item.thumbPhoto`. The preview contract gains `thumb`.
- **Chips (d, g).** Chips and cast chips are their content plus `--chip-pad-y`/`--chip-pad-x` padding, with no fixed or minimum height (they were 44px tall), so they scale with text; a clickable chip keeps a ≥24px hit area through `::before` (WCAG 2.2 SC 2.5.8). The emoji has its own element, 0.3em from the label (the event, person and filter people chips too). Wrapped rows get a 6px row gap, and consecutive chip groups (hashtags, then people) no longer touch.
- **Hashtag chips link to X (h).** `#tag` chips on the event and item pages open `https://x.com/hashtag/<tag>` in a new tab (`rel="noopener noreferrer"`, tooltip `chips.searchOnX`), built through a new outbound-link allowlist (`public/js/core/links.js`: https, x.com). Keyword, type and category chips stay plain.
- **Translator icon (e).** A 文A-style translate icon (Material Icons' `translate`, Apache-2.0) replaces "tl" before a translator's handle on cards, credits and search results; its `title` and `aria-label` are `item.translator`. `item.translatedBy` is removed.
- **Favicon (j).** Every page links `rel="icon"` (type from the extension) and `rel="apple-touch-icon"` to the site's logo, or to the new optional `site.favicon` (a .png/.svg path inside the site folder, schema-checked; the build fails if the file is missing). It's copied content-hashed into `/build/` (`{{asset:icons}}`), so it has the immutable cache. No resizing: a square PNG of 180px or more works everywhere; iOS ignores an SVG touch icon.
- **Item media pins where it starts (k).** On desktop the clip sat 16px below the bar, then jumped up flush when scrolling began. A new `--item-media-gap` (8px phone, 16px desktop) sets both its starting offset and its sticky `top` (`--sticky-top` + gap), so it no longer moves; a background-coloured shadow covers the gap so text scrolls away under the bar's edge. On a phone the back link sits above the clip, so the clip still rises until it pins, at the same 8px gap. The 40svh cap is unchanged.
- **Smaller X embed (l).** The embed adds X's `data-cards="hidden"` (no photo/video/link previews: the pinned player already shows the clip), `data-conversation="none"` (no parent post) and `data-width="350"` (X allows 250–550), per X's embedded post parameter reference; `--embed-width` caps the box so the fallback matches.
- **"show original text" (m).** The item page's toggle (`item.showOriginal`) now reads "show original text".
- **Header full width at in-between widths (n).** The bar stopped short of the window's edge at around 660px because a long unbroken URL in a bubble made the page wider than the window; the bar (like the tab bar) spans the viewport, not the overflow. Fixed at the cause (p); e2e now checks at 390, 700 and 1280 that the bar and tab bar span the viewport with no sideways scroll, even with a 120-character URL on the page.
- **Centred emoji (o).** Avatar circles centre the emoji as a grid, in its own line-height-1 `.c-emoji` box nudged by `--emoji-nudge-y` (0.05em; measured in Chromium on macOS: from 1.25px high to 0.15px). The cast, people chips, compact lines and the person header share it.
- **Long URLs wrap (p).** Bubble, crowd, plain and footnote lines, search match lines, the quote card and the embed fallback wrap with `overflow-wrap: anywhere`, and a bubble may shrink in its row. The text itself is never changed.
- **Cropped embed (q).** The embed (or its fallback) sits under an "original tweet" heading (`item.embedHeading`, an `h2`), cut at `--embed-max-height` (320px) with a fade. A chevron button (`item.embedMore` "show full tweet" / `item.embedLess` "show less", with `aria-expanded`) appears only when the content is taller than that, checked by a `ResizeObserver` since X resizes its iframe after loading. The fallback's own 8-line clamp is gone.
- **No search row on the item page (r).** The item page's header has no search row or box at any width; its bar's search icon goes home. Other pages are unchanged.
- **`npm run dev:watch` (i).** Also `npm run dev -- --watch`: builds, serves, and on a change under `src/html`, `src/styles`, `public/js` or the active site folder (`SITE_DIR`) rebuilds (debounced, never two builds at once) and restarts the server; refresh the browser to see it.

## 0.1.2

A pinned header, all text 2px bigger, an optional X embed of each translation's original post, working footer links, and dates without clock times.

**Upgrade steps:**

1. `git fetch upstream --tags && git merge v0.1.2`.
2. `npm run build`.
3. Redeploy. **Git-integration path:** commit the rebuilt `vercel.json` first.
4. **To use the embed:** set `"embedSources": true` in `site/site.json`, review the privacy wording it switches on (`privacy.embedNotice`, `privacy.embedPolicyLinkLabel`, and `privacy.noSaleNoAdsEmbed`, which replaces `privacy.noSaleNoAds` so the page doesn't claim "no trackers"; all overridable in `site/copy.json`), then build (step 2) and redeploy. It's off by default.
5. If `site/copy.json` overrides `item.editableUntil`, `item.originalMedia` or `item.quotedTweet`, remove those lines: the keys are gone, and the build refuses unknown keys.

No migrations.

- **Pinned header.** On desktop the whole one-line header stays at the top while scrolling, on every page. On a phone a slim bar stays (logo, wordmark and a search icon that goes to `/search`), while the tagline and search box scroll away under it (never over it); on the phone search page the search row stays pinned just below the bar instead. The bottom tab bar is unchanged. The bar's height is `--sticky-top`, derived from two new tokens (`--tap-target` 44px and `--header-pad-y`, 4px phone / 8px desktop, plus the 1px border: 53px / 61px), so a theme that changes either moves the bar, the item page's pinned clip (which sits just below it) and `html`'s `scroll-padding-top` together. Nothing animates. The search row is now its own `search` landmark after the `<header>`.
- **Desktop home has a search box** again, at the top of the content column under the bar (the bar itself stays clean); focusing it goes to `/search`, as on a phone.
- **The search page doesn't pop the keyboard.** It never focuses its box on a touch device (`pointer: coarse` or `hover: none`); with a mouse, only the blank search page does. Arriving from a person chip, an event's search icon or any link with a query or filters never steals focus.
- **All text 2px bigger.** Every font size is now a type-scale token in `src/styles/tokens.css` (`--text-10` … `--text-40`, named after the 1b mockup sizes), each the mockup size plus `--text-bump: 2px`; no component hard-codes a `font-size` any more, and a test keeps it that way. A site's `theme.css` that sets its own font sizes on engine classes should move them onto these tokens (or retune `--text-bump`).
- **`embedSources` (site setting, default `false`).** When on, a translation page shows its original post as X's official embed in place of the footer's link: a `<blockquote class="twitter-tweet" data-dnt="true">` holding the archived text, author and the post's `https://x.com/<handle>/status/<id>` link, which X's `widgets.js` (added only on pages with an embed, once) replaces with the post. If X doesn't load, the blockquote stays as the fallback, line breaks kept. A post already marked deleted or unavailable gets no embed: the archived text with a "no longer available" note (`item.sourceGoneEmbed`, which doesn't say "below"). Dark mode sets `data-theme="dark"`. The build's CSP then adds only `script-src https://platform.twitter.com` and `frame-src https://platform.twitter.com`, and the page sets X's `twitter:widgets:csp` switch so widgets.js doesn't probe for inline styles. Off, the CSP is unchanged. The privacy page shows a notice about X's embed, linking X's privacy policy, only when the setting is on.
- **One "original tweet" link.** With `embedSources` off, the footer's "original media" and "quoted tweet" links are gone (the pinned media area shows those); "copy link" and "report" stay.
- **Item pages no longer show the viewer's local time or the post time; only the date.** A time will only be shown where an event happened, in that place's local time, once the engine stores that. The check-for-update button no longer says "editable until" a time, and now reads "check X for edits". The item view's `credits.postedAt` is removed from the API and contract. `timePair()` and `cityOf()` are removed from `public/js/core/format.js`.
- **Footer links work.** The footer linked `/about/`, `/privacy/` and `/takedown/`, the item page's report link `/takedown/`, and the tab bar `/add/` and `/me/`. No route has the trailing slash, so `/privacy/` answered 404. Every page path now comes from `public/js/core/routes.js`, pinned to `src/pages.js`, and a test fails on any hand-typed link path in `public/js` that doesn't resolve. The event page's report link (a `/soon` placeholder) now goes to `/takedown`, like the item page's.
- **The person counts line wraps only between counts** ("0 shared stories" never splits): no-break spaces inside each count value.
- **"Show original" keeps line breaks.** The original text is one element with `white-space: pre-wrap`, so the stored line breaks and blank lines (including between a thread's parts) show as written, and a long URL wraps.

## 0.1.1

Fixes how the engine is wired into Vercel. On the first production deploy every `/api/*` call answered 400 `unknown query parameter: ...route`, and shared `/t/<id>` and `/e/<slug>` links showed Vercel's own 404 `NOT_FOUND`.

**Upgrade steps:**

1. `git fetch upstream --tags && git merge v0.1.1`.
2. `npm run build`.
3. Redeploy.
4. **Git-integration path** (your repo tracks its own `vercel.json`): the build rewrites it. Commit the new `vercel.json` before you push, or Vercel keeps the old rewrites.

No migrations.

- **One function at `api/index.js`** (was `api/[...route].js`). Vercel passed the catch-all file name's segment to the function as a `...route` query param, which the handler refuses, and the file only matched one path level, so `/api/meta/...` never reached it.
- **Unnamed rewrites only, all to `/api`.** `vercel.json` now sends `/api/(.*)`, `/e/(.*)` and each kind's `<urlPrefix>(.*)` (e.g. `/t/(.*)`) to `/api`, and static pages to their file the same way (`/p/(.*)` to `/person.html`). A named param in a rewrite source is added to the query string ([Vercel's rewrites doc](https://vercel.com/docs/routing/rewrites)), so none are left. A build test now fails on a named source, or on a function rewrite to anything but `/api`.
- **The meta routes match the page paths.** The function sees the original request URL, so the link-preview routes are `/e/:slug` and `/t/:sourceId` (per kind). `/api/meta/*` is gone. `src/pages.js`'s `meta` field is now a renderer name (`meta: 'event'`), and the routes and rewrites both derive from it and the kinds registry.
- **`npm run dev` routes like Vercel:** a rewrite to `/api` calls the handler with the original URL, with no query params added, and a rewrite source with a named param is refused. Dev still can't reproduce Vercel's own routing, so `docs/start-your-own.md` (step 6) now lists two curl checks for the first preview deploy, and its troubleshooting covers both symptoms.

## 0.1.0

The first release: a read-only archive (browse, search, item pages) with intake from the command line, and the contributor framework.

**Upgrade steps:** none for a new archive: follow `docs/start-your-own.md`. A site repo made from an earlier build of this release: follow the one-time merge steps under "The build no longer rewrites tracked files" below.

- **Engine foundations:**
  - Plain-JS, type-checked and lint-enforced layers (`docs/architecture.md`).
  - A data model with an automatic diff-only audit log, soft deletes, text-coded lookups, and checksummed engine and site migrations (ADRs 0004 and 0006).
  - Visibility rules for every hidden state: opted-out accounts, removed items, blocked submitters.
- **Intake:**
  - Two free tweet sources with fallback, normalised behind a host allowlist (ADR 0003).
  - Header parsing (keywords, dates, live platforms) and tag-steered event matching.
  - Speaker markers with per-account memory, follow-up threads, and edit-window refresh.
  - The `npm run add` and `npm run seed-dev` CLIs.
- **The item-kind plugin contract** (`src/kinds/defineKind.js`), with translations as the first kind. Generic ingest, hub views and search never name a kind.
- **Public API:**
  - One router function (`api/[...route].js`) over a route table, with CDN cache headers.
  - An Origin check on writes, and link-preview meta for event and item links.
  - A privacy sweep over every route, and CI on PGlite and Postgres 17.
- **Site settings:**
  - `site.json` validation, `copy.json` overrides of every user-facing word, and theme tokens.
  - The fictional example site (`examples/solluna/`), `npm run init-site`, `npm run setup` and `npm run doctor` (`docs/site-settings.md`).
- **Pages:**
  - Home, event, translation (with a stored-variant video player, a pinned media area and edit refresh), and search with a filter sheet.
  - Person and translator pages, about, privacy, takedown and 404.
  - The front end: auto-escaping `html` templates, CSP-safe colours, esbuild bundles with hashed files, self-hosted fonts.
- **Joint speaker lines:** a line with 2+ markers run together (e.g. both hosts reacting at once) renders as one shared, neutral bubble naming every speaker.
- **Per-person text shades:** each person's coloured text gets the least darkening that reaches AA contrast on its actual background, in light and dark mode. The colour validator warns instead of rejecting.
- **End-to-end checks:** `npm run e2e` runs Playwright smoke tests and axe accessibility checks at phone and desktop widths, in light and dark mode.
- **Contributor framework:**
  - `npm run new <route|page|component|migration|kind> <name>` scaffolds from minimal working templates.
  - `test/kinds/scaffoldedKind.test.js` (`npm run test:kind`) proves a scaffolded kind plugs in without touching the core.
  - `CONTRIBUTING.md` has a recipe for each extension point.
  - New docs: `docs/start-your-own.md`, `docs/limits.md`, and `docs/deploy-workflow.example.yml` (the Actions + token deploy path).
- **Operations:**
  - `npm run migrate` (engine then site migrations, used by deploys). It refuses to run with neither `DATABASE_URL` nor `PGLITE_DIR` set.
  - `npm run doctor` handles peeled annotated tags.
  - Site regions follow Vercel's current list, now including `yul1`.
- **Fixes from building the first real site:**
  - The dev server no longer corrupts its PGlite directory when an item page's background edit refresh overlaps later requests: every `Db` on one `PGLITE_DIR` now shares one PGlite instance, closed by its last user. Postgres (Neon) is unchanged.
  - `npm run new kind t` gives its refusal reason once, not twice.
  - `lowercaseNames` lowercases people's names only. Person and translator pages no longer lowercase event names in their group labels.
  - Search results show each matching line's speaker as the item page does: a known person's standard emoji, not the translator's own marker. A kind's `search.matchLines` now gets the presenter context as an optional third argument.
  - A known event hashtag matches its event wherever it is in the post, follow-up parts included, e.g. on the last line after the translation ("known tags decide"). The header still decides first: this only applies when the header's keyword and tags match no event. Event keywords, new tags, proposals and placement still come from the header only, and person hashtags never pick an event.
  - `overrides.people: [{ igHandle, role }]` (in a seed's `maps.json`, or from any ingest caller) adds known people to an item on top of the ones it derives, e.g. who a shared story is about when its speakers are only roles. An unknown handle or role is refused before anything is fetched.
  - New theme token `--color-label` for accent text (month and section headings, the active tab, result-card event names, open-profile and contact links). It defaults to `--gradient-to`, so existing themes look the same; set it to keep an exact brand gradient with a separate, readable label colour (`docs/site-settings.md`).
  - The build no longer rewrites tracked files, so engine upgrades don't conflict on build output. Page sources are templates in `src/html/*.html`; the build writes `public/*.html` from them, and both those and `vercel.json` are gitignored. The lines a site repo deletes from `.gitignore` (`/site/`, `/vercel.json`) now sit alone in a marked block at its end, so later updates merge cleanly. `npm test`'s write guard now covers every source tree, `site/` and the root `vercel.json` included.

    **Upgrade step** for a site repo made from an earlier build of this release (one that tracks the built `public/*.html` and `vercel.json`). This merge conflicts once; after it, they don't. Checked by merging into a site repo made the old way, on both deploy paths:

    1. `git merge` the release. Expect conflicts in `src/html/*.html` (your rebuilt pages, followed through the move), `.gitignore`, and `vercel.json` (modified by you, deleted by the engine).
    2. Take the engine's page templates: `git checkout --theirs src/html && git add src/html`.
    3. Take the engine's new `.gitignore` (`git checkout --theirs .gitignore`), then in its site-repo block at the end delete `/site/` again. On the Git-integration path, delete `/vercel.json` too. Then `git add .gitignore`.
    4. Stop tracking whatever build output is still tracked. Quote the pattern, since the files may already be gone: `git ls-files 'public/*.html' vercel.json`. On the Actions path, `git rm --cached` what it lists (usually just `vercel.json`). On the Git-integration path, leave `vercel.json` out of that: you keep committing it.
    5. `npm run build`. On the Git-integration path, `git add vercel.json`. Commit the merge, and check that `git status` is clean.
  - The engine's tests and e2e pass inside a site repo. The purity scan reads engine-owned files only (it skips `site/`, `.superpowers/` and `docs/superpowers/`), now also covers `test/` and `e2e/`, and bans a real site's names there, its seed's people included. The scaffolded-kind proof copies the engine without `site/` and runs on the bundled example. `npm run e2e` always runs the example on its own database.
  - New `npm run e2e:site`: the same browser checks on the repo's own `site/`, seeded from `site/seed/`, with every URL found through the site's API (`docs/start-your-own.md`, step 9). CI runs it on the example copy. `node scripts/dev.js` without a build now says to build first.
  - Engine tests name the example's own people only. A real site's host had slipped into three component and repo tests.
- **Pages match the approved mockups:**
  - Desktop (860px and up) has one top bar: logo and wordmark left, nav right, aligned with the page column, and no search box except on the search page. Phones keep the header, search box and bottom tab bar. The search box has a magnifier line icon.
  - The person page header is a centred card in the person's colour (large emoji, name, handle, counts, the scoped-search icon). The translator page's head is a card too.
  - Event, person and translator pages list entries as compact previews: the opening lines as one run of "emoji text", clamped to two lines (the item page keeps full bubbles). Kinds receive `ctx.compact` in their section's `render(section, ctx)`; the new-kind template passes it on.
  - Search results show only the matching lines, a long one cut to about 120 characters (grapheme clusters, so Thai marks and emoji sequences stay whole) around the match, under a "N translations · best match first" / "newest first" line. Browsing by filter shows at most the first two lines, compact.
  - New theme tokens: `--color-highlight` (search matches), and `--color-label-tint` / `--color-label-on-tint`, derived from `--color-label`, for the lavender count badges, active filter chips and the person/translator view switch (now one pill track).
  - The item page's clip shows its poster still and a centred play button before play; the native controls appear once it plays, and focus moves to the video. The poster is kept from new ingests (`VideoVM.poster`); clips ingested before this show the plain dark box until re-ingested.
  - A line that starts `: ` followed by words is a speech line with the marker `":"` (a speaker the translator gave no emoji). It's mapped like any other marker (`--map :=fan`, or `":"` in a seed's `maps.json`), and shown to people as "(no emoji)" (`speaker.noEmoji`). Mapped to a role, its bubble has a blank neutral avatar and the role name; unmapped, "unknown speaker". `:)` and other colon text stays text, and `:` never joins a joint marker.
  - New copy keys: `speaker.noEmoji`, `item.play`, `search.countLine`, `search.results.one`/`.other`, `search.newestFirst`, `search.bestFirst`.
