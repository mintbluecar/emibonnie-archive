# 0003: Two tweet sources, with fallback

## Context

Tweet data (text, media, deletion status) is needed to archive a translation, but the paid X API costs per read and the project runs on free tiers. The free alternatives (X's syndication endpoint and FxTwitter) are both undocumented or third-party, so either can change or go down without notice. Intake must still work when one of them does.

## Decision

The engine fetches tweet data from two sources: X's syndication endpoint (`cdn.syndication.twimg.com`) and FxTwitter (`api.fxtwitter.com`), through `src/sources/`, with a registry so a caller doesn't need to know which one answered. If one source fails, intake falls back to the other, then to manual text entry, rather than failing outright. The owner is alerted when one source has been failing.

## Consequences

- Avoids the paid X API entirely, keeping running cost at zero.
- Survives either unofficial source breaking or being rate-limited, instead of making archiving depend on a single fragile endpoint.
- Both sources must be normalised to one internal shape (`src/sources/normalize.js`), adding a small amount of mapping code.
- Neither source is a documented, stable API, so both need defensive parsing, timeouts, and `redirect: 'error'`, and either can require maintenance when X changes its responses.
