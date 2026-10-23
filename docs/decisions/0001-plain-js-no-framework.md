# 0001: Plain JS, no framework

## Context

The engine needs a front end and a build step that stay cheap to run and cheap to understand, across many independently-owned sites built from the same template. The owner's other fan projects already use plain JS and `node --test`, so picking a different stack here would be a new thing to maintain rather than a reuse.

## Decision

The front end is plain HTML, CSS, and JS, with no framework. Bundling (when needed) is esbuild at build time only, producing a few hashed, long-cached files. Tests run with `node --test`, no test framework.

## Consequences

- Matches the owner's existing projects; no new stack to learn or keep patched.
- Fast on phones, which fits a browse-and-search site with no complex client state.
- Bundled output stays small, which matters on Vercel Hobby's monthly request cap.
- Rules out component-model conveniences (JSX, reactive bindings); view code stays closer to the DOM.
- A heavier UI later (e.g. richer client state) would need to be justified on its own, not inherited for free from a framework already in place.
