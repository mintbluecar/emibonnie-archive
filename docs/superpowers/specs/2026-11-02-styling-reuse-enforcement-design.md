# Styling reuse, enforced

Date: 2026-11-02. Status: design, approved in conversation; not yet planned.

## Why

The styling framework (`STYLING.md`: tokens, primitives, per-screen
component CSS, lint) exists so screens are built by composing shared
pieces. A recent change (the me page grouped into month/event cards)
showed it doesn't hold in practice:

- The change copied home's card grid into a new component file. Home's
  grid was itself already a copy of the translation kind's grid
  (`homeMonth.css` and `kindTranslation.css` have identical rules).
- It widened a test allow-list (`test/site/textCase.test.js`) to let the
  copy through, instead of reading the failure as "this already exists".
- It was done on `main`, though `CONTRIBUTING.md` says to branch first.

Why it happened:

1. **No layout primitives.** Primitives cover controls, text, cards and
   spacing (`stack`, `cluster`). A grid or a plain list has no shared
   home, so the only place to write one is a screen's own file, and
   copying the nearest example is the easiest path.
2. **Nothing checks reuse.** Lint enforces tokens and "don't restyle a
   primitive", but no check notices one screen repeating another's rules.
3. **The rule is buried.** `STYLING.md` is 575 lines; "component CSS is
   only for this screen's unique layout" is at line 468. The agent read
   the first 260 lines and stopped. Stylelint's messages don't carry the
   fix; that lives in the doc's last section.
4. **Nothing enforces the branch rule.** It's one line of text.

If a practice isn't enforced in this app's own development, the
framework has no point.

## Who this is for

Mostly Claude sessions working in this repo. Other people adding to the
template are out of scope for now.

## Goals

- Reusing an existing style is easier than copying it.
- Copying is caught by `npm run check`, and the failure says what to do.
- Screens can still adjust a shared layout to their needs.
- What Claude must read before UI work is short enough to read fully.
- Edits and commits on `main` are refused, in this repo and in site repos copied from it.

## Non-goals

- Rewriting `STYLING.md` wholesale. Only a short rules card is added; the
  rest stays as reference.
- Guardrails aimed at non-Claude contributors (git hooks, CI-only rules
  beyond what `npm run check` already runs).

## Anti-goals

- **A pile of narrow rules.** One lint rule per pattern (grids, lists,
  gradients...) is what the owner wants to avoid: Claude can't know which
  exist, and each new pattern would need its own. Prefer one general
  mechanism.
- **Locked primitives.** A shared layout that a screen can't adjust
  pushes people back to copying.
- **Noise.** A check that flags coincidences (`flex: 1; min-width: 0`)
  trains everyone to suppress it.

## The design

### 1. Layout primitives with settings

Add primitives for the layouts that are repeated today:

- **`grid`**: the card grid used by home, the translation section (and the
  redone me page). Same values as today: 150px min columns and
  `--space-2` gap on a phone, 190px and `--space-3` at `min-width: 860px`.
- **`list`**: the unstyled list (`list-style: none; margin: 0; padding: 0`),
  repeated in four files.

A primitive exposes **settings**: CSS custom properties with defaults,
listed in the primitive file's header comment. A screen adjusts it by
setting them on its own `c-<block>` class, never by naming the primitive
or re-declaring its properties, so the existing `selector-disallowed-list`
lint keeps passing:

```css
/* primitives/grid.css */
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(var(--grid-min, 150px), 1fr));
  gap: var(--grid-gap, var(--space-2));
}

/* a screen that wants wider cards */
.c-example__grid { --grid-min: 200px; }
```

Common variants can be modifiers (`grid--…`), as `btn--sm` is today.
The new primitives join `selector-disallowed-list`, the style guide
(`dev/styleguide`), and `STYLING.md` section 4.

Settings are **screen-only**, not site-facing: they live as `var()`
fallbacks in the primitive, never in `tokens.css`, so a site's
`theme.css` can't set them and `themeTokens.test.js` is untouched.
`STYLING.md` names them in prose (and the primitive's header comment),
not in a CSS code block, so `classUsage.test.js`'s doc check needs no
change. *(My call.)*

The exact setting names and the desktop step (settings switched in a
media query inside the primitive, versus a modifier) are left to the
builder, as long as home and the translation section render exactly as
they do now.

### 2. One general duplicate check

A step in `npm run check` fails when a rule in `src/styles/components/`
has the same declarations (3 or more, compared as a set, in the same
media context) as a rule in another component file or in
`src/styles/primitives/`.

Its message carries the fix, for example:

> `meGroups.css .c-me-groups__grid` repeats `homeMonth.css .c-home-month__grid`
> (display, gap, grid-template-columns). Use the existing class, or move
> the rule into `src/styles/primitives/` and use it from both. See
> STYLING.md "Rules card".

Coincidences that aren't a shared pattern can be marked on the rule with
a comment stating why (e.g. `/* not shared: <reason> */`), which the
check accepts. The marker is visible in review, so it's not a silent
escape hatch. *(My call: the threshold of 3 and the comment marker. The
owner can change either.)*

Matching is **exact**: the same set of property-value pairs. Measured on
today's CSS this gives exactly the seven groups below; a subset match
gives 121 pairs and property-names-only 47, both noise. The known
limit: a copy with one value changed (`150px` to `160px`) or one extra
declaration passes. The rules card covers that case in words; the check
does not try to. *(My call, from the noise anti-goal.)*

It is one check for every pattern, not one per pattern: a grid, a list,
a gradient or anything new is caught the same way.

### 3. Fix what the check flags today

On `main` today the check would flag seven groups:

| Repeated rule | Files | Likely fix (builder confirms) |
|---|---|---|
| card grid | `homeMonth.css`, `kindTranslation.css` | `grid` primitive |
| list reset | `adminImport.css`, `edit.css`, `me.css`, `owner.css` | `list` primitive |
| gradient text accent | `header.css`, `signIn.css` | a primitive or text modifier |
| space-between row with bottom margin | `me.css` `.c-me__head`, `owner.css` `.c-owner__alert` | judge: share, or mark not shared |
| 13px wrapping line | `bubbles.css`, `resultCard.css` | judge |
| top-aligned flex row | `bubbles.css`, `me.css` `.c-me__entry-top` | judge |
| absolute top-right control | `sheet.css`, `videoPlayer.css` | judge |

Every promoted one must render unchanged: `npm run screens` before and
after, compared for the affected pages.

### 4. A rules card Claude reads in full

Add a short section at the top of `STYLING.md`, about 20 lines, that is
the whole of what must be followed:

- compose primitives first; a screen's file is only for its own unique
  layout
- before writing a rule, search `src/styles/` for the same properties;
  if it exists, reuse it
- if a second screen needs something, promote it to a primitive (with
  settings) instead of copying
- a failing style check or test is a signal, not a list to edit:
  widening an allow-list needs the owner's say
- where each check's fix is documented

`CLAUDE.md`'s UI line points at this card by name instead of the whole
file. The rest of `STYLING.md` stays as reference.

### 5. Branch hook

A Claude Code `PreToolUse` hook in the project's `.claude/settings.json`
(committed) refuses, while the checked-out branch is `main`:

- `Edit`, `Write` and `NotebookEdit`
- a `Bash` command that runs `git commit`

with a message saying to create a branch first. Writes made through
other Bash commands (`sed`, heredocs) can't be reliably detected and are
not blocked; blocking `git commit` means they can never land on `main`.
Blocking all Bash on `main` was rejected: it would stop harmless reads.
*(Owner, 2026-11-02.)*

Site repos copied from this one inherit the hook; it is not removed by
the site setup steps. *(Owner, 2026-11-02.)*

## Order of work

1. Branch hook (smallest, protects the rest).
2. `grid` and `list` primitives, moving home, the translation section and
   the four list files onto them.
3. The duplicate check, then resolve the remaining flagged groups.
4. Rules card and the `CLAUDE.md` pointer; update `STYLING.md` sections 4,
   6 and 8 for the new primitives and check.
5. Separately, on its own branch: redo the me page's grouped cards on top
   of the new primitives. The earlier attempt is saved as a git stash
   ("me page: grouped cards ..."); its API and grouping logic can be
   reused, its CSS cannot.

## Left to the builder

- Setting names and the desktop-step mechanism for `grid`.
- Where the duplicate check lives (a `scripts/lintStyles.js` step or a
  test in `test/styles/`), as long as `npm run check` runs it.
- The verdict on each "judge" row above.
- Hook script details.
