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
So a site's dark values go in **two identical blocks**, exactly like the
engine's own `tokens.css`, and its light values go on a plain `:root`:

```css
:root {
  --gradient-to: #6456c9;            /* light */
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --gradient-to: #8276dd;          /* device dark, unless forced light */
  }
}

:root[data-theme="dark"] {
  --gradient-to: #8276dd;            /* forced dark */
}
```

Don't put light values under `@media (prefers-color-scheme: light)`: a
visitor who forces light on a dark device would get the engine's light
defaults instead of yours, and one who forces dark on a light device
keeps any light value the engine's dark block doesn't also set. A plain
`:root` block is light wherever the dark blocks don't apply.

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
