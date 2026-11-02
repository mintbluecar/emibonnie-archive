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

## In a site repo

A site repo is a copy of this engine (`fan-archive`) with its own
`site/`, and the engine as its `upstream` remote
(`docs/start-your-own.md`, step 1). If `git remote get-url upstream`
answers, you are in one. There, edit only what the site owns: `site/`,
the site-repo block at the end of `.gitignore` and the lines below it,
`docs/superpowers/`, and files the engine doesn't ship (a site's own
root `Taskfile.yml`, or `vercel.json` on the Git-integration path).
Every other file, this one included, belongs to the engine: make the
change in the upstream repo and bring it in with the next `git merge`
(step 10). An engine file edited in a site repo conflicts on the next
merge and never reaches the other sites.
