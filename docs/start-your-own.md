# Start your own archive

A step-by-step guide to running your own fan archive on this engine, on free plans, as its owner. Each archive is fully independent: its own repo, database, accounts and moderation. You need a computer with [Node 22+](https://nodejs.org/) and git, and the patience to follow the steps in order. The examples use the template's fictional example site, `solluna archive`.

## 1. Copy the template, keeping its history

Clone the engine and push it to a new, empty repo of your own. Cloning keeps the engine's history and release tags, which is what lets you take updates later with a plain `git merge` (step 10).

1. Clone the engine:

   ```sh
   git clone git@github.com:mintbluecar/fan-archive.git my-archive
   cd my-archive
   ```

2. Create an **empty** repo on GitHub (no README, licence or `.gitignore`). Keep it **private** if you'll store backups there ([limits](limits.md)). Then point the clone at it, keeping the engine as `upstream`:

   ```sh
   git remote rename origin upstream
   git remote add origin <your repo's URL>
   ```

3. Push, then install:

   ```sh
   git push -u origin main
   npm install
   ```

Don't use GitHub's **Use this template** button: it copies the files without their history, so later engine releases can't be merged and every upgrade becomes a hand-copy.

## 2. Make `site/` yours

```sh
npm run init-site     # copies examples/solluna/ into site/
```

- Edit `site/site.json`, `theme.css`, `copy.json` and the logo. [`docs/site-settings.md`](site-settings.md) documents every field. `npm run build` tells you exactly which field is wrong.
- In **your** copy, delete the `/site/` line from `.gitignore` so your `site/` is committed. The template ignores it so its own example never conflicts with yours.
- **Git-integration path only** (step 6): also delete the `/vercel.json` line from `.gitignore`, run `npm run build`, and commit the `vercel.json` it writes. Vercel reads that file (build command, region, headers, rewrites) before it runs any build, so it has to be in your repo. Rebuild and commit it again whenever you change `region` or take an engine update (step 10). On the Actions path the workflow runs the build before deploying, so leave it ignored.
- Everything else the build writes (`public/*.html`, `public/build/`, `public/site/`, the generated registries) stays gitignored, so a rebuild never changes a tracked file.
- Never put real translators' tweets in a public repo. `site/seed/` is for your own development data.

Check it builds: `npm run build && npm run check && npm test`.

## 3. Choose a region near your fans

Pick the Vercel region closest to most of your fans from [Vercel's region list](https://vercel.com/docs/regions), and set it as `region` in `site/site.json` (e.g. `"sin1"`, Singapore). Your database goes in the same place: the region list gives each Vercel code's AWS name (`sin1` is `ap-southeast-1`), and you pick the Neon AWS region with that name in step 5. A function far from its database is slow on every request.

## 4. Accounts

You need Vercel, Neon and GitHub accounts, plus later an X developer app and Google sign-in.

- **Use a dedicated email for the archive** and sign up to each service with it, not with "Continue with GitHub" or another social login. This keeps the archive's accounts separate from your personal ones and easy to hand over.
- **Never add a card to GitHub or X.** Without one, hitting a free limit stops the service instead of billing you ([what happens at each limit](limits.md)).
- **Turn on 2FA everywhere:** GitHub, Vercel, Neon, X and Google.

## 5. Create the Neon project

1. Sign up at [neon.com](https://neon.com/) directly, not through the Vercel Marketplace (that moves billing to Vercel).
2. Create a project in the AWS region matching step 3.
3. Set **autoscaling max to 0.25 CU**, which keeps you well inside the free compute hours.
4. Create a branch named **`preview`** for preview deploys, so they never touch your real data.
5. Copy both connection strings, for the main branch and for `preview`. Treat them as passwords.
6. Optional, recommended: create a second, least-privilege role for the app in Neon.
   - Run `setup`/`migrate` as the owner with `APP_DB_ROLE=<role>`. They grant that role read and write on every table, except changing the audit log or the migration records. Tables that a later migration adds reach the role only when that migrate also runs with `APP_DB_ROLE`, so set it every time (the deploy workflow takes it from a repository variable).
   - Give Vercel that role's connection string. The running site then can't rewrite its own edit history. The deploy workflow's migrate step keeps the owner's string.

## 6. Deploy

Choose the path that matches who owns your repo.

### Git-integration path (repo on a personal GitHub account)

The simplest path. In Vercel: **Add New → Project**, import your repo, and deploy. Vercel runs `npm run build` (set in the `vercel.json` you committed in step 2). Every push to `main` deploys to production, and every pull request gets a preview.

> **Migrate first, then merge or deploy.** On this path nothing runs migrations for you, on purpose: a build that migrated would need a database URL that can write, inside every preview build of pull-request code. Whenever an update's `CHANGELOG.md` entry lists a migration, do these in order:
>
> 1. Migrate the preview database, then check the pull request's preview deploy.
> 2. Migrate the production database.
> 3. Only then merge to `main` (which deploys to production).
>
> ```sh
> DATABASE_URL='<preview branch string>' APP_DB_ROLE=<role> npm run migrate
> DATABASE_URL='<main branch string>' APP_DB_ROLE=<role> npm run migrate
> ```
>
> Leave out `APP_DB_ROLE=<role>` if you skipped the app role in step 5. Migrations are expand-only within a release (ADR 0004), so the site that's still live keeps working against the migrated database until the merge deploys.

### Actions + token path (repo owned by a GitHub organisation)

Vercel Hobby can't connect to organisation-owned repos, so a GitHub Actions workflow deploys through the Vercel CLI. It runs your tests, migrates the right database, then deploys.

1. Copy [`docs/deploy-workflow.example.yml`](deploy-workflow.example.yml) to `.github/workflows/deploy.yml` in your repo.
2. Create a Vercel token (Vercel account settings → Tokens).
3. Run `npx vercel link` once locally. The org and project IDs are then in `.vercel/project.json`, which is gitignored.
4. Add the secrets as in step 7. The workflow's header comment explains each one.

## 7. Set the secrets

Secrets live only in Vercel environment variables, GitHub environment secrets and your own untracked `.env` files. Never commit them.

- **Vercel** (Project → Settings → Environment Variables). The app reads `DATABASE_URL`, so set it in both scopes, as type **Secret** (write-only once saved; see [Vercel's Config and Secret environment variables](https://vercel.com/docs/environment-variables/sensitive-environment-variables)):
  - **Production:** `DATABASE_URL` = the main branch string (the app role's, if you made one in step 5).
  - **Preview:** `DATABASE_URL` = the `preview` branch string.
  - Optional: `ALLOWED_ORIGINS`, a comma-separated list of extra exact origins allowed to send writes (e.g. a custom domain during a move).
- **GitHub** (Actions path only; Settings → Environments):
  - Environment **`production`**: `DATABASE_URL`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`. Restrict it to the `main` branch.
  - Environment **`preview`**: `DATABASE_URL_PREVIEW`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`.
  - Optional repository variable `APP_DB_ROLE` (Settings → Secrets and variables → Actions → Variables): the app role from step 5. The migrate steps then grant it access to new tables.
  - Keeping them in separate environments means a pull request's preview job never receives the production database URL.
- Sign-in secrets (X, Google) arrive with the release that adds sign-in. Its `CHANGELOG.md` entry lists them.

## 8. Set up the database and check

```sh
DATABASE_URL='<main branch string>' npm run setup     # migrates, then seeds featured people, ignored hashtags and categories from site.json
DATABASE_URL='<main branch string>' npm run doctor    # every line should be ✓ (· is a neutral skip)
```

`setup` is safe to rerun after you edit `site.json`. Run it against the `preview` branch too, with that branch's string.

## 9. Before going public

- Read your **about**, **privacy** and **takedown** pages (`/about`, `/privacy`, `/takedown`) and adjust their wording in `site/copy.json` (the `about.*`, `privacy.*` and `takedown.*` keys) to match how you actually run the archive.
- Set `contactUrl` in `site.json` to the one public contact: a form or a profile link, never a personal email. Then check the link works.
- Check the site on a phone, in light and dark mode.
- Run `npm run e2e:site` (once: `npx playwright install chromium`). It builds your own `site/`, seeds `site/seed/` into a throwaway database, and checks your real pages (home, the first event and item, every featured person, a translator, a search, about, privacy, takedown and a 404) at phone and desktop widths in light and dark mode: each must answer, log no errors, never scroll sideways and pass the accessibility check, colour contrast included. It needs a `site/seed/maps.json` with at least one post.

## 10. Pull engine updates

Releases are semver tags. Your clone already has the engine as `upstream` (step 1). To take a release:

```sh
git fetch upstream --tags
git merge vX.Y.Z
```

Then:

1. Follow that release's **Upgrade steps** in `CHANGELOG.md`.
2. Run `npm install && npm run build && npm test`, then `npm run doctor`. On the Git-integration path, commit `vercel.json` if the build changed it.
3. On the Git-integration path, if the release adds migrations, migrate before you push (step 6: preview, then production).
4. Push.

The merge should be conflict-free as long as you've only changed `site/`.

## Troubleshooting

### `npm run setup` / `npm run migrate`

| You see | What it means | Fix |
|---|---|---|
| `DATABASE_URL is not set (set PGLITE_DIR to migrate a local dev database)` | `setup` and `migrate` were run with no database to write to. They refuse rather than use a throwaway one. | Run it as `DATABASE_URL='…' npm run setup`, quoting the string. For a local dev database, use `PGLITE_DIR=.devdb npm run setup`. |
| `DATABASE_URL is not set: a deployed function needs the Postgres connection string` | A deployed function (or a run with `VERCEL` set) has no database URL. | Add `DATABASE_URL` to that Vercel environment (step 7) and redeploy. |
| `settings invalid` / a list of `site.json` field errors | `site.json` doesn't validate. Each error names the exact field (e.g. `region: must be one of the Vercel region codes (…)`). | Fix that field. [`site-settings.md`](site-settings.md) has every field's rules. |
| `item_kinds is missing a row for: <kind>` | A kind folder exists with no migration inserting its `item_kinds` row. | Add the migration (`npm run new kind <name>` scaffolds one), then rerun. |
| `checksum mismatch: engine/NNN_….sql was edited after it was applied` | A migration that already ran was changed: an edit, a bad merge, or the wrong version checked out. | Restore the file exactly as released (`git checkout vX.Y.Z -- src/db/migrations/NNN_….sql`). Never edit an applied migration; changes go in a new one. |
| `checksum mismatch`, or a migration the code no longer has, on the **preview** database after merging | Two branches each added a migration with the same number (e.g. both a `002_…`), and the preview database ran the losing one. Migrations are numbered in order, and an applied one can't change. | Renumber the unmerged branch's file to the next free number. Then reset the Neon `preview` branch from main (Neon console → **Branches** → `preview` → **Reset from parent**; [Neon docs](https://neon.com/docs/guides/reset-from-parent)), which discards the preview data, and run `migrate` on it again. Production only ever runs merged migrations. |
| Connection or timeout errors on the first command | Neon sleeps after 5 minutes idle and the first connection wakes it, or the string is wrong. | Retry once. If it persists, copy the string again from the Neon console. |

### `npm run doctor`

| Line | Fix |
|---|---|
| `✗ node … is older than .nvmrc's …` | Install Node 22 or later. |
| `✗ site/ missing — run npm run init-site` | Run it (step 2), or set `SITE_DIR` if your site folder lives elsewhere. |
| `✗ settings invalid — fix site/site.json: …` | As above: the message names each bad field. |
| `✗ missing env var(s): DATABASE_URL` | Set it for the command: `DATABASE_URL='…' npm run doctor`. |
| `✗ engine version vA is behind upstream vB — …` | Pull the update (step 10). |
| `· engine version — skipped (no upstream remote / upstream unreachable / no vX.Y.Z tags)` | Not an error. Add the `upstream` remote (step 1) to get this check. |

See also: [what happens at each free-tier limit, and how to spot it early](limits.md).
