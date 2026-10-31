# Styling system: one shared design layer, enforced

Date: 2026-10-30. Status: draft for the owner's approval.

## Why

The owner opened the edit page and the import review page and found unstyled dropdowns, buttons that read as plain text, no page padding, and a table with no column headings. They want the CSS fixed as a system before they tune each page's look: a new developer should never have to search to learn how to style something, nothing should be repeated, and missing a style should be hard to do by accident.

An audit (2026-10-30) found three causes:

1. **No shared layer.** 4,359 lines across 39 CSS files, nearly all per-screen. Primary buttons are built 9 ways with 5 radii, outline buttons 10 ways, text fields 8 ways with 4 radii. The card look (background + `--radius-card` + shadow) is copied by hand in 13 rules with 5 paddings. 65 rules rebuild "small muted text". There is no spacing, radius (beyond `--radius-card`), shadow, weight, danger or focus token, so components carry 701 px literals and 29 raw hex colours (`#c8433a` is the de facto error colour, 8 times). `layout.css`'s `.stack`, `.row` and `.cols` are used nowhere.
2. **Forgetting is silent.** `base.css` resets `button` to bare text and leaves `input`, `select`, `textarea`, checkboxes and `table` to the browser. Any control without its own rule renders broken: `.c-add-link__next`, `.c-import__more`, two checkboxes, the import speaker select. There is no shared focus-visible style. The page shell is opt-in per `mountPage` call, and `adminImport.js:79` skipped it (no header, no `.container`, content to the window edge).
3. **Nothing checks the result.** Tests enforce token existence and `--text-*` font sizes only; there is no stylelint. e2e `checkPage` (200, console/CSP, no horizontal scroll, axe) passes an unframed, unstyled page. Plan 1b had a "check in a browser at 390px and 1280px, screenshots next to the mockup" step; plans 2a, 2b and 3 dropped it, and `mockups/admin-import-v1.html` was never referenced.

## Goals

- A developer styles a new screen by composing documented building blocks and only writes layout CSS for the screen itself.
- An element with no class still looks on-brand (forgetting degrades to "plain but correct", never "broken").
- Every page gets the shell without having to remember it.
- Values come from tokens; repeated looks exist once.
- Mistakes fail a check: lint, unit test or e2e.
- One place to look: `STYLING.md` plus a live style guide page in dev.

## Non-goals

- Tailwind or any utility framework (rejected: it fixes none of the three causes, moves duplication into markup, adds a build step to a custom build that site repos also run, and means rewriting all 93 controls and 51 blocks).
- Redesigning pages. The owner tunes looks after this lands. Migration keeps each screen's look close to today, except where today is broken.
- Changing the theming contract: a site's `theme.css` still overrides token values and nothing else. (Site fonts, section 2b, are added through `site.json`, not `theme.css`.)

## Anti-goals (a failure even if it works)

- A site's existing `theme.css` stops working or changes the look unexpectedly.
- Inline styles, or anything else the CSP (`style-src 'self'`) blocks.
- Weakened existing tests (font-size tokens, dark-mode parity, label token, contrast/axe).
- Engine CSS that names the fandom (the purity test still applies).
- A "primitive" that each screen then overrides back into a one-off.

## Constraints

- Plain CSS, concatenated and minified by esbuild in `scripts/buildAssets.js`; markup is JS template strings in `public/js`; engine and site live in the same repo with `site/` owner-owned.
- Light and dark mode, both via tokens (the existing two dark blocks must stay in sync).
- Phone first: 16px gutter, no horizontal scroll, `--tap-target` minimum on controls.

## The design

### 1. Layers, applied by the build

`app.css` is assembled in cascade layers, declared once: `@layer tokens, base, primitives, layout, components;`. The build wraps each source file in its layer by folder, so authors never write `@layer` themselves:

| Folder / file | Layer | Holds |
|---|---|---|
| `src/styles/tokens.css` | tokens | custom properties only |
| `src/styles/base.css` | base | element defaults |
| `src/styles/primitives/*.css` | primitives | the shared building blocks |
| `src/styles/layout.css` | layout | page-level layout helpers |
| `src/styles/components/*.css` | components | one file per screen/component |
| site `theme.css` | tokens (right after `tokens.css`) | token overrides only |

Components sit above primitives, so a component *can* adjust a primitive, but lint (section 6) forbids redeclaring a primitive's look in component files.

The site theme goes in the `tokens` layer itself, right after `tokens.css`, never unlayered and never a layer of its own (corrected after the final review). Today a site's light values sit on a plain `:root` (0,1,0) and lose to the engine's two dark blocks (0,2,0), which is how dark mode works (`docs/site-settings.md`, "Light and dark"). Cascade layers are compared before specificity (CSS Cascade 5): an unlayered theme beats every layered rule, and a separate `theme` layer after `tokens` beats every `tokens` rule, so either would force the site's light colours into dark mode (the first draft of this section proposed the separate layer; that was wrong). Inside the same layer, specificity and then source order decide exactly as they do now, and no site's `theme.css` changes.

### 2. Tokens

Add the missing scales to `tokens.css`, each with light and dark values where colour is involved:

- spacing scale (`--space-1` …), radius scale (small, medium, card, pill), shadow (card, raised), font weights (regular, bold, heavy), focus ring (colour, width, offset), danger/error colour and its tint, success if needed by a migrated screen, control height (reuse `--tap-target`), and the one desktop breakpoint value documented in `STYLING.md` (CSS can't use a custom property in a media query, so lint pins the allowed values).
- Existing token names stay; nothing a site overrides today is renamed or removed.
- Values are chosen from what the audit found in use (for example radii collapse from 8/10/12/14/999 to the scale), so migrated screens move a pixel or two, not more.

### 2b. Fonts a site can choose (owner's request)

Today a site can only pick between the two families the engine self-hosts (`FONT_SPECS` in `scripts/buildAssets.js:25`: Nunito and IBM Plex Sans Thai). Adding any other family means an engine change, because the CSP (`font-src 'self'`) blocks hosted font services. Changing a font should be a settings entry plus one token line.

- **Font roles as tokens:** `--font-body` (everything), `--font-heading` (h1–h3 and the heading primitive) and `--font-script` (Thai and other `lang`-marked text, as today). `--font-latin` stays as an alias of `--font-body`, so a site that overrides it today keeps working. Headings default to the body font, so nothing changes until a site sets them.
- **A site declares its fonts in `site.json`** (a new optional `fonts` list, validated in `src/site/schema.js`). Each entry names a family, the weights to ship, and one source:
  - an `@fontsource/*` package the site installs (subsets and weights picked like `FONT_SPECS`), or
  - its own woff2 files under `site/fonts/` (with the weight and style of each file, and an optional `unicode-range`).
- **The build self-hosts them** exactly like the engine's own: files copied into the hashed build output, `@font-face` rules added to `fonts.css`. The engine's two families stay as defaults. A site family that's never pointed at by a token isn't shipped.
- **The site points a role at it** in `theme.css`, e.g. `--font-heading: 'Some Display', var(--font-body);`.
- **Checks:** the build fails if a `site.json` font has a missing file, an unknown package or a weight the source doesn't ship. A font token in `theme.css` naming a family that isn't the engine's or declared in `site.json` fails the theme test. The style guide page shows each role in each weight in use.
- `docs/site-settings.md` gets a "Fonts" section with both routes and an example.

### 3. On-brand element defaults (`base.css`)

Unclassed `button`, `input`, `select`, `textarea`, checkbox, radio, `table`/`th`/`td`, `a` and `:focus-visible` get the site's look: site font, token padding and radius, borders, a visible focus ring, table header styling. A bare `<button>` looks like a secondary button. Components that need a borderless clickable use the quiet button variant instead of relying on a reset.

### 4. Primitives (`src/styles/primitives/`)

One file per building block, short class names without a component prefix (my call: `btn`, `field`, `card`, …, chosen for typing and reading in templates; the `c-` prefix stays for components):

- **Button:** `btn` with `btn--primary` (the gradient), `btn--secondary`, `btn--quiet` (text-like), `btn--danger`, `btn--icon` (square, `aria-label` required), sizes default and small.
- **Field:** `field` for label + control + hint + error; the control styles come from base. The dropdown chevron wrapper (today's `.c-select`) becomes the field's select variant.
- **Card:** `card` with padding sizes.
- **Table:** `table` with a header row, row dividers, a numeric/actions column, and a phone layout where each row stacks with its column label shown.
- **Chip / badge:** `chip` (filter, with on state and count), `badge` (fan-made, translator, state labels).
- **Notice:** `notice` with info and error variants (banners, inline errors, the "not published" bar).
- **Text helpers:** `meta` (small muted), `label` (section label), `heading` sizes.
- **Spacing/layout:** `stack` (vertical gap) and `cluster` (wrapping row) with gap sizes; `layout.css` keeps `.container` and page columns.

Each primitive's file opens with a comment showing its markup.

### 5. The shell is not optional

`mountPage` takes the shell's props and content (`active`, `compact`, `headerProps`, `content`) and always renders `pageShell`. A page can't mount without it. If a page genuinely needs no header in future, that is a named, documented option on `mountPage`, not a second function. `adminImport.js` and every other page move to the new signature.

### 6. Enforcement

- **Stylelint** (new dev dependency) runs in `npm run check`, with rules that:
  - reject hex/rgb/hsl colours outside `tokens.css` (and site `theme.css`);
  - reject px values for spacing, gap and radius outside `tokens.css`, allowing 0 and hairline border widths;
  - pin media queries to the documented breakpoint values;
  - in `components/`, forbid selectors that target primitive classes and forbid redeclaring button/field looks (background + border-radius + padding on a button selector);
  - reject duplicate selectors within a file and `@layer` written by hand.
- **Unused/undefined class test:** every static class in a `class="…"` attribute in `public/js` must match a selector in the CSS, and every CSS class must be used somewhere (with an allow-list for classes built dynamically, e.g. `c-import__state--${state}`, matched by prefix).
- **Theme test:** a site `theme.css` may only set custom properties that `tokens.css` defines.
- **e2e structure check** added to `checkPage` for every page it visits: the header and `main.container` exist; every visible `button`, `input`, `select` and `textarea` uses the body font family; every `table` has a header row; and every control's target is at least 24×24 CSS px, measured on the control or, for a checkbox or radio, on its label (my call: WCAG 2.2 success criterion 2.5.8, Target Size (Minimum), level AA). The 44px `--tap-target` stays the default height of the button and field primitives but isn't asserted, so chips, small buttons and checkboxes keep their current size. The owner pages (edit, owner section, import review) are visited as owner, translator pages as translator.
- **`npm run new component <name>`** also creates `src/styles/components/<name>.css` with a header comment pointing to `STYLING.md`.

### 7. Docs and the style guide

- **`STYLING.md`** at the repo root, one page: the layers, the token scales, each primitive with its markup, when to write component CSS (layout and genuinely unique looks only), the breakpoint, and the checks that will fail. CONTRIBUTING.md's styling lines link to it.
- **Style guide page** at `/dev/styleguide`, reachable only in local dev (never deployed): every primitive and element default in every variant, light and dark, rendered from the real CSS.
- **Screen gallery** (`npm run screens`, my call on data and output): builds, runs the dev server on a database directory, and saves screenshots of every page for each role (owner, translator, member, guest) at 390px and 1280px, light and dark, with an index page to flip through. It's for people to look at, not a pass/fail test. By default it uses a fresh database seeded from the site's `seed/` (as `e2e:site` does), so it never needs real data. A site can point it at its own database: this repo's `site/Taskfile.yml` gets `task screens`, which uses `.devdb` (possibly a copy of production). Output goes to a gitignored `.screens/` and is never committed, uploaded or published.
- **Definition of done for UI work** in CONTRIBUTING.md (and the repo's agent instructions file, created if absent): run `npm run screens` and look at the changed screens next to their mockup before calling it done. This restores the step plans 2a–3 lost.

### 8. Migration

All 36 component files and the 93 controls move onto tokens and primitives; duplicated rules are deleted. Specifically fixed along the way:

- the import review page: inside the shell (with a wide content option on the shell), a real table with headings (state, translator, text, event, actions), actions as buttons, "load more" as a button, the speaker select styled;
- the edit/add flow dropdowns, checkboxes and the add-link "next" button;
- `#c8433a` and other raw colours replaced by tokens;
- the unused `.stack/.row/.cols` replaced by the primitives;
- the duplicate `.c-import__chip` and cross-file rules (chips.css styling bubbles/cast, report.css styling item/event footers, etc.) moved into their owners' files or into primitives.

Existing tests keep passing; e2e passes in light and dark at phone and desktop.

## Where it's built (owner's decision)

- **Engine work happens in `../fan-archive`** and reaches this repo as a tagged release merged in, like v0.4.0. That covers everything above, plus the dev tooling built on 2026-10-30 that is sitting uncommitted here: `scripts/pullProd.js` and `npm run pull-prod`, `DEV_AS` in `scripts/dev.js`, the `GET /api/auth/dev` role switch, their tests, and the CONTRIBUTING section. That tooling moves to `fan-archive` first (it's needed for `npm run screens`), and the uncommitted engine copies here are dropped once the release is merged, so the merge doesn't conflict.
- **Stays in this repo:** `site/Taskfile.yml` (`dev:pull`, `dev:as`, `dev:switch`, and the new `task screens`), this design doc and its plan, and the mockups.
- The engine stays fandom-neutral: primitives, docs, the style guide and gallery defaults use the bundled example site, never this site's names.
- Released as a minor version (0.5.0) with a CHANGELOG entry that tells site owners what changed for them: new tokens they may override, the font roles and the `site.json` `fonts` list, the theme loading in the `tokens` layer (no change needed to `theme.css`), the new `mountPage` signature for any site page code, and the new lint checks.

## Left to the builder

- Exact token values and names within each scale, as long as existing names are kept and values are drawn from what's in use.
- How the build wraps files in layers, and how the dev-only style guide is served without reaching production.
- Stylelint rule configuration details and the allow-list format for dynamic classes.
- Order of migration and how it's split into commits, as long as each commit leaves the suite green.
