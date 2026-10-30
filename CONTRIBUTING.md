# Contributing

## Setup

1. Use Node 22 or later (see `.nvmrc`).
2. `npm install`.
3. `npm run init-site` (copies the fictional example into the gitignored `site/`).
4. `npm run build && npm run check && npm test` to confirm a clean baseline before making changes. `npm run e2e` runs the browser checks (`npx playwright install chromium` once).

## Workflow

1. Branch off `main`.
2. Make small, reviewable commits.
3. Before opening a PR: `npm run build && npm run check && npm test` must pass, and `npm run e2e` for any page or style change.
4. Open a PR using the template; fill in the checklist honestly.

## Recipes

One recipe per extension point. Most start with the scaffolder:

```sh
npm run new <route|page|component|migration|kind> <name>
npm run new -- migration <name> --site    # a site's own migration (note the --)
```

`<name>` matches `^[a-z][a-z0-9_]*$`. Files are camelCased (`top_items` → `topItems.js`) and URLs dashed (`/top-items`). The scaffolder never overwrites: if anything it would write already exists it stops, writes nothing and exits 1. Every template is a small working example that already passes `npm run check` and its own tests, so start from green and change one thing at a time.

What review checks on every PR, on top of each recipe's own list: the layer rules (`docs/architecture.md`), `// @ts-check` on every file, the lint limits (200 lines, 50 per function, complexity 10, 4 params), no fandom values outside `site/` and `examples/` (`test/purity.test.js`), and the PR checklist.

### Route (an API endpoint)

- **When:** the front end needs data no existing `/api/*` route returns.
- **Command:** `npm run new route <name>` → `src/routes/<name>.js` (`GET /api/<name>`), `test/routes/<name>.test.js`, and an import plus entry at the `// scaffold:` markers in `src/routes/index.js`.
- **Then:**
  1. Put the work in a `src/services/` function that takes `deps` first; the route only parses its input and calls it (routes may not import `src/repo/` or `src/db/`).
  2. Document the response shape in `src/http/contracts.js`.
  3. GETs keep `PUBLIC_CACHE`; a write is `method: 'POST'` with `cache: 'no-store'` (the handler then checks Origin).
  4. Add representative calls for it to the privacy sweep in `test/privacy.test.js`. The sweep fails until every registered route is called.
- **Copy from:** `src/routes/filters.js` (plain GET), `src/routes/refresh.js` (a POST).
- **Review checks:** visibility goes through `visibleItem()`/`visibleEvent()` (`src/repo/visibility.js`); no opted-out account, removed item or blocked submitter can leak; params are validated (a 400, never a 500); the SQL is parameterised.

### Page

- **When:** a new screen with its own URL.
- **Command:** `npm run new page <name>` → `src/html/<name>.html` (the page template), `public/js/pages/<name>.js`, `test/pages/<name>.test.js`, an entry in `src/pages.js` (at `// scaffold:pages`), and `<name>.title`/`<name>.empty` copy keys in `src/site/copyDefaults.json`. It reads `GET /api/<name>`, so pair it with `npm run new route <name>` or change `API_PATH`.
- **Then:**
  1. Build the view in `compose<Name>(data)` (pure, so tests need no DOM).
  2. Keep the page rules the template follows:
     - `pageShell` provides the chrome. The header has no search box unless the page searches in place: to add one, follow home or the event page (`components/inlineSearch.js`: `prepare`, `filtersSlot`/`region`/`headerProps`, then `bind`).
     - Paint first with `mountPage`.
     - Set a synchronous default `document.title`.
     - Wrap the initial load in try/catch: a 404 shows the page's own not-found state, anything else `mountLoadError`.
     - Guard every refetch with the `load` sequence check.
  3. Every word goes through `t()`/`tCount()`, with new keys in `copyDefaults.json`. Markup goes only through `html`.
  4. Styles go in `src/styles/components/<name>.css`, using engine tokens only (the build fails on an undefined one).
  5. Any client-side path goes in `public/js/core/routes.js`, pinned by `test/core/routes.test.js`.
  6. `npm run build` writes `public/<name>.html` from the template with its `{{asset:…}}` placeholders resolved, and emits the page's rewrite into `vercel.json`. Both are generated and gitignored: commit the template, never the built page.
- **Copy from:** `public/js/pages/account.js` (a fetch, 404 and load error), `public/js/pages/static.js` (copy only).
- **Review checks:** no inline styles or scripts (the CSP forbids them); axe-clean in light and dark at 390px and 1280px (add the page to `e2e/smoke.spec.js`); no horizontal scroll; `#app[data-ready]` is set on every outcome.

### Component

- **When:** markup used by more than one page or kind.
- **Command:** `npm run new component <name>` → `public/js/components/<name>.js` and `test/components/<name>.test.js`.
- **Then:**
  1. `render(props)` returns `SafeHtml`.
  2. Add `bind(el)` only for behaviour. A person's colour goes out as `data-c` and `bind` calls `applyColours` (`public/js/core/dom.js`), which also sets an AA-safe text shade.
  3. The component holds no copy: callers pass text already resolved through `t()`.
  4. Styles go in `src/styles/components/<name>.css` (`c-<name>` block).
- **Copy from:** `public/js/components/emptyState.js` (render only), `public/js/components/chips.js` (with `bind`).
- **Review checks:** escaping, since plain template literals containing `<` are a lint error here; every interpolation is in `html`; no `style=` attributes; keyboard and label accessibility.

### Migration (engine or site)

- **When:** any schema or lookup-data change. Never edit an applied migration.
- **Command:** `npm run new migration <name>` → `src/db/migrations/<NNN>_<name>.sql` (the engine, for every site). For one site's own change, `npm run new -- migration <name> --site` → `site/migrations/<NNN>_<name>.sql`. That folder is numbered separately, so the two never collide.
- **Then:**
  1. Replace the template's placeholder `select 1;` before the file runs anywhere. Once applied it is checksummed, and an edit fails every later migrate ([ADR 0004](docs/decisions/0004-migrations-checksummed-expand-contract.md)).
  2. Follow [ADR 0006](docs/decisions/0006-data-model-conventions.md):
     - Entity tables get the common columns, soft delete and `meta jsonb`.
     - A growing value set is a text-coded lookup row (an `insert`), not a check or an `alter`.
     - Attach `set_common` and `write_audit` triggers to audited tables.
     - Add indexes for what you filter or search.
  3. Expand/contract: never drop or rename in the release that adds the replacement.
  4. `npm run migrate` applies it locally (`PGLITE_DIR=.devdb` for a dev database); deploys run it before going live. An engine migration needs a `CHANGELOG.md` note.
- **Copy from:** `src/db/migrations/001_initial.sql`.
- **Review checks:** runs on a fresh database and on one that already has data; no `begin`/`commit` (the runner wraps each file in a transaction); `test/db/constants.test.js` still passes (it pins checks and lookups to `src/domain/constants.js`).

### Kind (a new item kind)

- **When:** a new type of archived thing (a subtitle file, a YouTube clip note, a fan comic). Kinds are plugins: adding one touches only its own folders and its migration.
- **Command:** `npm run new kind <name>`. It writes:
  - `src/kinds/<name>/`: `index.js` (`defineKind`), `domain.js` (pure), `repo.js`, `presenter.js`, `search.js` and `copy.json`
  - `public/js/kinds/<name>/`: `section.js` and `detail.js`
  - the kind's migration (`insert into item_kinds`, a `<name>_items` table with a composite foreign key to `items (id, kind)` and a trigram index, plus the audit triggers)
  - `test/kinds/<name>/`

  The template is a working one-text-field kind.
- **Then:**
  1. `domain.js`: set `PLATFORM`, then read your source's response in `postOf` and build the `Draft` in `draft<Name>`. Generic code reads only `draft.common` and `draft.missing`.
  2. `index.js`: set `POST_URL` (the pasted URL → its id) and `apiUrlOf`. `fetchSource` returns `{ status: 'deleted' | 'unavailable' }` or the live post.
  3. Add any columns to the migration before it is applied anywhere. After that, use a new migration.
  4. `presenter.js` returns the contract shapes (`KindPreview`, `DetailVM`, `BubbleVM` in `src/http/contracts.js`). Speech, joint and crowd bubbles are built in `src/kinds/translation/presenter.js`.
  5. Optional hooks (documented in `src/kinds/defineKind.js`; commented in the template):
     - `followUpOf` with `appendFollowUp`
     - `refresh` and `checkFollowUps`
     - `profileUrl(handle)`, the translator page's "open profile" link. Left out, the page shows none.
  6. `npm run build` regenerates both kinds registries and adds the kind's item-page rewrite (`<urlPrefix>(.*)` to `/api`). `npm run setup` (or `npm run migrate`; locally with `PGLITE_DIR=.devdb`) applies the migration, and setup checks that the registry matches the `item_kinds` rows.
- **Copy from:** `src/kinds/translation/` (the full example).
- **Review checks:**
  - The diff touches only `src/kinds/<name>/`, `public/js/kinds/<name>/`, `test/kinds/<name>/` and its migration. The build output it changes (`vercel.json`'s new rewrite, `public/*.html`'s bundle hashes) is gitignored. `test/kinds/scaffoldedKind.test.js` proves this is possible.
  - `domain.js` is pure (lint enforces this), and the kind's SQL fragments interpolate only their placeholder.
  - Its `urlPrefix` isn't reserved. `defineKind` derives the reserved list from `src/pages.js`.
  - Any new media host needs a CSP change (`img-src`/`media-src` in `scripts/buildOutputs.js`), which is a core change reviewed on its own.

### Source (another way to fetch tweets)

- **When:** a new provider for the translation kind's tweet data, e.g. when one of the two unofficial sources breaks ([ADR 0003](docs/decisions/0003-two-tweet-sources.md)). A different platform's posts belong to a kind's `fetchSource` instead.
- **Steps (no scaffold):**
  1. Add `src/sources/<name>.js` exporting `{ name, fetch(deps, id) }` that resolves to the raw post or `null`, using only `deps.fetchImpl`.
  2. Register it in `SOURCES` (`src/sources/index.js`) and teach `src/sources/normalize.js` its shape.
  3. Add synthetic fixtures under `test/fixtures/tweets/`, never real tweets.
- **Copy from:** `src/sources/fx.js`, and its tests in `test/sources/fetchTweet.test.js`.
- **Review checks:** it fails soft (a broken source never fails intake while another answers); no API keys or paid endpoints; no network in tests (`offlineFetch`).

### Live pattern

- **When:** headers start naming a livestream platform the engine doesn't recognise.
- **Steps:**
  - **For every site:** add a row to `LIVE_PATTERNS` in `src/domain/constants.js`, with a header test in `test/domain/header.test.js`.
  - **For one site:** add a row to its `site.json` `extraLivePatterns`, with no code change (`docs/site-settings.md`).
  - **If the platform is new:** also add its `platforms` row in a migration (see below).
- **Copy from:** the existing `LIVE_PATTERNS` rows.
- **Review checks:** the pattern is case-insensitive and anchored on the platform word, so it doesn't swallow ordinary words.

### Site setting

- **When:** something a fandom must be able to choose. Anything else stays an engine constant.
- **Steps:**
  1. Validate it in `src/site/fieldValidators.js` and wire it in `src/site/schema.js`. **It must have a default**, so an existing `site.json` keeps working.
  2. Document it in `docs/site-settings.md` and add a test in `test/site/schema.test.js`.
  3. Server code reads `deps.site`. Browser code reads `site` from `public/js/core/site.js`, which the build generates.
  4. Note it under the release's upgrade steps in `CHANGELOG.md`.
- **Copy from:** `region` (an enum with a default) or `lowercaseNames` (a boolean).
- **Review checks:**
  - The error names the exact field path.
  - The default keeps the example site valid.
  - `npm run doctor` still reports ✓.
  - No fandom value is used as the default.

### Category, client or platform (data, not code)

- **Categories:**
  - Change them in a site's `site.json` `categories`; `npm run setup` seeds them and is safe to rerun.
  - A soft-deleted category is restored, not duplicated (`ensureCategory` in `src/repo/lookups.js`).
- **Clients** (the media or organiser behind an event): created on first use at intake (the add flow's `clientName`), with no setup step.
- **Platforms:**
  - They are lookup rows: `insert into platforms values ('<code>');` in a migration. Use the engine migration for every site, or a site migration (`npm run new -- migration add_<code> --site`) for one.
  - Engine-wide, also add the code to `ALLOWED_PLATFORMS` in `src/site/fieldValidators.js`, so `otherAccounts` can use it.
- **Review checks:** no `alter table` for a new value; no fandom-specific value in an engine migration.

### Worked example: add Weverse live

Weverse is already a `platforms` row (`001_initial.sql`), so only the pattern is new.

- **Every site (engine):** add this row to `LIVE_PATTERNS` in `src/domain/constants.js`:

  ```js
  { code: 'weverse live', platformCode: 'weverse', pattern: /weverse\s*live/i },
  ```

  Then add a header test for a line such as `[251019] weverse live 🌙` in `test/domain/header.test.js`, and run `npm test`.
- **One site only:** in its `site/site.json`, with no engine change:

  ```json
  "extraLivePatterns": [{ "code": "weverse live", "platformCode": "weverse", "pattern": "weverse\\s*live" }]
  ```

  Then run `npm run build`, and `npm run setup` with that site's `DATABASE_URL` (or `PGLITE_DIR=.devdb` for a local dev database; setup refuses to run with neither).
- **A platform the engine doesn't know yet** (say `bilibili`): first add `insert into platforms values ('bilibili');` in a migration, at engine or site level as above, then add the pattern.

### Worked example: add a youtube kind

```sh
npm run new kind youtube_clip     # urlPrefix /youtube-clip/, table youtube_clip_items, migration NNN_youtube_clip.sql
npm run build && npm run check && npm test
```

1. **Domain** (`src/kinds/youtube_clip/domain.js`):
   - Set `PLATFORM = 'youtube'` (already a `platforms` row).
   - YouTube's oEmbed response (`https://www.youtube.com/oembed?url=<video url>&format=json`) carries `title`, `author_name` and `author_url` (`https://www.youtube.com/@<handle>`). Make `postOf` read the handle from `author_url` and use the title as `text`. The translation itself is the submitter's typed `overrides.text`.
   - oEmbed has no post date, so the item needs `overrides.occurredOn`; without it, ingest answers `needs_date`.
2. **Source** (`index.js`):
   - `POST_URL` matches `https://www.youtube.com/watch?v=<id>` and `https://youtu.be/<id>`.
   - `apiUrlOf` builds the oEmbed URL.
   - Add the profile link:

     ```js
     profileUrl: (handle) => `https://www.youtube.com/@${encodeURIComponent(handle)}`,
     ```
3. **Section** (`public/js/kinds/youtube_clip/section.js`): the template's `previewCard` stack works as is. Change it only if clips need a different card.
4. **The core is untouched:**
   - `git status` shows only the three `youtube_clip` folders and the migration. The rebuilt `vercel.json` (one new rewrite) and `public/*.html` (new bundle hashes) are gitignored.
   - `npm run setup` applies the migration.
   - The kind's items appear in event sections, in search (`?kinds=youtube_clip`) and on person pages without any change to services, routes or pages.
   - Embedding the video itself would mean a new `frame-src` in the CSP (`scripts/buildOutputs.js`), which is a separate, reviewed core change.

## Testing conventions

- Tests run with `node --test`, no test framework.
- Test files mirror the `src/` layout under `test/`.
- Use synthetic fixtures (`test/fixtures/`), never real translation text.
- Pure `src/domain` code is unit-tested directly, with no mocking.
- Code that needs the database, the clock, or the network takes them through `deps`, so tests can supply fakes.
- `freshDb()` (`test/helpers/db.js`) gives each test its own schema on one in-memory PGlite per test file. `npm test` takes as long as its slowest file: time one with `time node --test <file>`, and split a file by topic (as `test/services/ingest/`) once it runs over about 40 s in the full suite.
- Tests never write into a source tree (`src/`, `public/`, `api/`, `scripts/`, `test/`, `e2e/`, `examples/`, `docs/`, a site repo's `site/`, and the root `vercel.json`): `npm test` hashes them before and after the run and fails if any changed (`scripts/treeHashConfig.js`). Scaffold or build into a temp copy instead, as `test/kinds/scaffoldedKind.test.js` (also `npm run test:kind`) and `test/scripts/new.test.js` do.

## Browser checks

- `npm run e2e` is the engine's smoke (`e2e/smoke.spec.js`). It always runs the bundled example (`SITE_DIR=examples/solluna`, its own fresh `.e2e-db`), whatever `site/` holds, so it passes the same in the engine and in any site repo, then rebuilds the repo's own `site/` when there is one.
- `npm run e2e:site` runs the same per-page checks on the repo's **own** `site/` (`e2e/site.spec.js`, `playwright.site.config.js`): it builds it, seeds `site/seed/` into a fresh `.e2e-site-db`, and finds every URL through the site's API (home, the first event and its first item, every listed person, the first translator, a search, about, privacy, takedown, a 404). Without a `site/` it skips with a message.
- Both share their checks through `e2e/helpers.js` (200, no console or CSP errors, no horizontal scroll, axe finds nothing serious or critical) and run four projects: phone and desktop, light and dark. Each builds into this checkout, so each takes `.e2e-build.lock` first: a second run while one is going stops with a clear message (`scripts/e2eLock.js`).

## Engine vs. site

Everything outside `site/` and `examples/` is the engine: fandom-neutral, reusable by any archive built from this template. A site repo also keeps its own planning docs in `.superpowers/` and `docs/superpowers/`; the engine's checks skip those, along with `site/` (`test/helpers/siteRepo.js`). `site/` is gitignored here and holds one real archive's configuration (`site.json`, `theme.css`, `copy.json`, `logo.png`, optional `seed/` and `migrations/`). `examples/solluna/` is the template's fictional example, copied into `site/` by `npm run init-site`. See `docs/architecture.md` for the full layer rules, and `docs/start-your-own.md` to run your own archive.

## Releases

- The engine is versioned with semver tags (`vX.Y.Z`).
- Each release lists its upgrade steps under its own heading in `CHANGELOG.md`.
- A site pulls a tagged release through its `upstream` remote (`git fetch upstream --tags && git merge vX.Y.Z`), follows that release's upgrade steps and runs `npm run doctor`.
