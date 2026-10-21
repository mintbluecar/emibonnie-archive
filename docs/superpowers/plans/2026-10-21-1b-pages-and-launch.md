# Plan 1b: Pages and Launch

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 1b adds four things on top of the Plan 1a engine:
- **Public reading pages** in the approved design: home, event, translation, search, person, translator, about, privacy, takedown.
- **The contributor framework:** scaffolder, recipes, and the start-your-own guide.
- **emibonnie's site**, built on the engine.
- **A launch** of emibonnie in Singapore, with migrations running automatically on deploy.

**Prerequisite:** Plan 1a is complete, and its Tasks 1–12 pass CI.

**Architecture:**
- Plain ES modules, bundled by esbuild at build time into a few hashed files cached `immutable`.
- Pages render **server-resolved view models**. Each page module fetches, composes components, and binds. Components are pure `render(props) → string` functions built with an **auto-escaping `html` tagged template**.
- Item kinds supply their own front-end folder: `public/js/kinds/<kind>/{section,detail}.js`, collected in a registry the build generates.
- Fonts are self-hosted.

**Spec:** `docs/superpowers/specs/2026-10-21-translation-archive-design.md`. **Mockups:** `docs/superpowers/specs/mockups/`. Both live in `emibonnie-archive`. Plan 1a's Global Constraints and Architecture rules all apply here too. Read `fan-archive/docs/architecture.md`.

## Additional constraints

- **Escaping:** HTML is produced only by `html\`…\`` (auto-escapes every interpolation) and `raw()` (only for output from another component). ESLint forbids plain template literals that contain `<` in `public/js/components/` and `public/js/kinds/`.
- **CSP compatibility:** no inline scripts, no inline `style` attributes. Per-person colour is set through `el.style.setProperty('--c', …)` in `bind()`.
- **Accessibility:**
  - Every emoji speaker has a visible name or an `aria-label`.
  - Translation text carries `lang="<site.sourceLanguage>"` on Thai-script spans, as detected by `\p{Script=Thai}`.
  - The filter sheet traps focus, and Escape closes it.
  - All motion respects `prefers-reduced-motion`.
  - Tap targets are at least 44px.
- **Layout breakpoint:** 860px. The phone layout is the default; the web layout applies at `min-width: 860px`.
- **Copy:** every visible string comes from `t('ns.key')`. Engine strings live in `src/site/copyDefaults.json`, kind strings in `src/kinds/<k>/copy.json`.

## Review Focus

1. **Highlighting search matches on text that contains HTML entities.** `q = 'amp'` must not match inside an escaped `&amp;`. Split the raw text first, then escape each part. Tested in Task 2.
2. **A deleted tweet or blocked video.** The player swaps to the "no longer available" note. It never shows an error box or a broken frame. Tested in Task 4.
3. **The CSP in production** blocks nothing the pages need: video from `video.twimg.com`, fonts, `/build/*`. Checked with Playwright console errors in Task 7.
4. **Phone width 390px:** no horizontal scroll on any page, and the video stays pinned while a long translation scrolls. Checked by Playwright in Task 7.
5. **The scaffolded new kind** appears on the event page, in search, and on the person page without touching core files. Tested in Task 8.

---

### Task 1: Front-end core, bundling, tokens, fonts

**Files:**
- Create: `public/js/core/{html,api,dom,format,site}.js`, `src/styles/{tokens,base,layout}.css`, `test/core/*.test.js`
- Modify: `scripts/build.js` (bundling, fonts)

**Interfaces:**
- Produces:
  - `html(strings, ...values) → SafeHtml`. It escapes `& < > " '` in every value that isn't `SafeHtml`. Arrays are joined. `null` and `false` render as nothing.
  - `raw(s) → SafeHtml`, and `String(SafeHtml)` returns the markup.
  - `getJson(path, params?)` throws `ApiError{status}` on a non-OK response.
  - `mount(el, safeHtml)` and `on(el, selector, event, fn)` (delegated).
  - `format.js`:
    - `monthLabel('2026-10') → 'october 2026'`, `dayLabel('2026-10-14') → '14 Oct 2026'`.
    - `timePair(iso, siteTz, viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone) → '4:00 pm paris · 10:00 pm bangkok'`. When both zones are the same it returns a single value.
    - `cityOf(tz)` takes the last segment of the zone name, lowercased, with `_` replaced by a space.
  - `site.js` exports `site` and `t(key, vars?)` from `/site/site.js`. A missing key returns the key itself and logs a console warning. The build already fails on missing keys.
  - **Build (esbuild):**
    - One entry per page: `public/js/pages/<page>.js` bundles to `public/build/<page>-<hash>.js` and `public/build/app-<hash>.css` (`tokens`, `base`, `layout`, components, site `theme.css`).
    - The build writes `public/build/manifest.json`.
    - Page HTML references assets via placeholders that the build rewrites.
    - `vercel.json` sets `Cache-Control: public, max-age=31536000, immutable` on `/build/*`.
  - **Fonts:**
    - Use `@fontsource/nunito` and `@fontsource/ibm-plex-sans-thai` as dev dependencies. Copy only the woff2 files for the weights in use (400/600/700/800) into `public/build/fonts/`, plus `font-display: swap` rules.
    - The font stack comes from tokens (`--font-latin`, `--font-script`), so other sites can switch fonts.
- [ ] **Step 1: Write the failing tests.**

```js
test('html escapes values, not raw()', () => {
  const name = '<b>&</b>';
  assert.equal(String(html`<p>${name}${raw('<i>x</i>')}</p>`), '<p>&lt;b&gt;&amp;&lt;/b&gt;<i>x</i></p>');
});
test('timePair', () => {
  assert.equal(timePair('2026-02-12T15:00:00Z', 'Asia/Bangkok', 'Europe/Paris'), '4:00 pm paris · 10:00 pm bangkok');
  assert.equal(timePair('2026-02-12T15:00:00Z', 'Asia/Bangkok', 'Asia/Bangkok'), '10:00 pm bangkok');
});
test('labels', () => { assert.equal(monthLabel('2026-10'), 'october 2026'); assert.equal(dayLabel('2026-10-14'), '14 Oct 2026'); });
```

  Plus a build test: after `npm run build`, `manifest.json` lists a hashed JS file for each page, and no page HTML file still contains a placeholder.
- [ ] **Step 2: Run the tests. Expected: FAIL.** Implement. **Run the tests. Expected: PASS.** Commit: `"Front-end core: auto-escaping html, format, bundling, tokens, self-hosted fonts"`

---

### Task 2: Components and kind sections

**Files:**
- Create: `public/js/components/{header,footer,tabBar,bubbles,cast,eventCard,previewCard,resultCard,chips,personHeader,emptyState}.js`
- Create: `public/js/kinds/translation/{section,detail}.js`, `public/js/kinds/_registry.js` (generated), `src/styles/components/*.css`, `test/components/*.test.js`
- Modify: `scripts/build.js` (generate the front-end kind registry), ESLint (template-literal rule)

**Interfaces:**
- Produces:
  - Every component exports `render(props) → SafeHtml`. A component may also export `bind(el, props)`. Components never fetch and never contain literal UI text.
    - `header.render({ compact })`: logo, wordmark (the accent part in the brand gradient), tagline, **FAN-MADE** badge, then a search box and filter-icon button. The icon is an SVG of three lines (16/10/4) with `aria-label`.
    - `footer.render()`: links to `t('footer.about')`, `t('footer.privacy')` and `t('footer.takedown')`, plus `t('footer.unofficial')`.
    - `tabBar.render({ active })`: home · search · ＋ add · me. On wide screens it renders as a top bar instead.
    - `bubbles.render({ bubbles: BubbleVM[] })`. It renders view models only and never resolves people. Each part:
      - speech: `.msg`, or `.msg.cont` when it continues the previous bubble
      - crowd: `.crowd`
      - plain: `.plain`
      - notes: collected into `.notes`
      - the colour goes in a `data-c` attribute, which `bind()` applies as `--c`
      - Thai spans get `lang`
    - `cast`, `eventCard`, `previewCard`, `chips`, `personHeader` (colour via `data-c` and `bind`), `emptyState`.
    - `resultCard.render({ result, q })`. Split the **raw** match line on the case-insensitive `q` (regex-escaped), escape each part, and wrap the matches in `<mark>`.
  - `public/js/kinds/_registry.js` is generated: `export const KIND_UI = { translation: { section, detail } }`.
  - `renderSections(sections, ctx)` skips unknown kinds.
- [ ] **Step 1: Write the failing tests.**
  - **bubbles:**
    - A BubbleVM list with a `<script>` text renders it escaped.
    - A continuation bubble has no avatar or name.
    - The crowd note renders.
    - Notes collect at the end.
    - A Thai span gets `lang="th"`.
  - **resultCard:** `q:'amp'` against the text `'a & amp'` gives exactly one `<mark>amp</mark>` and an escaped `&amp;` with no mark inside it.
  - **header:** renders the accent from the site plus FAN-MADE.
  - **footer:** has all three links.
  - **renderSections:** an unknown kind is skipped.
  - **Copy purity:** scan the component sources for any `copyDefaults` value of 4+ characters that appears inside a **text node** of a template. Class names and attributes are excluded.
  - **ESLint:** a component written with a raw `` `<p>${x}</p>` `` fails lint (fixture file).
- [ ] **Step 2: Run the tests. Expected: FAIL.** Implement, matching `mockups/screens-v2.html`, `speaker-style-v2.html` and `search-v2.html`. **Run the tests. Expected: PASS.** Commit: `"Components with auto-escaping, a11y, CSP-safe colours; kind section registry"`

---

### Task 3: Home and event pages

**Files:**
- Create: `public/{index,event}.html`, `public/js/pages/{home,event}.js`, `src/pages.js` (page routes for the build: `{ path:'/e/:slug', file:'event.html', meta:'/meta/e/:slug' }`, …), `test/pages/*.test.js`

**Interfaces:**
- Produces:
  - Each page module exports `start()`: read the URL, call `getJson`, `mount` the composed components, and `bind`. Page modules never contain markup.
  - The build turns `src/pages.js` into the `vercel.json` rewrites, so routes have one source of truth.
  - **Home:**
    - header, then month groups (`monthLabel`), then event cards, then the footer
    - the search box goes to `/search`
    - the filter icon goes to `/search?filters=1`
  - **Event:**
    - back link, name, meta line (`dayLabel · N translations · M translators`, built from counts and copy), pills
    - people chips plus an account filter, both client-side
    - a search icon linking to `/search?event=<slug>`
    - `renderSections`
    - a "newest first" toggle
    - Report goes to `/soon` until Plan 2
    - a 404 shows `emptyState`
- [ ] **Step 1: Write the failing tests.** These are DOM-free tests of the compose functions: `composeHome(data) → SafeHtml` and `composeEvent(data) → SafeHtml`, exported for testing. They run on `api` JSON snapshots generated from the 1a route tests (`test/snapshots/*.json`).
  - The home page shows `october 2026` when it has an event from that month.
  - The event page shows the translation section and the right counts.
- [ ] **Step 2: Run the tests. Expected: FAIL.** Implement. **Run the tests. Expected: PASS.**
- [ ] **Step 3: Check in a browser.** Run `npm run seed-dev && npm run dev`. Check at 390px and 1280px using the `run`/`browse` skill, with screenshots in the task report next to `mockups/screens-v2.html`.
- [ ] **Step 4: Commit:** `"Home and event pages; page routes as single source"`

---

### Task 4: Translation page and video player

**Files:**
- Create: `public/item.html`, `public/js/pages/item.js`, `public/js/components/videoPlayer.js`, `test/components/videoPlayer.test.js`

**Interfaces:**
- Produces:
  - `videoPlayer.pickVariant(variants, isSmall)`: the smallest variant when `isSmall`. Otherwise the largest at or below 2,200,000 bps, or the smallest if none qualifies.
  - `videoPlayer.render({ variants, width, height })`: `<video controls playsinline preload="metadata" referrerpolicy="no-referrer">` inside a `.vid` box.
    - **Vertical clips (owner's decision, option A):** on phones the `.vid` box is capped at `max-height: 40svh`. The video uses `object-fit: contain` (letterboxed on a dark background), and the box gets `aspect-ratio` from `width/height`, set in `bind()` via `style.setProperty` for CSP. A **⤢ full screen** button calls `video.requestFullscreen()`, falling back to `webkitEnterFullscreen()` on iOS.
    - On web, the video fits its column, with `max-height: calc(100svh - header)`.
  - `videoPlayer.bind(el, { kind, sourceId, initial })`:
    - Start from the stored variants in the item response.
    - On an `error` event, refetch `/api/video/:kind/:sourceId` once.
    - If that refetch returns 404 or errors, swap in `t('item.sourceGone')`.
  - If Plan 1a Task 2 recorded that **hotlinking fails**, the player uses X's official embed instead (`platform.twitter.com`, added to the CSP), and the video isn't sticky on phones.
  - **The item page:**
    - **Phone:** a sticky `.vid` at the top.
    - **Web (≥ 860px):** two columns. Left: the sticky video plus prev/next. Right:
      - credits: `tl @handle · clip by @source`, then `timePair(postedAt)` and `dayLabel(occurredOn)`
      - pills, then cast, then bubbles
    - **Footer:** original tweet, original media, follows on, added by, Copy link, Report.
    - **"Show original":** a `<details>` element with the escaped verbatim text.
- [ ] **Step 1: Write the failing tests:**
  - **pickVariant:** a small screen gets 632k; a large one gets 2176k.
  - **render:** a 720×1280 clip renders a full-screen button and a `data-aspect="0.5625"` attribute.
  - **bind:** a fake `fetch` returns 404 after a simulated `error` event, and the element ends up containing the `sourceGone` copy.
- [ ] **Step 2: FAIL** → implement → **PASS.** Browser check: the video stays pinned while the `LONG` text scrolls, at 390px and 1280px. Commit: `"Translation page with stored-variant video player"`

---

### Task 5: Search page

**Files:**
- Create: `public/search.html`, `public/js/state/searchState.js`, `public/js/components/filterSheet.js`, `public/js/pages/search.js`, `test/state/searchState.test.js`, `test/components/filterSheet.test.js`

**Interfaces:**
- Produces:
  - `searchState`: `parseState(URLSearchParams)`, `toQuery(state)`, `filterCount(state)` (doesn't count `q`), `withFilter`, `withoutFilter`. All are immutable.
    - `State = { q, people:number[], peopleMode:'any'|'all', types:string[] /* category names and 'shared story' */, event, account, client, from, to }`.
    - The names map 1:1 onto `/api/search` params: `toApiParams(state)` turns `'shared story'` into `placements=shared_story`, and `event` into `eventSlug`, and so on.
    - **The URL is the single source of truth.** Scoped search is simply a link.
  - `filterSheet.render({ state, options, count })` and `bind(el, { state, onChange })`.
    - Options come from `/api/filters`.
    - The sheet contains: who's in it (with any-of / all-of), type chips, and selects for event, translator, client and date.
    - The apply button shows `t('search.showN', {n})`.
    - **Accessibility:** focus is trapped while it's open, Escape closes it, and focus returns to the filter icon.
  - **The page:**
    - the search box is autofocused, with the filter icon and its badge beside it
    - removable chips for active filters, plus "clear all"
    - **empty state:** recent searches (`localStorage` behind try/catch, last 8) and quick chips
    - typing is debounced by 250 ms and enforces a minimum of 2 characters
    - each change updates the URL with `history.replaceState`, then refetches; the count uses `limit=0`
    - **result cards** show the page from `/api/search`
- [ ] **Step 1: Write the failing tests:**
  - **searchState:**
    - A round trip through the URL returns the same state.
    - Empty values are left out.
    - `filterCount({people:[2],types:['live']})` is 2.
    - `toApiParams` maps `'shared story'` to `placements`.
  - **filterSheet:**
    - It renders the count copy.
    - Selected chips are marked `.on`.
    - Escape closes it, tested with a minimal DOM shim, or covered in Task 7 instead.
- [ ] **Step 2: FAIL** → implement → **PASS.** Browser check:
  - `/search?q=ครบ` finds `LONG`.
  - Picking luna and live shows a `2` badge.
  - Removing a chip updates the URL and the results.

  Commit: `"Search page with filter sheet and scoped search"`

---

### Task 6: Person, translator, about, privacy, takedown, 404

**Files:**
- Create: `public/{person,account,about,privacy,takedown,404}.html`, `public/js/pages/{person,account,static}.js`, copy keys for the static pages

**Interfaces:**
- Produces:
  - **Person page:**
    - a `personHeader` in the person's colour, then groups rendered through `renderSections`
    - a segmented control with three options: by event, all newest, and "with…"
      - "with…" opens a people picker, then goes to `/search?people=<a>,<b>&peopleMode=all`
    - a search icon going to `/search?people=<id>`
  - **Translator page:**
    - handle, "open profile ↗", totals, and groups
    - if the translator has opted out: only `t('account.optedOut')`
    - if the response includes `redirectTo`: `location.replace` to the current handle
  - **Static pages:**
    - `about`, `privacy` and `takedown` render copy keys (`about.*`, `privacy.*`, `takedown.*`) through `static.js`.
    - The engine ships neutral English defaults covering everything in the spec's "Trust, safety and privacy" list. A site overrides them in `site/copy.json`.
    - The contact link is `site.contactUrl`.
  - `404.html` is used by Vercel for unknown paths.
- [ ] **Step 1: Compose tests** on snapshots:
  - Person groups include a shared-story group label.
  - An opted-out translator shows the opted-out copy and nothing else.
  - The privacy page contains every required section key (one test lists them).
- [ ] **Step 2: Implement. Then check in the browser and with the tests:**
  - `/p/lunamoon` lists LONG, LIVE and SHARED.
  - `/tl/tl_alpha` lists 3.
  - After opting out `tl_gamma` in `.devdb`, `/tl/tl_gamma` shows only the opted-out line, and the HAPPY DAY event counts 1.

  Commit: `"Person, translator, about, privacy, takedown, 404 pages"`

---

### Task 7: Browser smoke tests and accessibility

**Files:**
- Create: `test/e2e/smoke.spec.js`, `playwright.config.js`
- Modify: `package.json` (`"e2e"` script; dev deps `@playwright/test`, `@axe-core/playwright`), `.github/workflows/ci.yml` (e2e job)

- [ ] **Step 1: Write the smoke spec.**
  - It starts `npm run seed-dev && npm run dev`.
  - It covers home, event, item (LONG), search (`q=ครบ`), person, account, about and privacy, each at **390×844** and **1280×800**. On every page it asserts:
    - The response is 200.
    - No console errors appear, **including CSP violations**.
    - There's no horizontal scroll (`scrollWidth <= innerWidth`).
    - axe finds no `serious` or `critical` violations.
  - **Extra checks on the item page:**
    - The `.vid` stays at `top: 0` after scrolling 2,000px.
    - For the **vertical** `LIVE` clip at 390×844, the `.vid` box is at most 40% of the viewport height (≤ 338px), and the first bubble is visible without scrolling.
    - The `LONG` 🐱 line shows `🌙 luna`.
  - **Extra check on search:** opening the filter sheet and pressing Escape returns focus to the filter icon.
- [ ] **Step 2: Run `npm run e2e`. Expected: PASS.** Fix any issues inside the task that owns the code (the fixes are part of this task). Add an `e2e` job to CI using the same SHA-pinned actions. Commit: `"Playwright smoke and axe checks at phone and desktop widths"`

---

### Task 8: Contributor framework: scaffolder, kind proof, recipes, start-your-own, release

**Files:**
- Create: `scripts/new.js`, `scripts/templates/{route,page,component,migration,kind}/…`, `test/scripts/new.test.js`, `test/kinds/scaffoldedKind.test.js`, `docs/start-your-own.md`, `docs/deploy-workflow.example.yml`, `docs/limits.md`
- Modify: `CONTRIBUTING.md` (fill in the recipes), `docs/architecture.md`, `CHANGELOG.md`, `package.json` (`"new"`)

**Interfaces:**
- Produces: `scaffold({ kind, name, root='.' }) → string[]` and the CLI `npm run new <kind> <name>`.

  | Scaffold | Creates |
  |---|---|
  | `route` | `src/routes/<name>.js`, registered in `src/routes/index.js` (a marked insertion point), plus a test |
  | `page` | `public/<name>.html`, `public/js/pages/<name>.js`, and an entry in `src/pages.js` |
  | `component` | the component and its test |
  | `migration` | `src/db/migrations/<next NNN>_<name>.sql`, or `--site` for `site/migrations/` |
  | `kind <name>` | `src/kinds/<name>/{index,domain,repo,presenter,search,copy.json}`, `public/js/kinds/<name>/{section,detail}.js`, a migration (`insert into item_kinds values ('<name>')` plus a `<name>_items` table with `item_id bigint primary key`, a kind column, and the composite FK), and tests |

  - Table names use the `<name>_items` pattern, so no pluralisation is needed. Names must match `^[a-z][a-z0-9_]*$`.
  - The scaffolder refuses to overwrite and exits 1.
  - **Templates** are the smallest examples that pass and follow every rule: `// @ts-check`, `html` tagged templates, `t()`, `deps` first, and green tests.
- [ ] **Step 1: Write the failing tests:**
  - **Scaffolds:** `component badge` creates 2 files. `migration add_x` creates `002_add_x.sql`. Running the same name twice throws. `Bad-Name` throws.
  - **`scaffoldedKind.test.js`:** this is the **proof that kinds are plugins**. In a temp copy of the repo:
    1. Run `npm run new kind zzcheck`.
    2. Fill in the template's minimal domain: one text field.
    3. Run build, migrate and setup.
    4. Insert one `zzcheck` item with a person and an event.
    5. Assert it appears in `GET /api/event/:slug` sections, in `/api/search?q=<its text>&kinds=zzcheck`, and in `/api/person/:ig`.
    6. Assert `git diff --stat` touches **only** the new kind folders and its migration.
- [ ] **Step 2: FAIL** → implement → **PASS.** Then, in the real repo, scaffold one of each type, run `npm run check && npm test && npm run e2e`, delete the generated files, and confirm `git status` is clean.
- [ ] **Step 3: Fill in the `CONTRIBUTING.md` recipes.** Write one recipe per extension point: route, page, component, migration (engine or site), kind, source, live pattern, site setting, category/client/platform as data. Each covers:
  - when to use it
  - the command to run
  - the steps after scaffolding
  - a real file to copy from
  - what review will check

  Include two worked examples:
  - "Add weverse live": a `LIVE_PATTERNS` row, or a site's `extraLivePatterns` row, plus a `platforms` row if it's new.
  - "Add a youtube kind": the commands, the domain, the section, and that the core is untouched.
- [ ] **Step 4: `docs/start-your-own.md`.** The steps, in order:
  1. Use the template.
  2. Run `npm run init-site` and edit `site/`. Remove `site/` from `.gitignore` in your copy.
  3. Choose a region near your fans.
  4. **Accounts:**
     - Use a dedicated email for the archive, and sign up with it, not with "Continue with GitHub".
     - Never add a card to GitHub or X.
     - Turn on 2FA everywhere.
  5. Create the Neon project: region matching yours, autoscale max 0.25 CU, and a `preview` branch.
  6. **Deploy:** the **Git-integration path** if your repo is on a personal account, or the **Actions + token path** for org repos (`docs/deploy-workflow.example.yml`).
  7. Set the secrets.
  8. Run `npm run setup` and `npm run doctor`.
  9. Before going public, check the privacy, about and takedown copy and your contact link.
  10. Pull updates: `git remote add upstream git@github.com:mintbluecar/fan-archive.git`, `git fetch upstream --tags`, `git merge vX.Y.Z`, then follow that release's upgrade steps.

  Also include troubleshooting for `setup` and `doctor` errors, and link `docs/limits.md`: a table of what happens at each free-tier limit and how to spot it early (taken from the spec's Technical setup section, including Vercel's 30-day pause).
- [ ] **Step 5: `docs/deploy-workflow.example.yml`:**
  - Triggers on push to `main` and on PRs, with `permissions: contents: read`, SHA-pinned actions, and `concurrency` set so runs don't overlap.
  - Steps:
    1. `npm ci`, `npm run build`, `npm run check`, `npm test`
    2. **`npm run migrate`** against `DATABASE_URL` (production), or against `DATABASE_URL_PREVIEW` for PRs
    3. `vercel pull`, `vercel build`, `vercel deploy --prebuilt` (with `--prod` on main), all using `--token`
  - The preview job never receives the production `DATABASE_URL`.
- [ ] **Step 6: Release.** Write the `CHANGELOG.md` entry for `0.1.0`, with an "Upgrade steps: none (first release)" note. Create the local tag `v0.1.0`. **Don't push; ask the owner first.** Run `npm run check && npm test && npm run e2e`. Commit: `"Contributor framework: scaffolder with kind proof, recipes, start-your-own, deploy example, v0.1.0"`

---

### Task 9: The emibonnie site

**Work in `emibonnie-archive/`.**

**Owner input needed.** Ask before starting, and use the answers:
1. **emibonnie's public contact URL** (`contactUrl`). Suggest the fan X account's profile, or a Google Form owned by the fan account. Never an email address.
2. **Who made the emibonnie logo**, so the about page credits it correctly.

- [ ] **Step 1: Bring in the engine.**
  - `git remote add upstream ../fan-archive` (it becomes the GitHub URL in Task 10), then `git fetch upstream --tags && git merge v0.1.0 --allow-unrelated-histories`.
  - Keep `emibonnie-archive`'s `docs/superpowers/`. Take everything else from upstream.
  - Remove the `site/` line from `.gitignore`.
  - Check `git config user.email`. **Expected:** `bluerotcar@gmail.com`.
- [ ] **Step 2: `site/` values from the spec.**
  - **Identity:** name "emibonnie archive", wordmark `{accent:'emibonnie', rest:'archive'}`, tagline "fan translations, kept".
  - **Settings:** `lowercaseNames: true`, `sourceLanguage: 'th'`, `timezone: 'Asia/Bangkok'`, `region: 'sin1'`, `ownerXUserId: '1957464086339534848'`, `contactUrl` from the owner.
  - **featuredPeople:**
    - `{igHandle:'emiamily', displayName:'emi', emoji:'🧡', colour:'#ff8a3d'}`
    - `{igHandle:'beonnnie', displayName:'bonnie', emoji:'💜', colour:'#9b6cff'}`
    - If validation flags either colour's contrast, darken that colour's **text shade** in `theme.css` and keep the brand colour. Record this in the commit message.
  - **defaultMarkers:** `{'💜':beonnnie, '🧡':emiamily, '🗣️':role crowd, '💬':role fan}`.
  - **ignoredHashtags:** `['emibonnie','namtanfilm']`.
  - **categories:** the spec's types.
  - **theme.css:** overrides only the tokens: paper `#f6efe3`, card `#fffdf8`, line `#eadfce`, ink `#2b2233`, muted `#8a7f8f`, gradient `#ff6a2b → #e03a85`, `--font-script` IBM Plex Sans Thai. Dark values come from the engine defaults unless they need adjusting.
  - **logo:** `logo.png` from `docs/superpowers/specs/mockups/`.
  - **copy.json:** the about-page logo credit and any wording changes.
- [ ] **Step 3: Seed.**
  - `git mv test/fixtures/tweets site/seed/tweets`.
  - `site/seed/maps.json`:
    - `createPeople: [{igHandle:'leo_saussay', displayName:'leo', emoji:'🦁', colour:'#2fa89a'}]`
    - per-tweet `chosen` maps for @vacantvolcanic: 🐰 → beonnnie, 🦊 → emiamily, 🦁 → leo_saussay, 🌧️ → role speaker, 🪇 → role speaker
    - @danaNYB and @SugarHoneyz13 use the defaults
  - This repo stays **private**, because the seed contains real translators' tweets.
- [ ] **Step 4: Verify.**
  - Run `npm run build && npm run check && npm test`. The engine's purity test passes, because emibonnie values exist only under `site/`.
  - `npm run doctor` is all ✓, apart from env vars not being set yet.
  - `PGLITE_DIR=.devdb npm run seed-dev` reports `seeded 6`.
  - `npm run e2e` passes.
  - Compare against the mockups at 390px and 1280px: 🧡/💜 bubbles, the logo, FAN-MADE, the paper background, and leo shown as 🦁 leo.
- [ ] **Step 5: Commit** in `emibonnie-archive`: `"emibonnie site on fan-archive v0.1.0"`

---

### Task 10: Launch emibonnie (needs the owner)

**Work in `emibonnie-archive/`. Files:** create `scripts/deploy.sh` and `site/docs/deploy.md` (owner steps, plus an incident runbook: a leaked secret, and a takedown).

**Owner decision (2026-10-21): emibonnie deploys manually** with the fan Vercel CLI on the owner's machine, with no GitHub Actions deploy and no Vercel token. `scripts/deploy.sh [--prod]` runs, stopping at the first failure:
1. `npm ci`
2. `npm run build`, `npm run check`, `npm test`
3. `npm run doctor`
4. **`npm run migrate`** against `DATABASE_URL` (prod) or `DATABASE_URL_PREVIEW`
5. `vercel deploy` (with `--prod` when asked)

CI (tests only) still runs on GitHub.

**Owner steps.** Pause here. The owner does these in their **fan accounts**, following the spec's identity checklist. Confirm each step before continuing.
1. **Neon:**
   - Create a project for emibonnie: AWS Singapore, autoscale max 0.25 CU.
   - Create a `preview` branch.
   - Copy both connection strings.
   - Create a least-privilege app role, with no `UPDATE` or `DELETE` on `audit_log`.
2. **Vercel:** the executor runs `vercel link --yes --project emibonnie-archive` with the logged-in fan CLI. The owner adds env vars in the Vercel dashboard: Production `DATABASE_URL`, Preview `DATABASE_URL_PREVIEW` only.
3. **GitHub:**
   - Create the private repos `mintbluecar/fan-archive` (if not created in the 1a spike) and `mintbluecar/emibonnie-archive`.
   - No deploy secrets are needed on GitHub (manual deploys). CI runs tests only.
4. **2FA:** confirm it's on for X, Google, GitHub, Vercel and Neon.

- [ ] **Step 1: Write `scripts/deploy.sh` and `site/docs/deploy.md`.**
- [ ] **Step 2: Database.**
  - Run `DATABASE_URL=… npm run setup`. **Expected:** the engine migration applied, then `seeded 2 people`.
  - Run `DATABASE_URL=… npm run seed-dev`. This loads the 6 real tweets through the same maps, offline from the seed files. **Expected:** `seeded 6`.
- [ ] **Step 3: Ask the owner whether to push.** Push `fan-archive` (main plus tag `v0.1.0`) and `emibonnie-archive`, then switch `upstream` to the GitHub URL. Push only on a yes. After pushing:
  - Actions shows green, and the migrate step reports `up to date`.
  - On a phone, the production URL lists the events, and an entry's video plays and stays pinned.
  - `curl -I` on the home page shows the CSP, HSTS, `s-maxage=300`, and an `x-vercel-id` containing `sin1`.
  - The link preview for `/t/<id>` shows the right title and description when pasted into Telegram or X.
  - The Neon console shows max autoscale 0.25 CU.
- [ ] **Step 4: Launch checklist for the owner.** Write it in `site/docs/deploy.md` and report it at the end of the task:
  - The identity checklist from the spec, item by item.
  - About, privacy and takedown read correctly.
  - The logo is credited.
  - Contact each translator (@vacantvolcanic, @danaNYB, @SugarHoneyz13, and the Notion translator) with what's archived and how to opt out. Opt-out arrives in Plan 2, so until then they ask through the contact link.
  - Plan 3 brings the weekly backup. **Until then, run `pg_dump` by hand after any big change** (the command is in `deploy.md`).

---

## Self-review notes

- **Coverage of the spec's pages:** home, event, translation, search (filters, scoped), person, translator, about, privacy, takedown, 404. Sign-in, add, me and admin come in Plans 2 and 3.
- **Review findings covered here:**
  - bundling and immutable caching
  - auto-escaping templates and split-then-escape highlighting
  - CSP without inline styles
  - accessibility (`lang`, labels, focus, contrast, reduced motion) plus axe
  - Playwright at both widths
  - self-hosted fonts
  - the kind-plugin proof
  - recipes for every extension point
  - start-your-own with both deploy paths, the no-card rule, region and limits
  - migrations on deploy, and a preview branch separate from production
  - semver tags and upgrade steps
  - the trust pages and launch checklist
  - the private seed
- **Deferred:**
  - **Plan 2:** auth with narrow X scopes, DB-backed rate limits, the add flow (event picker, separate event, inline new event), me / remove / restore / opt-out, account deletion, reports, translator welcome, blocking, the approval switch.
  - **Plan 3:** admin, Notion/paste import, the rotating health check (Vercel Cron), deleted-at-source flags for translator contact, the weekly `pg_dump` artifact (35 days), the erasure script, and source-failure alerts.
