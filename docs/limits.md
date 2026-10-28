# What happens at each free-tier limit

An archive runs on free plans: Vercel Hobby, Neon Free, GitHub Actions, and free Google and X developer apps. **Never add a card to GitHub or X.** Without one, a limit stops the service instead of sending a bill. Providers change their limits, so the numbers below are the ones the design was checked against on 2026-10-21, from each provider's official pricing pages. Where a limit isn't one of those, this page links to the provider's own page instead of quoting a number. Check those pages before you rely on one.

| Service | Limit | What happens when you hit it | How to spot it early |
|---|---|---|---|
| Vercel Hobby | Free, for non-commercial use only. | Over-limit usage **pauses the feature, with no bill**. | Your project's **Usage** page in the Vercel dashboard. |
| Vercel Hobby | 1M requests a month. | Exhausting it pauses the project for **30 days**. | Usage page. The engine keeps requests low: pages are bundled into a few files cached for a year, and every public read sends `s-maxage=300, stale-while-revalidate=86400, stale-if-error=86400`, so a viral day is served from the CDN. |
| Vercel Hobby | Serverless functions are capped at 5 minutes, and Cron runs at most once a day. | Longer jobs don't run there. The engine runs scheduled and long jobs on GitHub Actions instead. | n/a |
| Vercel Hobby | The number of functions. | The engine stays within it by design: **one** router function (`api/index.js`) serves every endpoint. | Exact figures: [Vercel limits](https://vercel.com/docs/limits). |
| Vercel Hobby | Can't connect to repos owned by a GitHub **organisation**. | The Git integration can't deploy an org repo. | Use the Actions + token path ([start-your-own](start-your-own.md#6-deploy)). |
| Neon Free | 1 GB per project. | See [Neon plans](https://neon.com/docs/introduction/plans) for what happens at the cap. | The Neon console's project dashboard (storage). Everyday deletes are soft deletes, so the archive only grows. |
| Neon Free | 100 compute-hours a month. Autoscaling capped at **0.25 CU** (set this yourself). | Compute is suspended. Public pages keep being served from the CDN cache while Neon sleeps or is suspended (`stale-if-error`). Writes and uncached reads fail (see [Neon plans](https://neon.com/docs/introduction/plans)). | Neon console usage. The 0.25 CU cap and the CDN cache keep usage low. |
| Neon Free | Sleeps after 5 minutes idle. | The first query after a quiet spell is slower. Not an error. | n/a |
| Neon Free | Point-in-time restore covers the last 6 hours. | Older mistakes need the soft-delete history or a backup. | n/a |
| Neon Free | Inactive projects: no documented deletion. | n/a | Exact plan terms: [Neon plans](https://neon.com/docs/introduction/plans), [pricing](https://neon.com/pricing). |
| GitHub Actions | 2,000 minutes a month for a **private** repo on a free org. | With no card on file, Actions **stops at the limit, with no charge**: checks, tweet health checks and backups stop running. | Settings → Billing → usage. The health check rotates (new items daily, older ones in turn) to stay well under the limit. [GitHub Actions billing](https://docs.github.com/en/billing/managing-billing-for-github-actions/about-billing-for-github-actions). |
| GitHub Actions | 500 MB of free artifact storage. | Weekly dumps kept 35 days (about 5 copies) are designed to fit within it. Past it, see [GitHub Actions billing](https://docs.github.com/en/billing/managing-billing-for-github-actions/about-billing-for-github-actions). | Billing → storage. |
| GitHub Actions | A public repo's artifacts are visible to anyone with read access. | Not a limit, but it means **keep backups off on a public repo**: only a private repo may store dumps. | n/a |
| Google sign-in | Free with basic scopes. An app left in testing mode has a 100-user testing cap. | Users beyond the cap can't sign in. | Set the app to **In Production** before launch. |
| X | Sign in with X works on a zero-credit app. The paid X API (charged per post read) is never used: tweet data comes from free, unofficial sources. | If those sources break, intake falls back to the other source, then to typed text. | Intake starts asking for typed text, or new posts come back `unavailable`. |

## Rate limits

Writes and sign-in are capped per visitor, so one account or one address can't use up a free plan. The counts live in the database (`rate_limits`), and a request over its limit gets HTTP 429 (`rate_limited`) until its window rolls over. Limits are per user unless the row says otherwise; an address is stored hashed with `AUTH_SECRET`, never raw.

| Action | Limit | Window | Keyed by |
|---|---|---|---|
| Sign in (X and Google, each start) | 10 | 15 minutes | address |
| Add preview | 60 | 1 hour | user |
| Add an entry | 20 | 1 hour | user |
| Add a new person | 20 | 1 hour | user |
| Edit an entry | 60 | 1 hour | user |
| Check for follow-ups | 10 | 1 hour | user |
| Set display name | 5 | 1 hour | user |
| Delete my account | 3 | 1 day | user |
| Report | 5 | 1 hour | address |
| Remove entries (translator) | 30 | 1 hour | user |
| Restore entries (translator) | 30 | 1 hour | user |
| Opt out | 3 | 1 day | user |
| Opt back in | 10 | 1 day | user |
| Mark the translator welcome seen | 10 | 1 hour | user |
| Owner actions (approval, review, reports, users) | 300 | 1 hour | user |

The source of truth is `LIMITS` in `src/services/limits.js`.

**Cache purging** (v0.3.0) is not rate-limited by the engine: a removal, opt-out, hide, block, reject, review or edit names the affected pages' cache tags and invalidates them. Vercel caps purges per plan (Hobby 50 calls/s per team, Pro 200, Enterprise 500; a call may carry many tags), and one report names at most 128 tags per response. See [Purging Vercel CDN Cache](https://vercel.com/docs/caching/cdn-cache/purge). Off Vercel nothing is purged.

**Plan B for hosting:** if Vercel's limits stop fitting, the handlers are written in the standard web style and routes come from one table, so moving to Cloudflare is cheap. Cloudflare's free tier resets daily, and its paid plan is $5 a month. See [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/).

For current Vercel Hobby terms see [Vercel pricing](https://vercel.com/pricing) and [the Hobby plan](https://vercel.com/docs/plans/hobby).
