# Agent instructions

Read `CONTRIBUTING.md` first: setup, workflow, testing conventions and a
recipe for each extension point (`npm run new …`). `docs/architecture.md`
has the layer rules a reviewer enforces.

Any UI work -- a new screen, a changed primitive, a token -- follows
`STYLING.md`: the layers, the tokens, every primitive's markup, when a
component gets its own CSS, and the checks that will fail on a mistake.

**Definition of done for UI work:** run `npm run screens` and look at
the changed screens next to their mockup before calling it done.

Before opening a PR: `npm run build && npm run check && npm test` must
pass, and `npm run e2e` for any page or style change.
