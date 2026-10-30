# Site settings

A real archive's configuration lives in `site/` (gitignored in this
template). `npm run init-site` copies the template's fictional example,
`examples/solluna/`, into `site/` to start one. It finds the example at
runtime rather than naming it in engine code: the single folder under
`examples/`, or the one passed as `npm run init-site -- --example <name>`
when there's more than one. If there are several and none is named, it
refuses with a hint listing them. This doc describes every field,
generated from `src/site/schema.js` and `src/site/fieldValidators.js`
(the source of truth -- validation errors always name the exact field
path).

## `site/site.json`

| Field | Type | Required / default | Notes |
|---|---|---|---|
| `name` | string | required | The archive's full name, e.g. `"solluna archive"`. |
| `wordmark.accent` | string | required | The part of the wordmark shown in the brand gradient, e.g. `"sol"`. |
| `wordmark.rest` | string | required | The rest of the wordmark, shown plain, e.g. `"luna archive"`. |
| `tagline` | string | required | Shown under the wordmark with the FAN-MADE badge. |
| `ownerXUserId` | string of digits | required | The owner's numeric X user ID (never the handle; handles change). |
| `sourceLanguage` | string | required | The language translations are from, e.g. `"th"`. |
| `timezone` | IANA zone | required | Every "which day" calculation uses this zone, never UTC or the viewer's. Checked with `Intl.DateTimeFormat`. |
| `region` | Vercel region code | default `"sin1"` | Must be one of the current Vercel serverless function regions (`src/site/regions.js`'s `ALLOWED_REGIONS`, from vercel.com/docs/regions). Pick the one nearest your database and your fans. |
| `lowercaseNames` | boolean | default `false` | When true, `formatName()` lowercases every display name site-wide. |
| `featuredPeople` | `FeaturedPerson[]` | required, non-empty | See below. |
| `defaultMarkers` | `Record<string, { personHandle } \| { role }>` | default `{}` | Maps a speaker marker (e.g. an emoji) to a featured person's `igHandle` or a generic role. A line that starts `: ` then words (no emoji before the colon) has the marker `":"`, shown as "(no emoji)" and mapped like any other. |
| `ignoredHashtags` | string[] | default `[]` | General hashtags never used for event grouping. |
| `categories` | string[] | default `['show / interview', 'fan meet / fan day', 'live']` | The event/item type list the owner manages. |
| `extraLivePatterns` | `LivePattern[]` | default `[]` | Extra "who + where + when" live platform phrases (see below). |
| `contactUrl` | https URL | required | The one public contact (a form or profile link) -- never a personal email. |
| `embedSources` | boolean | default `false` | When true, a translation page shows its original post as X's official embed (X's `widgets.js`, loaded only on pages with an embed), with the archived text and author as the fallback inside it; the build adds X's hosts to the CSP, and the privacy page gains a notice that X may set cookies and collect visitor data. Review that notice (`privacy.embedNotice` in `site/copy.json`) before turning it on. When false (the default), the page links to the original post instead and loads nothing from X. |
| `roleEmoji` | `{ fan?, host?, speaker? }` of strings | default `{}` | Overrides the default emoji a generic role shows when the translator's marker had none (a bare `:`): 💬 fan, 🎤 host, 🗣 speaker. A translator's own emoji always wins; crowd has none (it shows as an inline note). E.g. `{ "host": "🎙️" }`. |
| `favicon` | path | default: the logo | The browser-tab icon and apple-touch-icon: a `.png` or `.svg` file inside the site folder, as a relative path (e.g. `"favicon.png"`). Left out, the site's `logo.svg` / `logo.png` is used. A square PNG of at least 180×180 works everywhere; iOS ignores an SVG touch icon. The build copies it content-hashed into `/build/`. |
| `fonts` | `SiteFont[]` | default `[]` | The site's own self-hosted fonts, beyond the engine's Nunito and IBM Plex Sans Thai. See "Fonts" below. |

### `FeaturedPerson`

| Field | Type | Notes |
|---|---|---|
| `igHandle` | string | The person's Instagram handle -- their unique identity. Must be unique within `featuredPeople`. |
| `displayName` | string | Shown next to their emoji everywhere. |
| `emoji` | string | Their standard emoji. |
| `colour` | `#rrggbb` | Must reach a contrast ratio of at least 3:1 (WCAG relative luminance) against both the light card colour (`#fffdf8`) and the engine's dark-mode card colour (`src/styles/tokens.css`'s dark `--color-card`). |
| `otherAccounts` | `OtherAccount[]` | Optional, default `[]`. This person's other platform accounts -- what the owner's "post" placement recognises their own social posts through (a later ruling). |

### `OtherAccount`

| Field | Type | Notes |
|---|---|---|
| `platform` | string | One of `x`, `instagram`, `tiktok`, `youtube`, `weverse`, `telegram`. |
| `handle` | string | Normalised: a leading `@` is stripped and it's lowercased, so `"@SolSunny_X"` and `"solsunny_x"` validate the same. Must be non-empty after that. |

### `defaultMarkers` entries

Each value is either:
- `{ "personHandle": "<an igHandle from featuredPeople>" }`, or
- `{ "role": "<a role in ROLES>" }` -- `ROLES` is `['host', 'fan', 'speaker', 'crowd']` (`src/domain/constants.js`).

### `LivePattern`

| Field | Type | Notes |
|---|---|---|
| `code` | string | A short identifier for the pattern. |
| `platformCode` | string | Which platform this live pattern is for. |
| `pattern` | string | The phrase that identifies a live on that platform, e.g. `"TikTok live"`. |

## `site/theme.css`

Only overrides custom properties already defined in the engine's
`src/styles/tokens.css` (brand gradient, paper/card/ink colours,
dark-mode values, font families). It must never define a new token: a
site's `theme.css` and `copy.json` only ever override the engine's
defaults, so a new engine token never breaks an older site.
`scripts/build.js` fails the build if any engine CSS references a token
`tokens.css` doesn't define.

The colour tokens a site usually sets:

| Token | Used for | Default |
|---|---|---|
| `--gradient-from`, `--gradient-to` | The brand gradient: the wordmark and accent buttons. | An orange-to-pink pair. |
| `--color-label` | Accent **text**: month and section headings, the active tab and toggles, result-card event names, and open-profile and contact links. Also tints the home count badges, active filter chips and the person/translator view switch (through `--color-label-tint` and `--color-label-on-tint`, which derive from it, so you rarely need to set them). | `var(--gradient-to)` |
| `--color-highlight` | The search match highlight, behind ink text. | Pale peach (light), dark amber (dark). |
| `--color-bg`, `--color-card`, `--color-ink`, `--color-ink-muted` | Paper, cards, text and secondary text. | Warm paper, cream cards, near-black ink. |
| `--color-accent-text` | Text on a solid gradient surface (buttons, counts). | White (light), black (dark). |

`--color-label` is text, so it needs WCAG AA contrast (4.5:1) against
both `--color-bg` and `--color-card`, in light and dark mode. Since it
defaults to `--gradient-to`, a site that keeps that default must pick a
`--gradient-to` dark enough to read. To keep an exact brand gradient
that's too light for text, set `--color-label` to a separate, darker
colour instead, and set it again in the dark blocks (below) with a value
that reads on the dark backgrounds. `npm run e2e:site` checks contrast on
every page.

### Light and dark

Visitors can switch the theme with the header's switch (light, dark, or
follow the device); their choice sets `data-theme="light"` or
`data-theme="dark"` on `<html>`, and following the device sets neither.
The engine's `tokens.css` writes its dark values twice, on selectors more
specific than a plain `:root`:

- `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { … } }`:
  a dark device, unless the visitor forced light;
- `:root[data-theme="dark"] { … }`: forced dark, whatever the device.

Both are specificity (0,2,0); a plain `:root` is (0,1,0). That decides
how a site's `theme.css` must be written:

- **Light values go on a plain `:root`.** It works because the engine's
  dark blocks outrank it wherever dark applies, and nothing outranks it
  anywhere else. Don't use `@media (prefers-color-scheme: light)`: a
  visitor forcing light on a dark device wouldn't get it, and would see the
  engine's light defaults instead of yours.
- **Dark values go in the same two blocks, identical.** A dark value on a
  plain `:root` inside `@media (prefers-color-scheme: dark)` (the pre-0.1.3
  pattern) loses to the engine's dark blocks, so it never shows -- not even
  on a device in plain dark mode -- and on a dark device forced to light it
  still applies, mixing into the light page.
- **Repeat light-only tokens in your dark blocks.** A token you set on
  `:root` for light that the engine's dark blocks don't set themselves
  (for example `--gradient-from`; the engine's dark blocks set only the
  paper, card, ink, `--gradient-to`, `--color-label`, `--color-highlight`
  and `--color-accent-text` tokens) carries into dark unless your dark
  blocks set it again.

A worked example: a site with its own paper, label colour and gradient.

```css
/* Light: everywhere the dark blocks below don't apply. */
:root {
  --color-bg: #f6efe3;
  --color-label: #7048e0;
  --gradient-from: #d9541a;          /* darkened for the light paper */
  --gradient-to: #cb206d;
}

/* Dark on a dark device, unless the visitor forced light. */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --color-label: #a58cff;
    --gradient-from: #ff6a2b;        /* repeated: the engine's dark blocks don't set it, so the light value would leak */
    --gradient-to: #e2468c;
  }
}

/* Forced dark, whatever the device: identical to the block above. */
:root[data-theme="dark"] {
  --color-label: #a58cff;
  --gradient-from: #ff6a2b;
  --gradient-to: #e2468c;
}
```

`--color-bg` needs no dark value of its own here: the engine's dark blocks
set it, and they outrank the light `:root`.

## Fonts

By default a site can only pick between the two families the engine
self-hosts, Nunito and IBM Plex Sans Thai (`FONT_SPECS` in
`scripts/buildAssets.js`) -- the CSP (`font-src 'self'`) blocks any
hosted font service, so any other family otherwise means an engine
change. A site can self-host its own font instead, in two steps: declare
it in `site/site.json`'s `fonts`, then point a font role at it in
`site/theme.css`.

### Declaring a font (`site/site.json`'s `fonts`)

Each entry names a family and ships it from one of two routes:

| Field | Type | Notes |
|---|---|---|
| `family` | string | The name used in the built `@font-face` rule and in `theme.css`'s token value. |
| `style` | `'normal'` \| `'italic'` | Default `'normal'`. |
| `weights` | `number[]`, 100-900 | Route 1 only (below); route 2's `weights` is derived from `files[].weight` and never written by hand. |

**Route 1, an `@fontsource/*` package:** install it as a dev dependency
(the same way the engine installs its own Nunito and IBM Plex Sans
Thai), then name the package and the subsets to ship:

```json
{ "family": "Some Display", "package": "@fontsource/some-display", "subsets": ["latin"], "weights": [400, 700] }
```

The build fails, naming the font and the missing weight, if the package
doesn't actually ship one of the requested weights at any of the
requested subsets.

**Route 2, the site's own files:** `.woff2` files under `site/fonts/`
(the CSP allows no other format from a site), each entry naming its own
weight, and optionally its style and a `unicode-range` (for a subsetted
font):

```json
{
  "family": "Our Own Font",
  "files": [
    { "path": "our-own-font-regular.woff2", "weight": 400 },
    { "path": "our-own-font-bold.woff2", "weight": 700 }
  ]
}
```

`path` is relative to `site/fonts/`. The build fails, naming the font
and the file, if a `files[].path` isn't actually there.

### Pointing a role at it (`site/theme.css`)

`site/theme.css` sets one of the three font-role tokens
(`src/styles/tokens.css`): `--font-body` (everything), `--font-heading`
(h1-h3 and the heading primitive; defaults to `--font-body` until set)
or `--font-script` (Thai and other `lang`-marked text):

```css
:root {
  --font-heading: 'Our Own Font', var(--font-body);
}
```

A `fonts` entry no token ever names (in `tokens.css` or `theme.css`)
isn't shipped into `fonts.css` at all -- declaring a font and a token
actually using it are different things. A font token naming a family
that's neither one of the engine's own nor declared in `fonts` fails the
engine's theme checks. The dev-only style guide (`/dev/styleguide`)
shows each font role in each weight actually in use.

## `site/copy.json`

Every key must already exist -- in the engine's `src/site/copyDefaults.json`
or in a kind's own `copy.json` (`src/kinds/<kind>/copy.json`) -- so a
site's wording stays within the engine's namespaced keys (`nav.home`,
`badge.fanMade`, `item.sourceGone`, `account.optedOut`, `footer.unofficial`,
…). A key that doesn't already exist is an error ("unknown copy key"),
which keeps every piece of user-facing wording translatable and
discoverable in one place. `scripts/build.js` also fails if any `t('key')`
call in engine code uses a key the merged copy doesn't define.

## `site/logo.svg` (or `.png`)

The archive's logo, copied into `public/site/` at build time.

## `site/seed/` (optional)

Synthetic sample data for local development (`npm run seed-dev`). Never
real translation text.

## Loading and building

- `loadSite(dir = process.env.SITE_DIR ?? 'site')` reads and validates
  `site.json`, throwing `SiteConfigError` (with every error) if it's
  missing or invalid.
- `loadCopy(dir)` merges the engine defaults, then every kind's
  `copy.json` (sorted), then the site's own `copy.json`.
- `npm run build` validates everything above and writes the generated
  files (`src/site/generated.js`, both kinds registries, `public/site/*`,
  the bundles in `public/build/`, the pages `public/*.html` built from
  their `src/html/*.html` templates, and `vercel.json`). The engine
  gitignores all of them, so a rebuild never changes a tracked file and
  an engine upgrade never conflicts on one. One exception, on purpose:
  a site deployed through Vercel's Git integration un-ignores and
  commits its own `vercel.json`, because Vercel reads it before it runs
  the build (`docs/start-your-own.md`, step 2).
- `npm run doctor` reports whether a site's setup is healthy (Node
  version, `site/` present, settings valid, env vars, and -- if an
  `upstream` remote is configured and reachable -- the engine version).
