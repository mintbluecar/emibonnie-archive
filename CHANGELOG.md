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
  - `npm run migrate` (engine then site migrations, used by deploys).
  - `npm run doctor` handles peeled annotated tags.
  - Site regions follow Vercel's current list, now including `yul1`.
