# Start your own archive

A step-by-step guide to running your own fan archive on this engine, on free plans, as its owner. Each archive is fully independent: its own repo, database, accounts and moderation. You need a computer with [Node 22+](https://nodejs.org/) and git, and the patience to follow the steps in order. The examples use the template's fictional example site, `solluna archive`.

## 1. Use the template

Create your repo from the template (GitHub's **Use this template**, or clone it and push to a new repo). Keep the repo **private** if you'll store backups there (see [limits](limits.md)). Then:

```sh
git clone <your repo's URL> my-archive
cd my-archive
npm install
```

## 2. Make `site/` yours

```sh
npm run init-site     # copies examples/solluna/ into site/
```

- Edit `site/site.json`, `theme.css`, `copy.json` and the logo. [`docs/site-settings.md`](site-settings.md) documents every field. `npm run build` tells you exactly which field is wrong.
- In **your** copy, delete the `/site/` line from `.gitignore` so your `site/` is committed. The template ignores it so its own example never conflicts with yours.
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
   - Run `setup`/`migrate` as the owner with `APP_DB_ROLE=<role>`. They grant that role read and write on every table, except changing the audit log or the migration records.
   - Give Vercel that role's connection string. The running site then can't rewrite its own edit history. The deploy workflow's migrate step keeps the owner's string.

## 6. Deploy

Choose the path that matches who owns your repo.

### Git-integration path (repo on a personal GitHub account)

The simplest path. In Vercel: **Add New → Project**, import your repo, and deploy. Vercel runs `npm run build` (set in the generated `vercel.json`). Every push to `main` deploys to production, and every pull request gets a preview.

With this path Vercel doesn't run migrations for you. Before you push an update whose `CHANGELOG.md` entry lists a migration, run it yourself against each database:

```sh
DATABASE_URL='<main branch string>' npm run migrate
DATABASE_URL='<preview branch string>' npm run migrate
```

### Actions + token path (repo owned by a GitHub organisation)

Vercel Hobby can't connect to organisation-owned repos, so a GitHub Actions workflow deploys through the Vercel CLI. It runs your tests, migrates the right database, then deploys.

1. Copy [`docs/deploy-workflow.example.yml`](deploy-workflow.example.yml) to `.github/workflows/deploy.yml` in your repo.
2. Create a Vercel token (Vercel account settings → Tokens).
3. Run `npx vercel link` once locally. The org and project IDs are then in `.vercel/project.json`, which is gitignored.
4. Add the secrets as in step 7. The workflow's header comment explains each one.

## 7. Set the secrets

Secrets live only in Vercel environment variables, GitHub environment secrets and your own untracked `.env` files. Never commit them.

- **Vercel** (Project → Settings → Environment Variables). The app reads `DATABASE_URL`, so set it in both scopes:
  - **Production:** `DATABASE_URL` = the main branch string.
  - **Preview:** `DATABASE_URL` = the `preview` branch string.
  - Optional: `ALLOWED_ORIGINS`, a comma-separated list of extra exact origins allowed to send writes (e.g. a custom domain during a move).
- **GitHub** (Actions path only; Settings → Environments):
  - Environment **`production`**: `DATABASE_URL`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`. Restrict it to the `main` branch.
  - Environment **`preview`**: `DATABASE_URL_PREVIEW`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`.
  - Keeping them in separate environments means a pull request's preview job can never read the production database URL.
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

## 10. Pull engine updates

Releases are semver tags. To take one:

```sh
git remote add upstream git@github.com:mintbluecar/fan-archive.git   # once
git fetch upstream --tags
git merge vX.Y.Z
```

Then follow that release's **Upgrade steps** in `CHANGELOG.md`, run `npm install && npm run build && npm test`, run `npm run doctor`, and push. The merge should be conflict-free as long as you've only changed `site/`. On the Git-integration path, run `npm run migrate` first if the release adds migrations (see step 6).

## Troubleshooting

### `npm run setup` / `npm run migrate`

| You see | What it means | Fix |
|---|---|---|
| `migrated …` lines, but your Neon database is still empty | `DATABASE_URL` wasn't set for that command. Outside Vercel the engine then uses a throwaway local database. | Run it as `DATABASE_URL='…' npm run setup`, quoting the string. |
| `DATABASE_URL is not set: a deployed function needs the Postgres connection string` | A deployed function (or a run with `VERCEL` set) has no database URL. | Add `DATABASE_URL` to that Vercel environment (step 7) and redeploy. |
| `settings invalid` / a list of `site.json` field errors | `site.json` doesn't validate. Each error names the exact field (e.g. `region: must be one of the Vercel region codes (…)`). | Fix that field. [`site-settings.md`](site-settings.md) has every field's rules. |
| `item_kinds is missing a row for: <kind>` | A kind folder exists with no migration inserting its `item_kinds` row. | Add the migration (`npm run new kind <name>` scaffolds one), then rerun. |
| `checksum mismatch: engine/NNN_….sql was edited after it was applied` | A migration that already ran was changed: an edit, a bad merge, or the wrong version checked out. | Restore the file exactly as released (`git checkout vX.Y.Z -- src/db/migrations/NNN_….sql`). Never edit an applied migration; changes go in a new one. |
| Connection or timeout errors on the first command | Neon sleeps after 5 minutes idle and the first connection wakes it, or the string is wrong. | Retry once. If it persists, copy the string again from the Neon console. |

### `npm run doctor`

| Line | Fix |
|---|---|
| `✗ node … is older than .nvmrc's …` | Install Node 22 or later. |
| `✗ site/ missing — run npm run init-site` | Run it (step 2), or set `SITE_DIR` if your site folder lives elsewhere. |
| `✗ settings invalid — fix site/site.json: …` | As above: the message names each bad field. |
| `✗ missing env var(s): DATABASE_URL` | Set it for the command: `DATABASE_URL='…' npm run doctor`. |
| `✗ engine version vA is behind upstream vB — …` | Pull the update (step 10). |
| `· engine version — skipped (no upstream remote / upstream unreachable / no vX.Y.Z tags)` | Not an error. Add the `upstream` remote (step 10) to get this check. |

See also: [what happens at each free-tier limit, and how to spot it early](limits.md).
