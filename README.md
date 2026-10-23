# fan-archive

A fandom-neutral engine for archiving fan translations of live clips and streams, organised around events, people, and item kinds (translations are the first kind).

This repository is the **template/engine**. It contains no fandom-specific content: no names, handles, colours, emoji defaults, or hashtags outside `site/` (gitignored) and `examples/`. A fandom-specific archive is created by copying this template, filling in a `site/` folder, and deploying it.

## Status

v0.1.2: a read-only archive (browse, search, item pages) with command-line intake. See `CHANGELOG.md`, `docs/architecture.md` for the layered architecture and code rules, and `docs/decisions/` for the reasoning behind the major choices.

## Getting started

- **Run your own archive:** `docs/start-your-own.md` (and `docs/limits.md` for the free-tier limits).
- **Work on the engine:** `CONTRIBUTING.md` for setup, workflow, testing conventions and a recipe for each extension point (`npm run new …`).

## License

MIT, see `LICENSE`. A site's own `site/` content is not covered by this license.
