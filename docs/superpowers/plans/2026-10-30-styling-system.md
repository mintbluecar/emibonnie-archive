# Styling System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-screen CSS with a layered, token-driven design system whose defaults are on-brand and whose rules are enforced, then move every screen onto it and ship it as engine release 0.5.0.

**Architecture:** The build wraps each CSS source in a cascade layer by folder (`tokens, theme, base, primitives, layout, components`). Element defaults and a small set of primitives (`btn`, `field`, `card`, `table`, `chip`, `badge`, `notice`, text and spacing helpers) carry every shared look; component CSS only lays out its screen. Stylelint, a class-usage test, a theme test and an e2e structure check make mistakes fail; `STYLING.md`, a dev-only style guide page and a screenshot gallery make the system discoverable.

**Tech Stack:** Plain CSS with cascade layers, built by esbuild (`scripts/buildAssets.js`); vanilla JS template-string components (`public/js`); `node:test`; Playwright e2e; Stylelint (new dev dependency); `@fontsource/*` for self-hosted fonts.

**Spec:** `docs/superpowers/specs/2026-10-30-styling-system-design.md` (this repo). Read it before any task.

**Where the work happens:** every task except Task 16 runs in the engine repo `/Users/rhonda/developer/personal/embn/fan-archive` on a branch `styling-system` off `main` (0.4.0). Task 16 runs in this repo (`emibonnie-archive`). Paths below are relative to the repo the task runs in.

## Global Constraints

- CSP is `style-src 'self'` and `font-src 'self'`: no inline `style=` attributes, no `<style>` in served pages, no third-party font or CSS URLs.
- Node 22+, ESM, `// @ts-check` with JSDoc types, as in the rest of the repo. `npm run check` (tsc + eslint, plus stylelint after Task 5) and `npm test` pass after every task; `npm run e2e` after every task that touches markup or CSS.
- Existing token names are kept; nothing a site may override today is renamed or removed. A site `theme.css` may only set custom properties defined in `tokens.css`.
- Existing tests are not weakened: font sizes via `--text-*`, the two dark blocks in sync, `--color-label` for accent text, axe contrast, no horizontal scroll, the purity test (engine never names a fandom).
- Tests never write into a source tree (`npm test` hashes them); scaffold or build into temp dirs.
- Phone first: 16px gutter, no horizontal scroll at 390px, primitives default to `--tap-target` height; every control's target is at least 24×24 CSS px (WCAG 2.2 SC 2.5.8, checkbox/radio measured on their label).
- Token values are drawn from values already in use, so migrated screens move a pixel or two; screens that are broken today (unstyled controls, missing shell, missing table headings) are fixed.
- Primitive class names have no prefix (`btn`, `field`, …); component classes keep `c-<block>__<elem>`; nobody writes `@layer` by hand.

## Review Focus

1. **Dark mode under a site theme that sets light values on plain `:root`** (as `site/theme.css` does): dark mode must still show the engine's dark `--color-bg`/`--color-ink`. Test: Task 1 adds a build-level check and Task 8 an e2e assertion in the dark projects.
2. **A site that overrides `--font-latin` (today's name) and never mentions `--font-body`**: the body font must still change. Test in Task 2.
3. **Long unbroken content in a table cell at 390px** (a 60-character handle, a long URL, Thai text): no horizontal scroll, cell wraps. Test in Task 10.
4. **Keyboard focus on every interactive primitive**, including `btn--quiet` and chips, in light and dark: a visible ring using the focus tokens. Test in Task 3/4 (style guide e2e).
5. **A site with no `theme.css` and no `fonts` in `site.json`**: build succeeds, engine defaults apply, `fonts.css` has only the engine families. Test in Task 13.

---

### Task 0: Move today's dev tooling into the engine

The tooling built on 2026-10-30 lives uncommitted in `emibonnie-archive`. Bring the engine parts here so later tasks (the gallery) can use them.

**Files (copy from `../emibonnie-archive`, same paths):**
- Create: `scripts/pullProd.js`, `test/routes/authDev.test.js`, `test/scripts/pullProd.test.js`
- Modify: `scripts/dev.js`, `src/routes/authDev.js`, `src/routes/index.js`, `src/services/oauthState.js`, `test/dev.test.js`, `test/privacy.test.js`, `package.json` (the `pull-prod` script), `CONTRIBUTING.md` (section "Real data and roles locally")

**Interfaces:**
- Produces: `GET /api/auth/dev?as=<owner|translator|member|google|guest>[&handle][&returnTo]` (sets `sid` and `dev_as` cookies, 302); `DEV_AS` env for `scripts/dev.js`; `createServer({ …, devAs })`; `devSignInRedirect(devAs, req, url)`; `copyDatabase({ source, target, log })`; `safeReturnTo(returnTo)` exported from `src/services/oauthState.js`; `DEV_ROLES`, `DEV_AS_COOKIE` from `src/routes/authDev.js`.

- [ ] **Step 1:** In `emibonnie-archive`, `git diff -- scripts src test package.json CONTRIBUTING.md > /tmp/devtools.patch` plus the three untracked files; apply in `fan-archive` with `git apply` and copy the untracked files. Do not bring `site/`, `docs/`, `links.txt` or `import-report.csv`.
- [ ] **Step 2:** Run `npm run check && npm test`. Expected: PASS (in the site repo this was 1267 pass, 0 fail, 1 skipped; counts here differ by the site's own tests).
- [ ] **Step 3:** Commit `feat(dev): copy production data locally and sign in as any role (pull-prod, DEV_AS)`.

### Task 1: Layered CSS build

**Files:**
- Modify: `scripts/buildAssets.js` (`collectAppCssSources`, `buildAppCss`)
- Create: `src/styles/primitives/.gitkeep` (folder exists before any primitive)
- Modify: `scripts/build.js:26-31` and `test/core/bundling.test.js` (type-scale test) so `src/styles/primitives/` is scanned like `components/`
- Test: `test/core/bundling.test.js`

**Interfaces:**
- Produces: `LAYER_ORDER = ['tokens', 'theme', 'base', 'primitives', 'layout', 'components']` (exported from `scripts/buildAssets.js`); `layerOf(relativePath: string): string` mapping `tokens.css→tokens`, site theme→`theme`, `base.css→base`, `primitives/*→primitives`, `layout.css→layout`, `components/*→components`; `buildAppCss(repoRoot, outDir, siteThemePath)` unchanged signature.

- [ ] **Step 1: Failing tests** in `test/core/bundling.test.js`:
  - `app.css declares the layer order once, first`: built CSS starts with `@layer tokens,theme,base,primitives,layout,components;`.
  - `each source lands in its layer`: a temp repo with one rule per folder plus a site theme; the minified output contains each rule inside `@layer <expected>{…}`.
  - `a hand-written @layer in a source fails the build` with message naming the file.
  - `the site theme is layered, never unlayered`: the theme's `:root{--color-bg:#f6efe3}` appears inside `@layer theme{`.
- [ ] **Step 2:** Run `node --test test/core/bundling.test.js`. Expected: FAIL on the four new tests.
- [ ] **Step 3:** Implement: prepend the order statement, wrap each file's text in `@layer <layerOf(file)> { … }`, throw on `@layer` in a source. esbuild keeps layers when minifying (verify in the test output, don't assume).
- [ ] **Step 4:** Run the test file, then `npm run build && npm test`. Expected: PASS.
- [ ] **Step 5: Dark-mode guard (Review Focus 1, build half).** Add `test/site/themeTokens.test.js` case `dark blocks still outrank a site's light :root`: in the built CSS of `examples/solluna` with a temp theme that sets `--color-bg` on `:root`, the engine's dark selectors are in `@layer tokens` and the theme in `@layer theme`, and both dark selectors have specificity (0,2,0). Run, expect PASS.
- [ ] **Step 6:** Commit `build(css): cascade layers by folder, site theme in its own layer`.

### Task 2: Token scales and font roles

**Files:**
- Modify: `src/styles/tokens.css`, `src/styles/base.css` (`body` uses `--font-body`; `h1, h2, h3` use `--font-heading`)
- Test: `test/site/themeTokens.test.js`, new `test/core/tokens.test.js`

**Interfaces:**
- Produces (exact names; values from what's in use):
  - spacing `--space-1` 4px, `--space-2` 8px, `--space-3` 12px, `--space-4` 16px, `--space-5` 20px, `--space-6` 24px, `--space-8` 32px
  - radius `--radius-sm` 8px, `--radius-md` 12px, existing `--radius-card`, `--radius-pill` 999px
  - shadow `--shadow-card: 0 2px 0 var(--color-card-shadow)`, `--shadow-raised` (from the filter sheet / dialogs in use)
  - weight `--weight-regular` 400, `--weight-bold` 700, `--weight-heavy` 800
  - focus `--focus-ring-color` (defaults to `var(--color-label)`), `--focus-ring-width` 2px, `--focus-ring-offset` 2px
  - colour `--color-danger` (light `#c8433a`; dark chosen for ≥4.5:1 on dark `--color-card`), `--color-danger-tint`, plus `--color-on-accent` if `#fff` text on the gradient isn't already `--color-accent-text`
  - fonts `--font-latin` (existing value), `--font-body: var(--font-latin)`, `--font-heading: var(--font-body)`, `--font-script` (existing)
  - `--bp-desktop` is documentation only (CSS can't use it in media queries); the one allowed media value is `860px`.

- [ ] **Step 1: Failing tests** in `test/core/tokens.test.js`: every name above is defined in `:root`; every colour token above has a value in both dark blocks; `--font-body` resolves through `--font-latin` (string check `--font-body: var(--font-latin)`).
- [ ] **Step 2: Review Focus 2 test** in `test/site/themeTokens.test.js`: build with a temp theme setting only `--font-latin: 'X', sans-serif`; the built CSS's `body` rule uses `var(--font-body)` and `--font-body` is `var(--font-latin)`.
- [ ] **Step 3:** Run both. Expected: FAIL.
- [ ] **Step 4:** Add the tokens and the `body`/heading font rules.
- [ ] **Step 5:** Run `npm run build && npm test && npm run e2e`. Expected: PASS, no visual change.
- [ ] **Step 6:** Commit `feat(css): spacing, radius, shadow, weight, focus, danger and font-role tokens`.

### Task 3: On-brand element defaults and the style guide page

**Files:**
- Modify: `src/styles/base.css`
- Create: `dev/styleguide/index.html.tmpl`, `scripts/styleguide.js`; modify `scripts/dev.js` to serve `/dev/styleguide` from the generated file; add `dev/styleguide/index.html` (generated) to `.gitignore`
- Test: new `e2e/styleguide.spec.js` (runs in all four projects), `test/dev.test.js`

**Interfaces:**
- Produces: `buildStyleguide({ manifestPath, outPath }): void` in `scripts/styleguide.js` (fills the template's `{{asset:app.css}}`/`{{asset:fonts.css}}` from `public/build/manifest.json`); dev server route `GET /dev/styleguide` (404 when the generated file is missing). The folder `dev/` is outside `public/`, so it is never deployed; the route exists only in `scripts/dev.js`.
- The template has one `<section id="…">` per element/primitive; later tasks add sections. Sections for this task: `#elements` with a bare `button`, `input[type=text]`, `input[type=search]`, `select`, `textarea`, `input[type=checkbox]` with label, `input[type=radio]` with label, `table` with `thead`, `a`.

- [ ] **Step 1: Failing e2e** `e2e/styleguide.spec.js`:
  - `bare controls use the body font`: for each control in `#elements`, computed `font-family` equals `body`'s.
  - `bare controls look like controls`: `button` has non-transparent border colour and `border-radius` equal to `--radius-md`; text inputs/select/textarea have padding ≥ `--space-2`, a border and `--radius-md`; `select` has `appearance: none` and a visible chevron (its wrapper or background); `th` is bold.
  - `focus is visible` (Review Focus 4): tab to each control; `outline-style` is not `none` and `outline-width` equals `--focus-ring-width`.
  - `targets are at least 24px` (checkbox/radio via their label's box).
- [ ] **Step 2:** `test/dev.test.js`: `GET /dev/styleguide` serves the generated file, 404 without it. Run `node --test test/dev.test.js` and `npx playwright test e2e/styleguide.spec.js`. Expected: FAIL.
- [ ] **Step 3:** Implement `base.css` defaults with tokens only (a bare `button` gets the secondary look; checkbox/radio via `accent-color: var(--color-label)`; `:focus-visible` ring from the focus tokens; `table` collapses borders, `th` uses `--weight-bold` and a bottom divider). Remove the bare-text `button` reset. Components whose buttons relied on it (icon toggles, chips, text-like actions) get a local reset on their own selectors in their component files so nothing changes visually now; list those selectors in the commit message. Tasks 9–13 replace each local reset with `btn--quiet`/`btn--icon`/`chip`, and stylelint's primitive-look rule then rejects any that remain.
- [ ] **Step 4:** Implement `scripts/styleguide.js`, call it from `npm run build` after bundling, wire the dev route.
- [ ] **Step 5:** Run `npm run build && npm test && npm run e2e`. Expected: PASS; existing pages may shift slightly where a reset was removed — screenshot `/`, `/add`, `/me` at 390 and 1280 before/after and note differences in the task report.
- [ ] **Step 6:** Commit `feat(css): on-brand element defaults and a dev-only style guide`.

### Task 4: Primitives

**Files:**
- Create in `src/styles/primitives/`: `button.css`, `field.css` (includes today's `select.css` chevron as `field__select`), `card.css`, `table.css`, `chip.css`, `badge.css`, `notice.css`, `text.css`, `spacing.css`
- Delete: `src/styles/components/select.css` (moved); update `public/js/components/addDetails.js` and `filterSheet.js` wrappers from `c-select` to `field__select`
- Modify: `src/styles/layout.css` (drop unused `.stack/.row/.cols`; keep `.container`, add `.container--wide` max-width 1200px for Task 6)
- Modify: `dev/styleguide/index.html.tmpl` (one section per primitive, every variant)
- Test: `e2e/styleguide.spec.js`

**Interfaces (class API — later tasks use exactly these):**
- `btn` + one of `btn--primary` (gradient, `--color-accent-text`), `btn--secondary` (default look), `btn--quiet` (no border/background, label colour), `btn--danger`; size `btn--sm` (min-height 32px, still ≥24px); `btn--icon` (square, needs `aria-label`); `btn--block` (full width).
- `field` (stack of `field__label`, control, `field__hint`, `field__error`), `field__select` (wrapper span drawing the chevron), `check` (label wrapping checkbox/radio + text).
- `card`, `card--compact` (padding `--space-3`), `card--roomy` (`--space-5`).
- `table` (on `<table>`), `table__num`, `table__actions` (right-aligned cell, `cluster` of buttons), `table--stack` (below 860px each row becomes a card; each `td` shows its column name from `data-label`).
- `chip`, `chip--on`, `chip__count`; `badge`, `badge--accent`, `badge--danger`.
- `notice`, `notice--info`, `notice--error`, `notice--accent` (the "not published" bar).
- `meta` (small muted), `label` (section label), `heading heading--lg|md|sm`.
- `stack stack--1…6` (vertical gap from `--space-n`), `cluster cluster--1…4` (wrapping row with gap).
- Each file starts with a comment showing the markup for every variant.

- [ ] **Step 1: Failing e2e**, one test per primitive in `e2e/styleguide.spec.js`: computed values match tokens (e.g. `.btn--primary` background-image contains a gradient; `.card` box-shadow equals `--shadow-card`; `.chip` radius `--radius-pill`; `.table--stack` at 390px renders rows as blocks with `td::before` showing `data-label`; `.notice--error` colour `--color-danger`); focus ring on `btn--quiet` and `chip` (Review Focus 4); all targets ≥24px.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement primitives from tokens only, add style guide sections.
- [ ] **Step 4:** Run `npm run build && npm test && npm run e2e`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(css): shared primitives (button, field, card, table, chip, badge, notice, text, spacing)`.

### Task 5: Enforcement

**Files:**
- Create: `.stylelintrc.json`, `scripts/stylelintPending.json` (array of component CSS files not yet migrated — initially every file in `src/styles/components/`)
- Modify: `package.json` (`stylelint` dev dependency pinned to the exact current version; `check` runs `stylelint "src/styles/**/*.css" "examples/*/theme.css"` after eslint)
- Create: `test/styles/classUsage.test.js`, `test/styles/stylelintPending.test.js`
- Modify: `test/site/themeTokens.test.js` (theme may only set defined tokens), `scripts/templates/component/` (add `component.css.tmpl`), `scripts/new.js` (component also creates `src/styles/components/<name>.css`), `test/scripts/new.test.js`

**Interfaces:**
- Stylelint rules (configuration details are the builder's): no hex/rgb/hsl colours outside `tokens.css` and site `theme.css`; no px for `padding*`, `margin*`, `gap`, `border-radius`, `min-height` outside `tokens.css` (allow `0`, `1px`/`1.5px`/`2px` in `border*` widths); media queries only `(min-width: 860px)`/`(max-width: 859.98px)`; in `components/`, no selector containing a primitive class (`.btn`, `.field`, `.card`, `.table`, `.chip`, `.badge`, `.notice`, `.meta`, `.label`, `.heading`, `.stack`, `.cluster`); no duplicate selectors; no `@layer`. Files listed in `scripts/stylelintPending.json` are passed to stylelint's `ignoreFiles`.
- `classUsage.test.js`: every static class token inside `class="…"` in `public/js/**/*.js` and `dev/styleguide/index.html.tmpl` matches a class selector in `src/styles/**/*.css`, and every class selector in CSS is used, except (a) classes owned by a pending file and (b) dynamic families listed in the test with their prefix (e.g. `c-import__state--`).
- `stylelintPending.test.js`: the pending list only names files that exist (so it shrinks honestly); Task 15 flips it to "must be empty".

- [ ] **Step 1:** Write `classUsage.test.js`, the theme test case (`a theme setting --made-up fails`), and the scaffold test (`npm run new component foo` in a temp root creates `src/styles/components/foo.css` whose first line references `STYLING.md`). Run. Expected: FAIL.
- [ ] **Step 2:** Implement config, pending list, scaffold template.
- [ ] **Step 3:** Run `npm run check && npm test`. Expected: PASS with every component pending; tokens/base/primitives/layout lint-clean.
- [ ] **Step 4:** Commit `chore(css): stylelint, class-usage and theme checks; component scaffold creates its CSS`.

### Task 6: The shell can't be skipped

**Files:**
- Modify: `public/js/components/pageShell.js` (returns `ShellHtml`; new `wide` prop adds `container--wide`), `public/js/core/html.js` (export `class ShellHtml extends SafeHtml`), `public/js/core/dom.js` (`mountPage`), `public/js/pages/adminImport.js` (`paint()` wraps in `pageShell.render({ active: 'me', wide: true, content })`)
- Test: `test/core/dom.test.js`, `test/components/pageShell.test.js`, `test/pages/` (an adminImport compose test if one is added)

**Interfaces:**
- `mountPage(root: Element, page: ShellHtml): void` throws `TypeError('mountPage() expects pageShell.render(...)')` for any other `SafeHtml`. `mount()` is unchanged (repaint of an already-shelled page, as `edit.js:80`/`add.js:68` do — those still pass full shell markup).
- `pageShell.render({ active, compact = false, wide = false, headerProps = {}, content }): ShellHtml`.
- Plan-level decision: the spec's intent ("a page can't mount without the shell") is met by typing the shell's output rather than by changing `mountPage` to take shell props, because every `compose*` function already returns `pageShell.render(…)` and `test/pages/*` assert on that output; this changes one call site (`adminImport.js:79`) instead of all of them.

- [ ] **Step 1: Failing tests:** `mountPage` throws on plain `html\`…\``; accepts `pageShell.render(…)`; `pageShell.render({ wide: true, … })` puts `container container--wide` on `main`.
- [ ] **Step 2:** Run `node --test test/core/dom.test.js test/components/pageShell.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement; fix `adminImport.js` `paint()`.
- [ ] **Step 4:** `npm test && npm run e2e`. Expected: PASS; `/admin/imports/:id` now has the header and gutter.
- [ ] **Step 5:** Commit `fix(web): every page mounts inside the shell; import review gets a wide shell`.

### Task 7: Screen gallery

**Files:**
- Create: `scripts/screens.js`; `package.json` script `screens`; `.gitignore` adds `.screens/`
- Test: `test/scripts/screens.test.js` (pure parts only)

**Interfaces:**
- `npm run screens [-- --db <dir>] [-- --out .screens] [-- --only <path-substring>]`. Without `--db`: builds, seeds a fresh temp PGlite from the site's `seed/` (as `scripts/e2eSite.js` does), never touching `.devdb`. With `--db`: uses that directory as-is.
- `pagesFor(role, api): Promise<{ name: string, path: string }[]>` discovers URLs through the API like `e2e/site.spec.js` (home, first event and its first item, each listed person, first translator, search, about, privacy, takedown, 404) plus role pages: owner → `/me`, first item's `/edit/...`, `/add`, `/admin/imports/<latest job>` when one exists; translator → `/me`; member → `/me`, `/add`; guest → `/me` signed-out.
- Roles via `GET /api/auth/dev?as=<role>` (Task 0). Viewports 390×900 and 1280×900, light and dark (`data-theme`). Output `.screens/<role>/<width>-<theme>/<name>.png` and `.screens/index.html` (static, links grouped by page then role).
- Never uploads or prints data; output is gitignored.

- [ ] **Step 1:** Unit-test `pagesFor` with a stub API (owner includes the edit and import pages; guest has no owner pages) and `outPathFor(role, width, theme, name)`. Run, expect FAIL.
- [ ] **Step 2:** Implement with Playwright's library API (`playwright` is already a dev dependency via `@playwright/test`).
- [ ] **Step 3:** Run `npm run screens`; open `.screens/index.html`; expect every page × role × viewport × theme present.
- [ ] **Step 4:** Commit `feat(dev): npm run screens, a gallery of every page for every role`.

### Task 8: e2e structure check

**Files:**
- Modify: `e2e/helpers.js` (`checkPage` gains `assertPageStructure(page)`), `e2e/owner.spec.js`, `e2e/me-translator.spec.js`, `e2e/import.spec.js`, `e2e/add.spec.js` (visit edit, owner section and import review as their roles)

**Interfaces:**
- `assertPageStructure(page)`: header element and `main.container` exist; every visible `button, input, select, textarea` has the body's computed font-family; every visible control's target ≥24×24 (checkbox/radio by label); every `table` has a `thead th`; in the dark projects (`DARK_PROJECTS`), `body` background equals the dark `--color-bg` from `tokens.css` (Review Focus 1, browser half).

- [ ] **Step 1:** Add the helper and the role visits. Run `npm run e2e`. Expected: FAIL only on the import review page (no `thead`) — record any other failure and fix it in this task if it's base-level, or note it for its migration task.
- [ ] **Step 2:** Mark the import table assertion as expected-to-fail with `test.fail()` scoped to that page, referencing Task 10, so the suite stays green.
- [ ] **Step 3:** Commit `test(e2e): structure check on every page, as each role`.

### Tasks 9–13: Migrate the screens

Each migration task follows the same steps; the file groups differ.

**Per-task steps:**
- [ ] **Step 1:** Run `npm run screens -- --only <group pages>` and keep the "before" folder.
- [ ] **Step 2:** In the group's JS, use primitives for every button, field, card, table, chip, badge, notice, label and muted text; delete the component rules they replace. Keep only layout and genuinely unique looks in the component file. Replace every raw colour/px with tokens. Move cross-file rules to their owner's file.
- [ ] **Step 3:** Remove the group's files from `scripts/stylelintPending.json`.
- [ ] **Step 4:** Update the group's component tests where class names changed (assert on the primitive classes).
- [ ] **Step 5:** `npm run check && npm test && npm run e2e`. Expected: PASS.
- [ ] **Step 6:** `npm run screens` again; compare before/after for the group; the task report lists every visible difference with a one-line reason (fixed breakage, or token rounding ≤2px).
- [ ] **Step 7:** Commit `refactor(css): <group> on tokens and primitives`.

**Task 9: Add and edit flow.** `add.css` (blocks `c-add`, `c-add-details`, `c-add-link`, `c-edit`, `c-line-fix`, `c-person-picker`, `c-speaker-step`); JS `addView`, `addDetails`, `addLink`, `editView`, `lineFixSheet`, `personPicker`, `speakerStep`. Must fix: dropdowns via `field__select`, `.c-add-link__next` and save buttons as `btn btn--primary`, the "already subbed" checkbox as `check`, "not published" bar as `notice notice--accent`, inline errors as `field__error`. Split `add.css` into one file per block.

**Task 10: Import review.** `adminImport.css`; JS `importRows`, `importSpeakers`, `adminImport`. Must fix: rows become `<table class="table table--stack">` with `thead` headings **state, translator, text, event, actions** (copy keys `import.col.*` in `src/site/copyDefaults.json`, each td with `data-label`), actions as `btn btn--sm btn--secondary` / `btn--icon`, "load more" as `btn`, filter chips as `chip`, search as `field`, speaker select as `field__select`, `#c8433a` → `--color-danger`, the duplicate `.c-import__chip` rule removed. Remove Task 8's `test.fail()`. **Review Focus 3:** add an `e2e/import.spec.js` case seeding a row with a 60-character handle, a 200-character URL and Thai text; at 390px no horizontal scroll and the text cell wraps.

**Task 11: Me, owner, sign-in, report.** `me.css` (+ `c-name-form`), `owner.css`, `signIn.css`, `report.css`; JS `meSections`, `meTranslations`, `nameForm`, `ownerSection`, `signIn`, `reportForm`, `pages/me.js`, `pages/meAccount.js`. Must fix: danger buttons `btn--danger`, the 11 raw hex colours in `me.css`, the two checkbox accent colours, the waiting list and users list as cards/tables of primitives, banners as `notice`. `report.css:88-89` rules move to `itemPage.css`/`eventPage.css`.

**Task 12: Public pages and navigation.** `header.css`, `filterSheet.css`, `tabBar.css`, `footer.css`, `hub.css`, `homeMonth.css`, `eventCard.css`, `eventPage.css`, `itemPage.css`, `previewCard.css`, `resultCard.css`, `chips.css`, `cast.css`, `bubbles.css`, `inlineSearch.css`, `refreshButton.css`, `personHeader.css`, `static.css`, `emptyState.css`. Must fix: the three identical "more" buttons, the gradient filter/apply buttons as `btn--primary`, round close buttons as `btn--icon`, cross-file rules (`chips.css` styling bubbles/cast, `hub.css` styling chips, `filterSheet.css` styling the header) moved to their owners, fan-made badge as `badge`.

**Task 13: Media and translation.** `carousel.css`, `zoomDialog.css`, `videoPlayer.css`, `mediaBox.css`, `sourceEmbed.css`, `thumb.css`, `quoteCard.css`, `cardCredit.css`, `eventTags.css`, `kindTranslation.css` (`k-` blocks). Must fix: `#000`/`#fff`/`rgba()` overlays as tokens (add `--color-overlay`/`--color-on-overlay` to `tokens.css` if none fits), the near-identical "gone" boxes in `mediaBox.css`/`videoPlayer.css` as one `notice`.

**Task 14: Site fonts.**

**Files:**
- Modify: `src/site/schema.js` (`checkFonts(errors, input)` → `fonts: SiteFont[]`, optional, default `[]`), `scripts/buildAssets.js` (`buildFontsCss(engineRoot, outDir, { siteDir, fonts })`), its caller in `scripts/buildBundle.js`, `test/site/themeTokens.test.js`, `docs/site-settings.md` ("Fonts" section)
- Test: `test/site/schema.test.js`, `test/core/bundling.test.js`

**Interfaces:**
- `SiteFont = { family: string, weights: number[], style?: 'normal'|'italic' } & ({ package: string, subsets: string[] } | { files: { path: string, weight: number, style?: 'normal'|'italic', unicodeRange?: string }[] })`, `path` relative to `site/fonts/`.
- `buildFontsCss` ships engine `FONT_SPECS` plus each site font that some token in `tokens.css` or the site `theme.css` names; the rest are skipped.

- [ ] **Step 1: Failing tests:** schema accepts both shapes and rejects a missing `family`, a non-woff2 file, a weight outside 100–900; build copies a fixture woff2 from a temp `site/fonts/` and emits its `@font-face` with the hashed file; build fails naming the font when a `files[].path` is missing or a package lacks a requested weight; a theme naming an undeclared family fails the theme test; **Review Focus 5:** a site with no `theme.css` and no `fonts` builds and `fonts.css` contains only Nunito and IBM Plex Sans Thai.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement; add a heading-font example to `examples/solluna` only if it doesn't change its look (else document it without using it).
- [ ] **Step 4:** `npm run build && npm test && npm run e2e`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(site): sites can self-host their own fonts and set heading and body fonts`.

### Task 15: Docs, lock-in and release 0.5.0

**Files:**
- Create: `STYLING.md` (layers, token scales with values, each primitive's markup, when to write component CSS, the 860px breakpoint, fonts, the checks that fail and how to fix each, `/dev/styleguide`, `npm run screens`)
- Modify: `CONTRIBUTING.md` (styling lines link to `STYLING.md`; "Definition of done for UI work": run `npm run screens`, look at changed screens next to their mockup), `CLAUDE.md` (create if absent: same definition of done, pointer to `STYLING.md`), `docs/site-settings.md` (theme layer note: no change needed), `CHANGELOG.md` (0.5.0: what site owners must know — new tokens, font roles and `site.json` `fonts`, the `theme` layer, `mountPage` now requires `pageShell.render`, stylelint in `npm run check`, `pull-prod`/`DEV_AS`/`npm run screens`), `package.json` version `0.5.0`, `test/styles/stylelintPending.test.js` (now: pending list must be empty; delete the list file and its `ignoreFiles` wiring)

- [ ] **Step 1:** Flip the pending test; run `npm run check && npm test`. Expected: PASS (all components migrated). If not, finish the missing file in its migration task first.
- [ ] **Step 2:** Write the docs. Check every class and token named in `STYLING.md` exists (a test in `test/styles/classUsage.test.js`: classes in `STYLING.md` code blocks must exist in CSS).
- [ ] **Step 3:** `npm run build && npm run check && npm test && npm run e2e && npm run screens`. Expected: PASS; skim the full gallery.
- [ ] **Step 4:** Commit `docs: STYLING.md and release 0.5.0`; merge `styling-system` into `main`; tag `v0.5.0`. (Ask the owner before pushing anywhere.)

### Task 16: Merge into emibonnie-archive (this repo)

**Files:** `site/Taskfile.yml` (add `screens`), the merge itself.

- [ ] **Step 1:** Confirm each uncommitted engine file here is identical to `fan-archive` at `v0.5.0`'s Task 0 commit (`git diff --no-index`), then drop the uncommitted engine copies (`git checkout -- scripts src test package.json CONTRIBUTING.md` and remove the three untracked engine files). Keep `site/`, `docs/`, and the owner's `links.txt`/`import-report.csv` untouched.
- [ ] **Step 2:** `git fetch upstream --tags && git merge v0.5.0`. Resolve conflicts, if any, in favour of the engine except in `site/`.
- [ ] **Step 3:** Add to `site/Taskfile.yml`: `screens` (desc "Screenshots of every page for every role on .devdb, into .screens/"), `env: PGLITE_DIR: .devdb, DATABASE_URL: '', VERCEL: ''`, `cmds: [npm run screens -- --db .devdb]`.
- [ ] **Step 4:** `npm run build && npm run check && npm test && npm run e2e:site`. Expected: PASS with this site's `theme.css` (purple labels, dark mode unchanged).
- [ ] **Step 5:** `task screens`; check edit, owner section and import review at 390 and 1280, light and dark, against the before screenshots from 2026-10-30. Report to the owner with the gallery path.
- [ ] **Step 6:** Commit the merge and the Taskfile change (ask before pushing).
