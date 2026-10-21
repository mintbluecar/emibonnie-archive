# Contributing

## Setup

1. Use Node 22 or later (see `.nvmrc`).
2. `npm install`.
3. `npm run check && npm test` to confirm a clean baseline before making changes.

## Workflow

1. Branch off `main`.
2. Make small, reviewable commits.
3. Before opening a PR: `npm run check && npm test` must both pass.
4. Open a PR using the template; fill in the checklist honestly.

## Recipes

Step-by-step guides for common changes. Filled in during Plan 1b.

### Adding a new item kind



### Adding a route



### Adding a migration



## Testing conventions

- Tests run with `node --test`, no test framework.
- Test files mirror the `src/` layout under `test/`.
- Use synthetic fixtures (`test/fixtures/`), never real translation text.
- Pure `src/domain` code is unit-tested directly, with no mocking.
- Code that needs the database, the clock, or the network takes them through `deps`, so tests can supply fakes.

## Engine vs. site

Everything outside `site/` and `examples/` is the engine: fandom-neutral, reusable by any archive built from this template. `site/` is gitignored here and holds one real archive's configuration (`site.json`, `theme.css`, `copy.json`, `logo.png`, optional `seed/`). `examples/solluna/` is the template's fictional example, copied into `site/` by `npm run init-site`. See `docs/architecture.md` for the full layer rules.

## Releases

- The engine is versioned with semver tags.
- Each release lists its upgrade steps under its own heading in `CHANGELOG.md`.
- A site pulls a tagged release via its `upstream` remote and runs `npm run doctor` after updating.
