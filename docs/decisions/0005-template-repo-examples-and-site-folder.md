# 0005: Template repo, with examples/ and a gitignored site/

## Context

The engine is meant to be reused by other fans ("copy the project as a template, fill in one `site/` folder, deploy their own"), and must never ship any fandom's real data. A single hosted multi-tenant service and a published npm package were both considered and rejected: a hosted service is too much to run and moderate on the owner's behalf, and a package is too much upkeep for ongoing fandom-specific tweaks. The template also needs its own example data for development and tests, without ever committing a real `site/` folder that a `git pull upstream` could then conflict with on an actual site.

## Decision

The reusable unit is a template git repository. Everything a fandom owner edits lives in `site/`, which this repo gitignores. A fictional example site (`examples/solluna/`) ships instead, and `npm run init-site` copies it into `site/` for a new archive. Tests use synthetic fixtures, never real translation text. Each real archive is its own repo created from the template, adding `fan-archive` as an `upstream` remote to pull engine updates.

## Consequences

- A site owner's `git pull upstream main` stays conflict-free, because upstream never touches `site/` and the site repo never touches engine folders.
- The template repo can be made public with nothing personal or fandom-specific in it, since `examples/solluna/` and test fixtures are fictional/synthetic by construction.
- Each archive is fully independent (own data, own owner, own moderation), avoiding the cost and risk of running one shared multi-tenant service.
- Costs some duplication across sites (each runs its own Vercel/Neon/GitHub Actions setup) and requires engine changes that need a new site setting to ship with a default or a clear `doctor`/`setup` error, documented in `CHANGELOG.md`.
