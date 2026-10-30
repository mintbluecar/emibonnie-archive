# Styling

One page: the layers, the tokens, every primitive's markup, when a
component gets its own CSS, the breakpoint, fonts, the checks that will
fail on a mistake and how to fix each, and the dev tools for looking at
the result. `CONTRIBUTING.md`'s styling lines point here; `npm run new
component <name>` scaffolds a CSS file whose header comment points here
too.

The goal: style a new screen by composing the building blocks below and
writing CSS only for that screen's own layout and genuinely unique
looks. An element with no class still looks on-brand. Forgetting a style
degrades to "plain but correct", never "broken" -- and if it doesn't,
that's a check to add, not a one-off fix.

## 1. Layers

`app.css` is one file, in cascade layers declared once:

```css
@layer tokens, base, primitives, layout, components;
```

The build (`scripts/buildAssets.js`, `LAYER_ORDER`) wraps each source
file in its layer by folder -- nobody writes `@layer` by hand, and lint
rejects it if someone does:

| Folder / file | Layer | Holds |
|---|---|---|
| `src/styles/tokens.css` | `tokens` | custom properties only |
| a site's `theme.css` | `tokens`, right after `tokens.css` | token overrides only, never a new token |
| `src/styles/base.css` | `base` | element defaults |
| `src/styles/primitives/*.css` | `primitives` | the shared building blocks below |
| `src/styles/layout.css` | `layout` | page-level layout (`.container`, `.container--wide`) |
| `src/styles/components/*.css` | `components` | one file per screen/component |

Components sit above primitives, so a component *can* adjust a
primitive -- but never by redeclaring its look (section 5). A site's
`theme.css` has no layer of its own: the build puts it in `tokens`,
right after `tokens.css`. Layers are compared before specificity, so a
separate theme layer would let a light value on a plain `:root` beat the
engine's dark-mode blocks; inside the same layer, specificity and source
order decide exactly as `docs/site-settings.md` ("Light and dark")
describes -- the engine's dark blocks beat a theme's plain `:root`, and
the theme's own dark blocks beat the engine's. Nothing about layers
changes what a site writes there.

## 2. Tokens (`src/styles/tokens.css`)

A site's `theme.css` may only override a custom property already
defined here -- never add one (the theme test, section 6). Every colour
token has a dark-mode value where colour is involved, written in the
engine's two kept-in-sync dark blocks (`docs/site-settings.md`, "Light
and dark"); values below are the light-mode defaults.

**Spacing:**

```css
--space-1: 4px;
--space-2: 8px;
--space-3: 12px;
--space-4: 16px;
--space-5: 20px;
--space-6: 24px;
--space-8: 32px;
```

**Radius:**

```css
--radius-xs: 4px;
--radius-sm: 8px;
--radius-md: 12px;
--radius-lg: 20px;
--radius-card: 16px;
--radius-pill: 999px;
```

**Shadows:**

```css
--shadow-card: 0 2px 0 var(--color-card-shadow);
--shadow-raised: 0 -6px 24px var(--color-card-shadow);
```

**Weights:**

```css
--weight-regular: 400;
--weight-bold: 700;
--weight-heavy: 800;
```

**Focus ring** (every interactive primitive's `:focus-visible`, light and dark):

```css
--focus-ring-color: var(--color-label);
--focus-ring-width: 2px;
--focus-ring-offset: 2px;
```

**Danger, scrim, overlay, media and brand colours:**

```css
--color-danger: #c8433a;
--color-danger-tint: color-mix(in srgb, var(--color-danger) 12%, var(--color-card));
--color-scrim: rgb(0 0 0 / 45%);
--color-overlay: rgb(0 0 0 / 50%);
--color-on-overlay: #fff;
--color-media: #000;
--color-brand-x: #0f0f0f;
--color-on-brand-x: #fff;
--color-brand-google: #4285f4;
```

`--color-scrim` dims the page behind a modal `<dialog>` (`base.css`'s
`dialog::backdrop`); `--color-overlay`/`--color-on-overlay` are a
control placed over a picture or clip (`btn--overlay`); `--color-media`
is the letterbox/zoom background a picture or clip sits on; the brand
colours are sign-in buttons (X, Google) and are the same in both themes.

**Control and target sizes:**

```css
--tap-target: 44px;
--control-sm: 32px;
--control-md: 36px;
--target-min: 24px;
```

`--tap-target` is the default height of the button and field
primitives. `--target-min` (WCAG 2.2 SC 2.5.8, Target Size (Minimum)) is
the smallest any control may be -- chips, small buttons and a
checkbox/radio's label -- and is asserted by the e2e structure check
(section 6); `--tap-target` is not asserted, so those stay their
current, compact size.

**Text sizes:** every font size in `src/styles` is one of these, never
a literal px value. Each step is `calc(<size>px + var(--text-bump))`,
so a site can nudge every size at once by overriding `--text-bump`:

```css
--text-bump: 2px;
--text-10: calc(10px + var(--text-bump));
--text-10-5: calc(10.5px + var(--text-bump));
--text-11: calc(11px + var(--text-bump));
--text-11-5: calc(11.5px + var(--text-bump));
--text-12: calc(12px + var(--text-bump));
--text-12-5: calc(12.5px + var(--text-bump));
--text-13: calc(13px + var(--text-bump));
--text-14: calc(14px + var(--text-bump));
--text-15: calc(15px + var(--text-bump));
--text-16: calc(16px + var(--text-bump));
--text-18: calc(18px + var(--text-bump));
--text-19: calc(19px + var(--text-bump));
--text-20: calc(20px + var(--text-bump));
--text-22: calc(22px + var(--text-bump));
--text-28: calc(28px + var(--text-bump));
--text-40: calc(40px + var(--text-bump));
```

**Font roles:**

```css
--font-latin: 'Nunito', sans-serif;
--font-script: 'IBM Plex Sans Thai', sans-serif;
--font-body: var(--font-latin);
--font-heading: var(--font-body);
```

`--font-body` covers everything; `--font-heading` covers `h1`-`h3` and
the `heading` primitive, and defaults to `--font-body` until a site sets
it; `--font-script` covers Thai and other `lang`-marked text.
`--font-latin` stays as an alias of `--font-body`, so a site overriding
today's name keeps working without ever mentioning `--font-body`. A
site's own fonts (an `@fontsource/*` package or its own `.woff2`
files, declared in `site.json`'s `fonts` and pointed at by a role in
`theme.css`) are documented in `docs/site-settings.md`'s "Fonts"
section -- not repeated here. The dev-only style guide (section 7)
shows each role in each weight actually in use.

**The breakpoint:** `--bp-desktop: 860px` exists for documentation only
-- a CSS custom property can't drive a media query's condition (CSS
Custom Properties spec), so every actual media query in this engine
uses the literal value, and lint (`media-feature-name-value-allowed-list`)
rejects any other:

```css
@media (min-width: 860px) { /* "web" layout turns on */ }
@media (max-width: 859.98px) { /* the phone layout (the default) */ }
```

The phone layout is the default; `min-width: 860px` is the only place
"web" styling turns on. `859.98px` (not `859px`) is `860px` minus the
smallest step a browser's zoom/subpixel rounding could land on, so the
two queries never both match or both miss the same width.

## 3. Element defaults (`src/styles/base.css`)

An unclassed `button`, `input`/`select`/`textarea`, checkbox, radio,
`table`/`th`/`td`, `a` and `:focus-visible` already look on-brand --
site font, token padding and radius, borders, a visible focus ring,
bold table headings -- instead of falling back to the browser (or, for
`button`, to bare text). A bare `<button>` reads as `btn--secondary`.
`select` draws its own chevron (no native arrow, which can't be
recoloured); `[hidden]` always hides, even on an element whose class
sets its own `display`; `dialog::backdrop` is the one scrim every modal
gets. Because components sit in a higher layer, any property a
component sets of its own still wins -- base.css is only what's left to
the browser when nothing else styles it.

## 4. Primitives (`src/styles/primitives/`)

Short class names, no component prefix (the `c-<block>` prefix stays for
components). Each file's own header comment is the source of truth;
this section mirrors it.

### Button (`button.css`)

```html
<button class="btn btn--primary" type="button">Save</button>
<button class="btn btn--secondary" type="button">Cancel</button>
<button class="btn btn--quiet" type="button">Show more</button>
<button class="btn btn--danger" type="button">Delete</button>
<button class="btn btn--secondary btn--sm" type="button">Edit</button>
<button class="btn btn--quiet btn--icon" type="button" aria-label="Close">×</button>
<button class="btn btn--secondary btn--icon btn--round" type="button" aria-label="Close">×</button>
<button class="btn btn--overlay btn--icon btn--md btn--round" type="button" aria-label="Next picture">›</button>
<button class="btn btn--primary btn--block" type="submit">Continue</button>
<a class="btn btn--secondary" href="/me">A link that looks like a button</a>
<button class="btn btn--secondary" type="button" aria-pressed="true">Speech</button>
<button class="btn btn--quiet btn--sm" type="button" aria-pressed="false">newest first</button>
```

Works on a `<button>` or an `<a>`. `btn--primary` is the gradient;
`btn--secondary` is also the bare, unclassed default; `btn--quiet` is
text-like (no surface); `btn--danger` outlines the danger colour.
`btn--icon` is square and has no text of its own, so it needs
`aria-label`; `btn--sm`/`btn--md` combine with any variant, `btn--icon`
included (`btn--sm` is the small control, `btn--md` the one between it
and the default). `btn--round` is a sheet/dialog's round close button.
`btn--overlay` is a control over a picture or clip: a white glyph on a
dark wash, the same in both themes. `btn--block` fills its container. A
toggle button says its state with `aria-pressed`: pressed, it takes the
label tint, except a quiet toggle, which stays text (muted off, bold
label colour on). `aria-busy="true"` (a button waiting on its own
request) dims it like `:disabled`.

### Field and check (`field.css`)

```html
<div class="field">
  <label class="field__label" for="name">Name</label>
  <input id="name" type="text" aria-describedby="name-hint">
  <p class="field__hint" id="name-hint">As it shows on your posts.</p>
</div>

<div class="field">
  <label class="field__label" for="event">Event</label>
  <span class="field__select"><select id="event"></select></span>
  <p class="field__error" id="event-error">Pick an event.</p>
</div>

<label class="check"><input type="checkbox"> Already subbed</label>
<label class="check"><input type="radio" name="mode"> Any of</label>
```

A label, its control, an optional hint and an optional error, stacked.
The control's own look (border, radius, padding, the select chevron)
comes from `base.css`; `field` makes it full width, `--tap-target` tall
and `--text-14`. `field__select` is the dropdown's wrapper (this was
`.c-select`): `base.css`'s `select` already draws the chevron, so the
wrapper only sizes the select to the field's width. A control with an
error gets `aria-invalid="true"` (the danger border). `check` is a
checkbox or radio with its text, the label itself the target, at least
`--target-min` tall.

### Card (`card.css`)

```html
<div class="card">Default padding</div>
<div class="card card--compact">A dense list row</div>
<section class="card card--roomy">A form or a welcome panel</section>
<article class="card card--flush">A picture to the edges, then text with its own padding</article>

<article class="card card--flush">
  <a class="card__link" href="/item/1">The whole card is this link</a>
</article>
```

The raised surface results, forms and panels sit on. `card--flush` has
no padding of its own, for a card whose picture runs to its edges or
whose stretched link carries the padding. `card__link` is the card's
main link, stretched over the whole card so it's one click target with
one focus ring; a second link inside it (a credit line) stays clickable
by lifting itself above the overlay with its own `position: relative`
and `z-index`.

### Table (`table.css`)

```html
<table class="table table--stack">
  <thead>
    <tr><th>Name</th><th class="table__num">Items</th><th class="table__actions">Actions</th></tr>
  </thead>
  <tbody>
    <tr>
      <td data-label="Name">Moon</td>
      <td class="table__num" data-label="Items">12</td>
      <td class="table__actions" data-label="Actions">
        <div class="cluster cluster--2">
          <button class="btn btn--secondary btn--sm" type="button">Edit</button>
        </div>
      </td>
    </tr>
  </tbody>
</table>
```

On a `<table>` with a header row (`base.css` draws the row dividers and
bold headings; `table` adds the column types and the phone layout).
`table--stack`: below the desktop breakpoint each row becomes a card
and each cell shows its column's name (its `data-label`) above its
value; the header row is hidden visually but kept for screen readers. A
cell's long unbroken text (a handle, a URL) wraps rather than widening
the page -- never add `white-space: nowrap` to a text cell.

### Chip (`chip.css`)

```html
<button class="chip" type="button" aria-pressed="false">live</button>
<button class="chip chip--on" type="button" aria-pressed="true">posts</button>
<button class="chip" type="button">waiting <span class="chip__count">12</span></button>
<a class="chip" href="/tag/starfest">#starfest</a>
<button class="chip chip--lg" type="button" aria-pressed="false">host</button>
```

A filter or tag pill, on or off, with an optional count. Its size is its
content plus `--chip-pad-y`/`--chip-pad-x`, never a fixed height, but
never under `--target-min`. `chip--lg` is the bigger, bold pick
(`--control-md` tall): a person or role in a picker.

### Badge (`badge.css`)

```html
<span class="badge">fan-made</span>
<span class="badge badge--accent">translator</span>
<span class="badge badge--danger">failed</span>
```

A small, non-interactive label. `badge--danger` is outlined on the card
surface (the danger colour on its own tint is under 4.5:1 at this
size).

### Notice (`notice.css`)

```html
<p class="notice notice--info" role="status">Saved. It shows on the archive in a minute.</p>
<p class="notice notice--error" role="alert">That link isn't a post on X.</p>
<div class="notice notice--accent">Not published yet: only you can see this.</div>
<p class="notice notice--strong" role="status">Held: only you can see this entry.</p>
<p class="notice notice--quiet">Original tweet is no longer available. Translation kept below.</p>
```

A banner or inline message. `notice--info` has no look of its own
beyond the bare `notice` default, spelt out for callers that want to say
so. `notice--error` is outlined (same contrast reason as `badge--danger`).
`notice--accent` is the "not published" bar; `notice--strong` is the
solid bar for a state the viewer must not miss; `notice--quiet` is the
soft, centred stand-in for something that isn't there (a deleted post's
picture or clip).

### Segmented (`segmented.css`)

```html
<div class="segmented" role="group" aria-label="View">
  <button class="segmented__option" type="button" aria-pressed="true">By event</button>
  <button class="segmented__option" type="button" aria-pressed="false">All, newest</button>
</div>
```

A view switch drawn as one pill track: the chosen option tinted with
the label colour, the others muted text. Each option says it's chosen
with `aria-pressed="true"` (or, for a link, `aria-current="page"`); its
target is at least `--target-min` tall, and the options share the
track's width evenly.

### Text helpers (`text.css`)

```html
<p class="meta">@tl_gamma · 21 Oct 2026</p>
<h2 class="label">october 2026</h2>
<h2 class="label label--section">october 2026</h2>
<a class="meta tap-link" href="/">‹ events</a>
<a class="tap-link tap-link--sm" href="https://x.com/">original tweet</a>
<h1 class="heading heading--lg">Import review</h1>
<h2 class="heading heading--md">Speakers</h2>
<h3 class="heading heading--sm">Check the details</h3>
```

`meta` is small muted text. `label` is a small, heavy, label-coloured
heading; `label--section` adds room above and a little below, for
labelling a list. `tap-link` is a small text link whose target is still
`--tap-target` tall (pair it with `meta` for a muted one); `tap-link--sm`
is one inside a row of small controls, `--control-sm` tall like
`btn--sm`. `heading` sets the look, never the level -- pick the element
(`h1`/`h2`/`h3`) for the outline and the class (`heading--lg`/`--md`/
`--sm`) for the size.

### Spacing and layout (`spacing.css`)

```html
<div class="stack stack--3">...</div>
<div class="cluster cluster--2">
  <button class="btn btn--secondary btn--sm" type="button">Edit</button>
  <button class="btn btn--danger btn--sm" type="button">Remove</button>
</div>

<div class="cluster cluster--fill" role="tablist">
  <button class="chip chip--lg chip--on" type="button" role="tab" aria-selected="true">By event</button>
  <button class="chip chip--lg" type="button" role="tab" aria-selected="false">All</button>
</div>
```

`stack` is a column with a gap (default `--space-3`); `cluster` is a
wrapping row with a gap (default `--space-2`). The number suffix
(`--1` through `--6` on `stack`, `--1` through `--4` on `cluster`) is
the `--space-<n>` step. `cluster--fill` keeps one row and shares its
width evenly between the children, their content centred -- a view
switch.

### Shared: the sheet and the container

Not a primitive file, but used by more than one screen so it doesn't
belong to any one component. `src/styles/components/sheet.css`'s
`c-sheet` is the shared bottom-sheet/modal `<dialog>` shell (opened with
`showModal()`; `base.css` dims the page behind it):

```html
<dialog class="c-sheet" aria-label="Filters">
  <button class="btn btn--secondary btn--icon btn--round c-sheet__close" type="button" aria-label="Close">×</button>
  <h2 class="heading heading--sm c-sheet__title">Filters</h2>
</dialog>
```

`src/styles/layout.css`'s `.container` is the page column every
`pageShell` wraps `main` in (`720px`, `960px` from the breakpoint);
`.container--wide` raises that to `1200px` for a page that needs the
room (the import review's table), via `pageShell.render`'s `wide` option
(section 5).

```html
<main class="container">...</main>
<main class="container container--wide">...</main>
```

## 5. The shell is not optional

`mountPage(root, safeHtml)` (`public/js/core/dom.js`) only accepts
`ShellHtml`, the type only `pageShell.render()` returns -- a page can't
mount without going through it, so the header, tab bar and footer are
never a step a new page can forget. `render({ active, compact, wide,
headerProps, content })`: `wide` adds `container--wide` to `main` (the
import review's table needs the room); `headerProps` is for a page with
its own in-place search row; a page with no header would need a new,
named, documented option here, never a second mount function.

## 6. When to write component CSS

A component file (`src/styles/components/<name>.css`) holds only this
screen's own genuinely unique layout and look -- never a primitive's
look rebuilt by hand. Lint enforces both halves, inside
`src/styles/components/*.css` only:

- `selector-disallowed-list` rejects a selector naming a primitive
  class (`btn`, `field`, `check`, `card`, `table`, `chip`, `badge`,
  `notice`, `meta`, `label`, `heading`, `stack`, `cluster`) at a real
  boundary -- a component never re-opens a primitive's own rule.
- `local/no-rebuilt-primitive` (`scripts/stylelint/no-rebuilt-primitive.js`)
  rejects a button- or field-like selector (a `button`, `select`,
  `textarea`, a non-checkbox/radio `input`, or a class ending in
  `__btn`/`__button`/`__submit`/`__save`/`__next`/`__apply`/`__more`/
  `__field`/`__input`/`__control`/`__search`/`__textarea`/`__select`)
  that declares a background, a `border-radius` and a `padding*`
  together -- the three together are what a hand-rebuilt control looks
  like.

```css
/* Not allowed in a component file -- rebuilds the button primitive
   instead of using it: */
.c-widget__more {
  background: var(--color-card);
  border-radius: var(--radius-md);
  padding: var(--space-2) var(--space-4);
}

/* Allowed -- layout specific to this one screen, no primitive look
   rebuilt: */
.c-widget__grid {
  display: grid;
  gap: var(--space-4);
  grid-template-columns: repeat(2, 1fr);
}
```

`npm run new component <name>` scaffolds `src/styles/components/<name>.css`
with a header comment pointing back to this file.

## 7. Dev tools

### `/dev/styleguide`

Reachable only in local dev (`npm run dev`); never built into `public/`,
never deployed. Every primitive and element default, in every variant,
light and dark -- from the OS/browser's own `prefers-color-scheme`,
nothing to toggle on the page -- rendered from the real built
`app.css`/`fonts.css` (`dev/styleguide/index.html.tmpl`, built by
`scripts/styleguide.js`). It also shows each font role in each weight
actually in use.

### `npm run screens`

```sh
npm run screens [-- --db <dir>] [-- --out <dir>] [-- --only <substring>]
```

A gallery of every page for every role (owner, translator, member,
guest), at `390×900` and `1280×900`, light and dark -- for a person to
look at, **never** a pass/fail test. Without `--db`, it builds the site
under `SITE_DIR` (default: the bundled example) and seeds a fresh,
temporary database from the site's `seed/`, touching nothing in
`.devdb`; with `--db <dir>`, that directory is used as-is (a site's own
`site/Taskfile.yml`'s `task screens` points this at `.devdb`). `--out`
(default `.screens/`, gitignored) gets `<role>/<width>-<theme>/<name>.png`
plus a static `index.html` linking them all, grouped by page then role.
`--only <substring>` narrows the run to pages whose name contains it.

**Definition of done for UI work:** run `npm run screens` and look at
the changed screens next to their mockup before calling it done
(`CONTRIBUTING.md`'s Workflow section says the same).

### Real data, any role

```sh
DATABASE_URL='<production string>' npm run pull-prod   # the app role is enough: it only reads
DEV_AS=owner PGLITE_DIR=.devdb npm run dev              # owner | translator | member | google | guest
```

`npm run pull-prod` (`scripts/pullProd.js`) rebuilds a local PGlite
database from this checkout's migrations and copies every production
table except login sessions and rate limits; it stops if production
applied different migrations than this checkout. `DEV_AS` signs a
browser in on its first page load; switch roles any time with `GET
/api/auth/dev?as=<role>[&handle=<x handle>]` (`src/routes/authDev.js`) --
both only exist locally (`VERCEL` unset), never in production.

## 8. The checks that will fail, and how to fix each

| Check | Fails on | Fix |
|---|---|---|
| `color-no-hex` / `function-disallowed-list` (stylelint) | a literal hex/`rgb()`/`rgba()`/`hsl()`/`hsla()` colour outside `tokens.css` or a site's `theme.css` | use a colour token (`var(--color-...)`); add one to `tokens.css` first if it's genuinely missing |
| `declaration-property-unit-disallowed-list` (stylelint) | a literal `px` on `padding*`/`margin*`/`gap`/`border-radius`/`min-height` | use a spacing/radius/control-size token |
| `declaration-property-value-disallowed-list` (stylelint) | a `border`/`border-*-width` other than `0`, `1px`, `1.5px` or `2px` | use one of those hairline widths |
| `media-feature-name-value-allowed-list` (stylelint) | a `min-width`/`max-width` other than `860px`/`859.98px` | match the breakpoint literal exactly (section 2) |
| `no-duplicate-selectors` (stylelint) | the same selector twice in one file | merge the two rules |
| `at-rule-disallowed-list: layer` (stylelint) | a hand-written `@layer` | delete it -- the build assigns the layer by folder |
| `selector-disallowed-list` (stylelint, `components/*.css` only) | a selector naming a primitive class at a real boundary | don't restyle a primitive from a component file; use the component's own `c-<block>` class |
| `local/no-rebuilt-primitive` (stylelint, `components/*.css` only) | a button-/field-like selector declaring background + `border-radius` + `padding*` together | use the `btn`/`field` primitive instead of rebuilding it |
| `test/styles/classUsage.test.js` | a class used in `public/js`/the style guide template with no matching CSS selector, or vice versa; or a class/token in this doc's own code blocks that isn't real | add the missing rule, or delete the dead class/selector; keep this doc's examples matched to the real classes and tokens |
| `test/site/themeTokens.test.js` (the theme test) | a site `theme.css` sets a custom property `tokens.css` doesn't define, or a font token names a family that's neither the engine's own nor declared in that site's `fonts` | override only existing tokens; declare a font (`docs/site-settings.md`, "Fonts") before pointing a role at it |
| e2e `checkPage`'s structure assertions (`e2e/helpers.js`, every `e2e/*.spec.js` page) | no `<header>`/`main.container` | mount through `pageShell.render()` + `mountPage()` (section 5) |
| | a visible button/input/select/textarea not in the body font | don't set a literal `font-family` outside `var(--font-body)`/`var(--font-heading)`/`var(--font-script)` |
| | a control under 24×24 CSS px (checkbox/radio measured on its label) | raise its size to at least `--target-min` |
| | a `<table>` with no header row | add a `<thead><tr><th>` row (needed for `table--stack`'s `data-label`s too) |
| | dark mode showing a site's light `--color-bg` | never put a dark value on a plain `:root` inside the device media query |
