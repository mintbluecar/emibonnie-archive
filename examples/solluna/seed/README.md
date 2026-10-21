# seed/

Optional, local-development-only. A real archive can put synthetic sample
data here to load with `npm run seed-dev`, so a fresh checkout has
something to browse without any real content.

- `maps.json` — `{ createPeople: [...], tweets: { "<id>": { chosen, overrides } } }`.
  People in `chosen` are referenced by IG handle (`{ "person": "<ig>" }`) or
  by role (`{ "role": "fan" }`). Only the posts listed under `tweets` are
  ingested, in the order they're listed.
- `tweets/` — the posts, served offline as `<id>.syn.json`, `<id>.fx.json`
  and `<id>.thread.json` (synthetic copies of the engine's test fixtures;
  every id, handle and line is invented).
