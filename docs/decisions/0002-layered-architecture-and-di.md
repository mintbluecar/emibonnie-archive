# 0002: Layered architecture and dependency injection

## Context

The engine is meant to be extended by people other than its original author, across many independently-run sites, with new item kinds added over time. Without enforced boundaries, orchestration code tends to reach straight into SQL, routes tend to import repos directly, and "pure" domain logic quietly picks up I/O or a hidden clock dependency, which makes tests slow and flaky and makes a kind impossible to add without touching unrelated code.

## Decision

The codebase is split into layers (`domain`, `repo`, `sources`, `services`, `http`, `routes`, `kinds`, `db`, `site`) with one-way dependencies enforced by ESLint `no-restricted-imports` and `import/no-cycle`. `src/domain` is pure: no I/O, no clock, no cross-layer imports. Everything that needs the database, the clock, or network access gets it through a `deps` object (`{ db, fetchImpl, now, site }`) built per request by `withDeps()`, rather than importing it at module scope.

## Consequences

- Pure domain logic (date handling, text parsing, header parsing) is trivially unit-testable with no mocking.
- A reviewer can reject a PR mechanically ("the linter would have caught this") instead of relying on memory of the rules.
- Adding a kind touches only `src/kinds/<k>/` plus a migration, because kinds don't reach into each other or into routes.
- Dependency injection means tests can swap `fetchImpl`, `now`, and `db` without network or wall-clock flakiness.
- Costs some ceremony: every request-handling path threads `deps` through, and the linter must be kept in sync as new layers appear.
