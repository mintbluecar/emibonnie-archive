# Styling Reuse Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make reusing the styling framework easier than copying it, catch copies in `npm run check`, and refuse edits and commits on `main`.

**Architecture:** New layout primitives (`grid`, `list`, `gradient-text`) whose adjustable values are custom properties the primitive defines on itself; one general duplicate-rule check run by `scripts/lintStyles.js`; a short rules card at the top of `STYLING.md`; a Claude Code `PreToolUse` hook backed by a small Node script.

**Tech Stack:** Node 22+ ESM with `// @ts-check`, stylelint/postcss (already dependencies), `node:test`, Playwright (screens/e2e), Claude Code hooks.

**Spec:** `docs/superpowers/specs/2026-11-02-styling-reuse-enforcement-design.md`

## Global Constraints

- Work on branch `styling-reuse-enforcement`; never on `main`.
- Every file `// @ts-check`; lint limits: 200 lines per file, 50 per function, complexity 10, 4 params.
- Before each commit: `npm run build && npm run check && npm test`; for tasks 2-4 also `npm run e2e`.
- Promoted primitives must render unchanged: `npm run screens` before the task and after, compare the affected pages.
- Grid values: 150px min column and `--space-2` gap by default; 190px and `--space-3` at `@media (min-width: 860px)`.
- Duplicate check: 3+ declarations, exact set of property-value pairs, same media context; component vs component or component vs primitive.
- Coincidence marker: a comment directly before the rule, `/* not shared: <reason> */`, reason non-empty.
- Settings are screen-only: never added to `tokens.css`; documented in prose, not in a STYLING.md `css` code block.
- Hook refuses on `main`: `Edit`, `Write`, `NotebookEdit`, and `Bash` commands running `git commit`. Site repos inherit it.
- Widening any allow-list or loosening any test needs the owner's say (Task 2's change to the build's token check, accepting settings a primitive defines on itself, is approved by the owner, 2026-11-02).

## Review Focus

- `git commit` written other ways (`git -C dir commit`, `cd x && git commit -m y`) is still refused, while `git log --grep=commit` and `echo "git commit"` are allowed — Task 1's tests pin both directions.
- The hook run outside a git repo, on a detached HEAD, or with malformed stdin allows the call (exit 0) instead of crashing or blocking everything.
- Two rules with the same declarations in a different order or with different whitespace inside a value are still duplicates.
- A `/* not shared: */` marker with an empty reason does not excuse a duplicate.
- A screen's setting override (`.c-x { --grid-min: 200px }`) beats the primitive's own default because components sit in a later layer — pinned by a build-output test.

---

### Task 1: Branch hook

**Files:**
- Create: `scripts/hooks/guardMain.js`
- Create: `.claude/settings.json`
- Test: `test/scripts/guardMain.test.js`

**Interfaces:**
- Produces: `decide(input: { tool_name?: string, tool_input?: { command?: string }, cwd?: string }, branchOf: (cwd: string) => string|null) => { block: boolean, reason?: string }` and `isGitCommit(command: string) => boolean`, exported from `scripts/hooks/guardMain.js`. Run as a script it reads the hook's JSON from stdin, and on `block` writes `reason` to stderr and exits 2; otherwise exits 0 (Claude Code hooks: exit code 2 from a `PreToolUse` command blocks the call and feeds stderr back to Claude).

- [ ] **Step 1: Write the failing tests** in `test/scripts/guardMain.test.js`:
  - `decide` blocks `Edit`, `Write`, `NotebookEdit` when `branchOf` returns `'main'`; allows them on `'feature'`, on `null` (not a repo / detached).
  - `decide` blocks `Bash` with `git commit -m x`, `git -C ../repo commit`, `cd a && git commit --amend`; allows `git status`, `git log --grep=commit`, `echo "git commit"`, `npm test` on `main`.
  - `decide` allows `Read` on `main`.
  - Blocked `reason` contains `create a branch`.
  - Running the script with stdin `not json` exits 0.
- [ ] **Step 2: Run** `node --test test/scripts/guardMain.test.js` — expect FAIL (module missing).
- [ ] **Step 3: Implement** `scripts/hooks/guardMain.js`. `isGitCommit` matches `/(?:^|[;&|(]\s*|\s)git(?:\s+-[cC]\s+\S+|\s+--?[\w-]+(?:=\S+)?)*\s+commit\b/`. `branchOf` default: `git -C <cwd> branch --show-current` via `execFileSync`, `''` or error → `null`. Malformed stdin → exit 0.
- [ ] **Step 4: Add** `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write|NotebookEdit|Bash",
        "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/scripts/hooks/guardMain.js\"" }]
      }
    ]
  }
}
```

- [ ] **Step 5: Run** the test file — expect PASS; then `npm run check && npm test`.
- [ ] **Step 6: Commit** `feat: refuse edits and commits on main (Claude hook)`.

### Task 2: `grid` primitive with settings

**Files:**
- Create: `src/styles/primitives/grid.css`
- Modify: `scripts/build.js:~187` and `scripts/buildChecks.js` (`findMissingCssTokens`)
- Modify: `public/js/pages/home.js:34`, `public/js/kinds/translation/section.js:26`
- Modify: `src/styles/components/homeMonth.css` (delete `.c-home-month__grid`), `src/styles/components/kindTranslation.css` (delete `.k-translation-grid` rules)
- Modify: `.stylelintrc.json` (`selector-disallowed-list` gains `grid`), `dev/styleguide/index.html.tmpl` (new `<section id="grid">`), `e2e/styleguide.spec.js` (`PRIMITIVE_SECTIONS` gains `'#grid'`), `STYLING.md` section 4 (new "Grid" entry; settings in prose)
- Test: `test/site/build.test.js`, `test/styles/gridSettings.test.js`

**Interfaces:**
- Produces: class `grid`; settings `--grid-min` (150px), `--grid-gap` (`var(--space-2)`), `--grid-min-wide` (190px), `--grid-gap-wide` (`var(--space-3)`), each defined on `.grid` itself; at `min-width: 860px` the primitive uses the `-wide` pair.
- Produces: `findMissingCssTokens(cssSources, tokensCss, ownSettingsCss?: string[])` — custom properties *defined* in `ownSettingsCss` (the primitives' text) count as defined.

- [ ] **Step 1: Run** `npm run screens` and keep `.screens/` aside as the "before" set.
- [ ] **Step 2: Write the failing tests:**
  - `build.test.js`: `findMissingCssTokens([{ path: 'a.css', text: '.x { width: var(--grid-min); }' }], ':root{}', ['.grid { --grid-min: 150px; }'])` returns `[]`; without the third argument returns `['--grid-min']`.
  - `gridSettings.test.js`: in built `public/build/app-*.css`, the `.grid` rule sits inside `@layer primitives` and that layer is declared before `components` (so a component's `--grid-min` wins).
- [ ] **Step 3: Run** both — expect FAIL.
- [ ] **Step 4: Implement** the third parameter and pass the primitives' sources from `build.js`; write `grid.css` with a header comment listing the four settings and how a screen sets them on its own class.
- [ ] **Step 5: Switch** home and the translation section to `class="grid c-home-month__…"`/`class="grid"` (keep `data-kind`), delete the old grid rules, add the stylelint entry, style-guide section and STYLING.md entry.
- [ ] **Step 6: Verify** `npm run build && npm run check && npm test && npm run e2e`; `npm run screens` and compare home, event, person and translator pages with the "before" set — identical.
- [ ] **Step 7: Commit** `feat(styles): grid primitive with settings; home and translation use it`.

### Task 3: `list` and `gradient-text` primitives

**Files:**
- Create: `src/styles/primitives/list.css` (`.list`: `list-style: none; margin: 0; padding: 0`)
- Modify: `src/styles/primitives/text.css` (`.gradient-text`: the four declarations now in `.c-header__accent`)
- Modify markup: `public/js/components/importSpeakers.js:75,117`, `editView.js:61`, `ownerSection.js:124,145`, `meSections.js:71`, `meTranslations.js:134`, `header.js:98`, `signIn.js:43`
- Modify CSS: delete the reset from `adminImport.css`, `edit.css`, `me.css`, `owner.css`; delete `.c-header__accent`, `.c-signin__accent` (drop a class from markup when its rule is now empty — `classUsage.test.js` requires every used class to have a selector)
- Modify: `.stylelintrc.json` (`list`, `gradient-text`), style guide sections `#list` (and the `#text` section shows `gradient-text`), `e2e/styleguide.spec.js` `PRIMITIVE_SECTIONS` gains `'#list'`, `STYLING.md` section 4

**Interfaces:**
- Produces: classes `list`, `gradient-text`.

- [ ] **Step 1: Run** `npm run screens` as "before".
- [ ] **Step 2: Make the change** above; `classUsage.test.js` is the failing-then-passing test (it fails while a class or selector is orphaned).
- [ ] **Step 3: Verify** build/check/test/e2e; screens for import review, edit, owner (me), member me, header on any page, signed-out me — identical to "before".
- [ ] **Step 4: Commit** `feat(styles): list and gradient-text primitives replace copies`.

### Task 4: Duplicate-rule check

**Files:**
- Create: `scripts/styleDuplicates.js`
- Modify: `scripts/lintStyles.js` (`main` runs it after stylelint; any finding sets `process.exitCode = 1`)
- Modify: the four remaining flagged pairs (below)
- Modify: `STYLING.md` section 8 (one new row)
- Test: `test/styles/styleDuplicates.test.js`

**Interfaces:**
- Produces: `findDuplicates(sources: { path: string, text: string, primitive: boolean }[]) => { a: { path, selector }, b: { path, selector }, props: string[] }[]` and `formatDuplicate(d) => string`.
- Message format (exact): ``${a.path} ${a.selector} repeats ${b.path} ${b.selector} (${props.join(', ')}). Use the existing class, or move the rule into src/styles/primitives/ and use it from both. See STYLING.md "Rules card".``

- [ ] **Step 1: Write the failing tests:**
  - two component sources with `.a{display:grid;gap:1px;color:red}` and `.b{color:red;  gap: 1px;display:grid}` → one finding, `props` `['color','display','gap']`.
  - same bodies, one inside `@media (min-width: 860px)` → none.
  - a 2-declaration match → none; two primitives matching each other → none; component matching a primitive → one.
  - preceded by `/* not shared: wordmark sizes differ by design */` → none; `/* not shared: */` → one.
  - `formatDuplicate` output equals the exact message above.
  - the real tree (`src/styles/components`, `src/styles/primitives`) has no findings.
- [ ] **Step 2: Run** — expect FAIL (module missing; the real-tree test lists the four groups below).
- [ ] **Step 3: Implement** with postcss: key = parent at-rule params chain + sorted `prop:value` (values whitespace-collapsed, `!important` kept) for rules with ≥3 declarations.
- [ ] **Step 4: Resolve** the remaining groups — share when both are the same UI concept, otherwise mark with a reason:
  - `me.css .c-me__head` / `owner.css .c-owner__alert`
  - `bubbles.css .c-bubbles__plain` / `resultCard.css .c-result-card__line`
  - `bubbles.css .c-bubbles__msg` / `me.css .c-me__entry-top`
  - `sheet.css .c-sheet__close` / `videoPlayer.css .c-video__full`
- [ ] **Step 5: Verify** build/check/test/e2e; screens unchanged for anything shared.
- [ ] **Step 6: Commit** `feat(styles): fail check on a rule copied between style files`.

### Task 5: Rules card

**Files:**
- Modify: `STYLING.md` (new first section "Rules card", ≤25 lines; section 6 points to it), `CLAUDE.md` (UI line points at "STYLING.md → Rules card"), `CONTRIBUTING.md` page and component recipes ("Styles go in …" becomes "reuse a primitive first; only this screen's own layout goes in …"), `scripts/templates/component/component.css.tmpl` header (same sentence)
- Test: `test/styles/classUsage.test.js` already checks STYLING.md's code blocks

The card's content, as bullet points: compose primitives first; search `src/styles/` for the properties before writing a rule and reuse what's there; a second screen needing something means promoting it to a primitive with settings; tweak a primitive only through its settings on your own `c-` class; a failing style check or test is a signal, never an allow-list to widen without the owner; work on a branch (the hook refuses `main`); the table of checks and fixes is section 8.

- [ ] **Step 1: Write** the card and the pointer edits.
- [ ] **Step 2: Verify** `npm test` (doc class/token checks) and `npm run check`.
- [ ] **Step 3: Commit** `docs: STYLING.md rules card; CLAUDE.md and recipes point to it`.

## After this plan

Redo the me page's grouped cards on its own branch from `main` once this merges, using `grid` and `list`. Its API and grouping logic are in the stash "me page: grouped cards (to redo on the styling-reuse framework)"; its CSS is not reused.
