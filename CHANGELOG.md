# Changelog

All notable changes to this project are documented here.

## Unreleased

- Initial repository scaffold: guardrails (lint, type-check, layer rules), contributor docs, and a shared router used by the dev server and the Vercel function.
- Site settings (`site.json` schema and validation, `copy.json` merging), the fictional example site (`examples/solluna/`), `npm run build` (generates `src/site/generated.js`, `src/kinds/_registry.js`, `public/site/`, and `vercel.json`), `npm run init-site`, and `npm run doctor`. See `docs/site-settings.md`.
- The public HTTP surface: one router function (`api/[...route].js`) over a route table (`src/routes/`) with per-request deps, cache headers, an Origin check on writes, link-preview meta for `/t/:id` and `/e/:slug`, the item refresh button's endpoint, a privacy sweep over every route, and CI (PGlite and Postgres 17).
