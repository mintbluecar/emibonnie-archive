# 0007: React client for interactive components (evaluated, not yet adopted)

## Status

Proposed. This ADR records a spike's findings and the recommended path. It
does **not** change the engine today; it supersedes the "rules out
component-model conveniences" consequence in [ADR 0001](./0001-plain-js-no-framework.md)
only when a future decision adopts it.

## Context

The engine hand-rolls several interactive UI primitives in plain JS:

- `public/js/components/filterSheet.js` — a `<dialog>` with hand-written
  focus trap coordination, Escape handling, focus-return-to-trigger,
  cancel-discards-tentative-state, and a live "show N" count with a
  stale-response guard (`seq`).
- `public/js/components/inlineSearch.js` — debounced search with the same
  `seq` stale-response guard and manual `aria-busy`/live-region management.
- `public/js/components/carousel.js` — swipe with a threshold and the
  "a drag must also suppress the click that follows it" edge case.
- `public/js/components/zoomDialog.js` — the same dialog plumbing again.
- `public/js/boot/theme.js` — sets `data-theme` before first paint.

Each of these re-derives behaviour the React ecosystem ships as dependencies
(Radix UI, SWR, `use-debounce`, embla-carousel, `next-themes`). Because the
project is at the *beginning* of its implementation rather than finished,
this is a cost that will be paid repeatedly — every new interactive
surface adds more bespoke plumbing — and the cheapest time to change course
is before that code and its tests accumulate further.

A spike (`/tmp/phase0-spike`, React + TypeScript + Vite) was built against
the live engine to test three claims before committing to any change.

## Decision

The spike verified the following, and the recommendation is a **partial,
incremental adoption** of React for the *client presentation layer only*,
keeping the custom backend, contracts, pure state, build, and styling
system as they are. Nothing here was adopted yet; this records the shape a
future change should take.

### What the spike proved

1. **The backend needs no change.** The React client called the existing
   `/api/home`, `/api/filters` and `/api/search` endpoints (one unchanged
   `api/index.js` function, the existing route table) and rendered real
   data. The data/domain/repo/services/routes layers are already
   presentation-agnostic and survived untouched.

2. **The contracts are already TypeScript.** The JSDoc typedefs in
   `src/http/contracts.js` map 1:1 to strict TS interfaces. In a real
   adoption these would live in a small shared package (or be generated)
   so client and server cannot drift, matching ADR 0002's "one source of
   truth" rule.

3. **The token/theme system ports verbatim.** The spike imported
   `src/styles/tokens.css`, `layout.css`, the component CSS, and
   `site/theme.css` unchanged via `@import`; the skinning model (a site
   overrides tokens in `site/theme.css`) is independent of the renderer.

4. **The bespoke behaviour collapses.** The filter sheet, rewritten on
   Radix `Dialog` + `useState` + one SWR hook, reproduces the engine's
   behaviour (focus trap, Escape, return-focus, cancel-discard, live count)
   with a ~5–10× line reduction. The only code that survived the rewrite —
   the tentative-state and `toApiParams` logic — is pure domain logic
   (`searchState.ts`, a direct port of `public/js/state/searchState.js`),
   which React consumes rather than replaces.

### What the spike did *not* do, and does not change

The spike rendered only the home page and the filter sheet. It did **not**
port the full visual surface, so it says nothing about the cost of
reproducing the current site's polish. A real adoption must keep the
existing CSS and port each component's markup faithfully — see the first
consequence below.

## Consequences

### What this makes easier

- Interactive behaviour (dialogs, debounced/stale-guarded search, carousels,
  theme-before-paint) comes from mature dependencies rather than bespoke
  code, removing a source of subtle, hard-to-test bugs.
- Styling becomes co-located with components, if and when that is chosen.
- The client gets types shared with the server, closing a whole class of
  contract drift.

### What this makes harder, and what the spike revealed as the real cost

- **The presentation layer's visual correctness is a precise contract
  between markup and CSS.** The engine's styling is not "tokens only":
  components depend on exact class names, element nesting, `data-*` and
  width/height attributes, and context overrides (e.g.
  `.c-event-card .c-thumb__img { aspect-ratio: 4/5; object-fit: cover }`).
  A naive JSX port regresses visually — the spike's first cut rendered a
  `2160×3840` portrait poster full-size because the markup didn't match
  `thumb.js`. **Faithfully reproducing each of the 30 components against
  the existing CSS — keeping the CSS files, not switching to Tailwind
  first — is the dominant cost, and it buys nothing visually that isn't
  already there.**
- The purity guardrail (the engine never mentions a fandom) and the
  "no god modules"/layer rules (ADR 0002) must be extended to walk
  `.tsx`/`.ts` sources, and re-proven, not assumed.
- The hard-by-default escaping guarantee (`html`/`SafeHtml`, ADR 0001)
  must be preserved under JSX, whose escaping is equivalent but whose
  "never forget" discipline needs a faithful test port.
- The kind-plugin contract (`defineKind`, `npm run new kind`,
  `test/kinds/scaffoldedKind.test.js`) is coupled to the plain-JS
  `render(section, ctx)` model; its presenter/browser-writing half must be
  re-targeted so the "add a kind without touching core" promise survives.

### What this rules out

- A big-bang rewrite. Adoption must be a strangler pattern: React is
  introduced inside the existing build, one component at a time, alongside
  the still-serving vanilla renderer, so no page goes dark and tests keep
  passing at every step.
- Full Next.js (App Router, RSC, SSR, ISR, `next.config` absorbing
  `vercel.json` and the single-function routing) unless a later, separate
  decision justifies it. The spike argues for React-the-client first; the
  server-rendering question is orthogonal and unresolved.

## Recommended sequencing (when adopted)

1. **Faithful port, keep the CSS.** Port components in "most bespoke
   behaviour first" order — `inlineSearch` (→ SWR/`use-debounce`), then
   `filterSheet`/`zoomDialog` (→ Radix `Dialog`), then `carousel` (→ embla),
   then `boot/theme.js` (→ a theme provider). Reproduce each component's
   markup exactly against its existing CSS file; defer Tailwind/CSS-in-JS.
2. **Shared types first.** Extract `src/http/contracts.js` typedefs into a
   package the client and server both import, before porting more than the
   first component.
3. **Cut over the bootstrap last.** Once components are React, swap
   `mountPage()`/the `html` tag for one React root per page; retire
   `html.js`/`dom.js`/the miniDOM tests only when nothing imports them.
4. **Gate every step** on the purity scan, `scaffoldedKind.test.js`, the
   escaping guarantee, and the axe/Playwright e2e suite passing against the
   React output.

## Related

- [ADR 0001](./0001-plain-js-no-framework.md): the decision this revisits.
- [ADR 0002](./0002-layered-architecture-and-di.md): layer rules and the
  dependency-injection model the client change must respect.
- `src/http/contracts.js`: the response shapes the port consumes.
- The spike lives outside the repo (`/tmp/phase0-spike`, React + Vite) and
  is disposable; its findings are captured here.
