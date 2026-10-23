# Changelog

All notable changes to this project are documented here. Versions are semver tags (`vX.Y.Z`). Each release lists its **upgrade steps**; to take one, see `docs/start-your-own.md`, step 10.

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
