# Changelog

All notable changes to this project are documented here. Versions are semver tags (`vX.Y.Z`). Each release lists its **upgrade steps**; to take one, see `docs/start-your-own.md`, step 10.

## 0.1.0

The first release: a read-only archive (browse, search, item pages) with intake from the command line, and the contributor framework.

**Upgrade steps:** none (first release). For a new archive, follow `docs/start-your-own.md`.

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
  - A known event hashtag or keyword matches its event wherever it is in the post, e.g. on the last line after the translation ("known tags decide"). New tags, proposals and placement still come from the header only, and person tags never match an event.
  - `overrides.people: [{ igHandle, role }]` (in a seed's `maps.json`, or from any ingest caller) adds known people to an item on top of the ones it derives, e.g. who a shared story is about when its speakers are only roles. An unknown handle or role is refused before anything is fetched.
  - New theme token `--color-label` for accent text (month and section headings, the active tab, result-card event names, open-profile and contact links). It defaults to `--gradient-to`, so existing themes look the same; set it to keep an exact brand gradient with a separate, readable label colour (`docs/site-settings.md`).
  - The build no longer rewrites tracked files, so engine upgrades don't conflict on build output. Page sources are templates in `src/html/*.html`; the build writes `public/*.html` from them, and both those and `vercel.json` are gitignored. **Upgrade step** for a site already on this release: `git rm --cached public/*.html vercel.json`, and on the Git-integration path un-ignore and commit your own `vercel.json` (`docs/start-your-own.md`, step 2). `npm test`'s write guard now covers every source tree, `site/` included.
