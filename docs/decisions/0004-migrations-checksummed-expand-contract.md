# 0004: Checksummed migrations, expand/contract

## Context

The engine is a template that many independent sites pull updates from via `git pull upstream`, and a deploy runs migrations automatically before going live. A migration silently edited after it was applied (by a template update or a careless rebase) would leave different sites in different, undetectable schema states. A migration that drops or renames a column in the same release that replaces it can break whatever old server code is still running during a rollout (a preview deploy, or a brief window between a new deploy and the old one draining).

## Decision

Applied migrations are checksummed; editing an applied migration file fails the migration run instead of silently re-running or skipping it. Schema changes that remove or rename something use expand/contract: the release that adds the replacement never also drops or renames the old column/table in the same release.

## Consequences

- A template update can't corrupt a site's schema by quietly changing a migration someone already ran; the failure is loud and immediate.
- Rollouts stay safe during the moment old and new code run side by side, because the old shape still exists until a later, separate contract migration.
- Costs an extra release cycle for any rename/removal (expand, then later contract), and engine and site migrations must stay numbered separately so they can't collide.
