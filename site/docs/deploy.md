# Deploying and running this archive

This is the owner's guide for `site/scripts/deploy.sh`: what's already set up, what's
left to do by hand, how the first deploy goes, how to check it worked, the
launch checklist, manual backups, and what to do if something goes wrong.

It assumes you've read [`docs/start-your-own.md`](../../docs/start-your-own.md)
and [`docs/limits.md`](../../docs/limits.md) in the engine. Nothing here repeats
the engine's own setup steps; it only covers what's specific to this archive
and to the manual (no GitHub Actions) deploy path.

### Before any of this: get the owner-role connection strings into your shell

Every command below assumes `EMIBONNIE_DB` and `EMIBONNIE_DB_PREVIEW` (the
**owner**-role connection strings, for the main branch and the `preview`
branch) are already set in your shell — **never** type or paste either of
them onto the same command line as a command, where it would sit in your
shell history for as long as that history file exists. Set them once per
terminal session, with your shell's own "read a line without echoing it"
feature, so the value never appears on screen or in history at all:

```sh
read -rs EMIBONNIE_DB_PREVIEW; export EMIBONNIE_DB_PREVIEW
read -rs EMIBONNIE_DB; export EMIBONNIE_DB
```

(Paste or type the connection string at each prompt, then press enter;
nothing is echoed back.) Every command in this guide that follows just
names `EMIBONNIE_DB`/`EMIBONNIE_DB_PREVIEW` or runs a plain `task ...` —
none of them ever show the value itself.

## 1. Owner steps

Do these once, before the first deploy. They're in your **fan** accounts
(Vercel, Neon, GitHub, X, Google) — never your personal ones.

**Already done:**
- The Neon project exists: Postgres 17, AWS Singapore, autoscaling capped at
  0.25 CU, with a `preview` branch.
- The GitHub repos for the engine and for this archive already exist, under
  the fan org, and are both **private**.

**Still to do:**

**(a) Create the `app` role, on both branches — with `site/scripts/create-app-role.sh`, not the Neon console.**

A role created in the Neon console (or via its API/CLI) is automatically
made a member of `neon_superuser`:

> "Your Postgres role and roles created in the Neon Console, API, and CLI
> are granted membership in the neon_superuser role."
> — [Neon: Manage roles](https://neon.com/docs/manage/roles)

That's admin-level (it can create databases, create roles, and bypass
row-level security), so it is **not** least privilege, no matter how narrow
the SQL grants afterwards look. The same page says a role created with
*SQL*, from a client like `psql`, gets only the ordinary privileges of a
freshly created standalone Postgres role — which is what the deployed app
actually needs. So, instead of the Neon console (with
[`task`](https://taskfile.dev/) installed — `task --list` from this repo
shows every task below):

```sh
task role:preview
task role:prod
```

or the same thing directly (with `EMIBONNIE_DB_PREVIEW`/`EMIBONNIE_DB`
already in your shell, as above):

```sh
site/scripts/create-app-role.sh
site/scripts/create-app-role.sh --prod
```

Run the first one against `preview`, the second against the main branch.
Each one:
- connects as the owner role, generates a strong, URL-safe password
  locally (44 characters, about 264 bits), and creates `app` with SQL
  (`create role app login password %L`, quoted server-side) — never
  through the Neon console, which would make it a `neon_superuser` member.
  The password goes to Neon **in plaintext**, over TLS (the Neon driver's
  secure WebSocket; Neon connection strings carry `sslmode=require`):
  "Passwords must be supplied in plain text but are encrypted when stored.
  Hashed passwords are not supported."
  ([Neon: Manage roles](https://neon.com/docs/manage/roles)). If the
  statement fails, the password can appear in the server's error log. It
  is never printed locally, never in argv, and never on disk except the
  `chmod 600` fallback file in (b). (See `site/scripts/app-role.mjs` and
  `site/scripts/create-app-role.sh`'s own header comment for how.)
- refuses if `app` already exists on that branch (so you can't run this
  twice by accident) and tells you to run it again with `--rotate`
  instead (`task role:rotate:preview` / `task role:rotate:prod` —
  section 6(a), below) — never the Neon console, which would put `app`
  back into `neon_superuser`;
- builds that branch's app-role connection string (same host, database and
  parameters, user `app`, the new password) and adds it to Vercel as
  `DATABASE_URL`, type **Secret**, in the matching scope (`vercel env add
  DATABASE_URL --environment <scope> --sensitive --yes`, value through
  stdin; a Preview one covers every preview branch) — see (b), below.

Run this **before** the first `npm run migrate` with `APP_DB_ROLE=app`
(which `site/scripts/deploy.sh` always uses): if the `app` role doesn't exist
yet, migrate fails with `role "app" does not exist`, and that's the fix.

**(b) Vercel: link the project, then let `create-app-role.sh` set the Secret.**

The executor runs `vercel link` once to connect this repo to a Vercel
project — do this before step (a), since `create-app-role.sh` needs the
project linked to add the `DATABASE_URL` Secret itself.

After `create-app-role.sh` has run for both branches, check in the Vercel
dashboard (Settings → Environment Variables) that `DATABASE_URL` exists as
type **Secret** in both scopes:
- **Production** → the main branch's app-role connection string
- **Preview** → the `preview` branch's app-role connection string

If `create-app-role.sh` printed that it couldn't set the Secret directly,
it will have written the connection string instead to a `chmod 600` file
under `~/.emibonnie/` and told you its exact path — open that file, paste
its contents into Vercel by hand (Settings → Environment Variables → Add →
type **Secret**), then **delete the file**.

Only `DATABASE_URL` is needed. The app never reads a second, preview-only
variable name — Vercel picks the right value for you based on which scope a
deployment belongs to.

**(c) Confirm 2FA.**

Check that 2FA (an authenticator app or a passkey) is on for every fan
account this archive uses: X, Google, GitHub, Vercel, Neon. (This archive
uses its `*.vercel.app` address, not a separately registered domain, so
there's no registrar account to cover.)

**(d) GitHub repos.**

Nothing to do here — already done (see "Already done", above).

### Least privilege

The site's running code never connects with the same login that can rewrite
history. `npm run migrate`, run with `APP_DB_ROLE=app`, grants the `app`
role read/write on every table *except* the audit log and the migration
table (`grant_app_role`, defined in the engine's
`src/db/migrations/001_initial.sql` and called from
`src/repo/roles.js`). That's why the deploy script passes `APP_DB_ROLE=app`
on every migrate, and why Vercel gets the `app` role's connection string,
never the owner-role one. `site/scripts/check-app-role.sh` (which
`site/scripts/deploy.sh` runs automatically, right after every migrate) checks
this mechanically (`task check-role:preview` / `task check-role:prod`, or
`site/scripts/check-app-role.sh [--prod]` directly):

```sql
select pg_has_role('app', 'neon_superuser', 'member'),
       has_table_privilege('app', 'audit_log', 'update'),
       has_table_privilege('app', 'audit_log', 'delete');
```

All three must be `f`. If any is `t`, stop and fix it before continuing —
see "Least privilege" above for why `app` must be created with SQL
(`create-app-role.sh`), never through the Neon console.

## 2. First deploy

Vercel always makes a brand-new project's **first** deployment a
**production** deployment, regardless of flags:

> "The first deployment of a new project is always a production
> deployment. This happens even when you: ... Run `vercel` or `vercel
> deploy` from the CLI without `--prod` ... Run `vercel deploy
> --target=preview` ... Deploy from a branch that is not your production
> branch."
> — [Vercel: Environments — First deployment](https://vercel.com/docs/deployments/environments#first-deployment)

So the very first deploy here is a `--prod` run, on purpose — a preview
run first would just become the production deployment anyway, against
whichever database it happened to be configured for. `site/scripts/deploy.sh`
also prints a reminder of this every time it runs in preview mode, and, in
preview mode, checks (before doing anything else) whether this project
already has a deployment — failing closed: it carries on only if `vercel
list` succeeds and shows at least one `https://….vercel.app` deployment
address, and stops on anything else (an error, no output, "No deployments
found.", or wording it doesn't recognise), telling you to use `task
deploy:prod` if this really is the first deploy.

In order:

1. **Create the `app` role on both branches** — section 1(a), above:
   ```sh
   task role:preview
   task role:prod
   ```
   or directly:
   ```sh
   site/scripts/create-app-role.sh
   site/scripts/create-app-role.sh --prod
   ```
2. **Run setup and seed, with the app role granted, on *both* branches:**
   ```sh
   task setup:preview
   task setup:prod
   ```
   or directly:
   ```sh
   DATABASE_URL="$EMIBONNIE_DB_PREVIEW" APP_DB_ROLE=app npm run setup
   # Expected: the engine migration applied, then "seeded 2 people"
   DATABASE_URL="$EMIBONNIE_DB_PREVIEW" APP_DB_ROLE=app npm run seed-dev
   # Expected: "seeded 6"

   DATABASE_URL="$EMIBONNIE_DB" APP_DB_ROLE=app npm run setup
   # Expected: "seeded 2 people"
   DATABASE_URL="$EMIBONNIE_DB" APP_DB_ROLE=app npm run seed-dev
   # Expected: "seeded 6"
   ```
   Use the **owner**-role string in `DATABASE_URL` here (`setup`/`seed-dev`
   are things you run by hand) — `APP_DB_ROLE=app` just tells `setup`'s
   internal migrate step which role to (re-)grant, same as `deploy.sh`
   does. `seed-dev` here loads **this archive's own 6 real archived
   tweets** from `site/seed/` — not synthetic example data.
   `scripts/seedDev.js` reads `SITE_DIR` (default `site`, this repo's own
   folder) to find them, the same folder `site/scripts/deploy.sh`'s
   `node --test site/test/` and `npm run e2e:site` steps build and check
   against.
3. **Run the least-privilege check on both branches:**
   ```sh
   task check-role:preview
   task check-role:prod
   ```
   (or `site/scripts/check-app-role.sh` / `site/scripts/check-app-role.sh
   --prod` directly -- each reads `EMIBONNIE_DB_PREVIEW`/`EMIBONNIE_DB`
   from your shell itself).
   Both must print "least-privilege check passed". Don't continue if
   either doesn't.
4. **Make the first deploy `site/scripts/deploy.sh --prod`** (not a plain
   `site/scripts/deploy.sh`) — see the reasoning above.
   ```sh
   task deploy:prod
   ```
   or directly:
   ```sh
   site/scripts/deploy.sh --prod
   ```
   `--prod` first asks you to type `yes` (before any check runs; a typo just asks again) before it touches the
   production database — read the prompt before answering. `task
   deploy:prod` asks its own yes/no `prompt:` first, on top of that.
5. **Later releases go through preview first:** once this project has a
   production deployment, `task deploy:preview` (or `site/scripts/deploy.sh`
   with no `--prod`) behaves normally — it deploys a preview build against
   the `preview` branch, for you to check with section 3, below, before
   running `task deploy:prod` (or `site/scripts/deploy.sh --prod`) again for
   the real release. `task deploy:dry` / `task deploy:dry-prod` run the
   same thing in `--dry-run`, with no network call and nothing executed
   for real, if you just want to see the step order.
6. **Quick deploys while iterating:** `task deploy:quick` (preview) and
   `task deploy:quick-prod` skip the heavy checks: `npm ci` when
   `node_modules` already exists, `npm run check`, `npm test` and
   `e2e:site`. They still build, run the name-leak guard, migrate and check
   the app role. Try a change with `deploy:quick` on a preview, then ship
   the release with the full `task deploy:prod`. Every deploy, quick or
   full, stops before building if the repo's files change while it runs —
   don't edit, pull or merge in this repo during a deploy.

## 3. Verification checklist

**Against the production domain** — this project's own stable `*.vercel.app`
**production alias** (Vercel always serves it from whichever deployment is
currently production). That's different from the one-off URL each
individual deployment gets (e.g. a per-commit or per-preview address),
which changes on every deploy:

- **Headers.** `curl -I https://<production domain>/` and check for:
  - a `Content-Security-Policy` header
  - `Strict-Transport-Security` (HSTS)
  - `Cache-Control: ...s-maxage=300...` on a public page
  - an `x-vercel-id` header containing `sin1` (confirms the Singapore
    region) — check this on a **function route**, e.g.
    `curl -I https://<production domain>/t/<id>`, not only the static
    home page, since a static asset can be served straight from the CDN
    without ever naming the function's own execution region. (This is my
    understanding of how `x-vercel-id` behaves on Vercel's infrastructure
    — confirm it against the real response once this deploys.)
  - the home page actually lists the seeded events
  - the `/t/<id>` meta rewrite path answers and names the right item
    (`curl -s https://<production domain>/t/<id>` — the rewrite in
    `vercel.json` sends it to `/api/meta/t/:id`), and a same-origin
    request (e.g. from the site's own pages, or `curl -H "Origin:
    https://<production domain>" ...` against a write endpoint once those
    exist) is accepted rather than rejected by the Origin check
- **Link preview — production only** (a preview deployment's URL is
  usually behind Vercel's deployment protection, so a link-unfurl bot
  can't reach it anyway). Paste a production `/t/<id>` link into Telegram
  and into X (or Threads). Both should show the right title and
  description, not a generic fallback.
- **On a phone, against production:** open an entry with a clip. It
  should play, and stay pinned at the top while you scroll the credits
  and bubbles below it.
- **Neon console:** the project's compute settings still show autoscaling
  capped at **0.25 CU**.
- **The migrate output,** from the deploy's own log: `migrations: up to
  date` on a repeat deploy with no new migration, or `migrated
  <namespace>/<file>` the first time a new one runs, followed by `granted
  the app role to app`.
- **The least-privilege query** (section 1, "Least privilege", above) still
  answers `f, f, f`.

**For a preview deployment,** a plain `curl -I` against its generated URL
will usually hit Vercel's deployment protection wall and never reach this
site's own headers. Use `vercel curl` instead, which adds the bypass
token for you — "The `vercel curl` command works like `curl`, but
automatically handles deployment protection bypass tokens for you."
([Vercel: `vercel curl`](https://vercel.com/docs/cli/curl)). Either form
works, run from this repo (linked to the project, so it can find the
right deployment and bypass token):

```sh
npx --yes vercel@65.1.0 curl -I --deployment <preview deployment URL> /
# or, passing the full preview URL directly:
npx --yes vercel@65.1.0 curl -I <preview deployment URL>/
```

## 4. Launch checklist

Go through all of this before telling anyone the site is live.

### Identity separation (from the design spec)

- [ ] Vercel and Neon were signed up for with the fan email, not "Continue
      with GitHub".
- [ ] The Vercel project slug is a neutral name, not your personal name or
      handle.
- [ ] The Google consent screen's support and developer emails are the fan
      Gmail address.
- [ ] The X developer app's authorize screen shows only fan-side names and
      links.
- [ ] One fan contact address is used on every public page (this archive
      uses the `contactUrl` in `site/site.json`).

### Trust pages

- [ ] `/about` reads correctly: what the site is, the credits policy, and
      "unofficial, not affiliated with the artists or their agency".
- [ ] `/privacy` reads correctly: who runs it, what's collected, the third
      parties involved (Vercel, Neon, GitHub, X video), retention, and the
      contact link.
- [ ] `/takedown` reads correctly: who can ask, what to send, and that the
      response is "hide first, review second".
- [ ] All three are linked from the footer on every page.

### Logo

- [ ] The logo credit in `site/copy.json` (`about.logoCredit`) names who the
      logo belongs to, and the site never implies it's an official account.

### Translators

- [ ] Contact each translator with what's archived and how to opt out:
      `@vacantvolcanic`, `@danaNYB`, `@SugarHoneyz13`, and the Notion
      translator. Keep their Notion permission in writing, privately — not
      in this repo.
- [ ] Until the account/opt-out tools ship, tell them to use the contact
      link (`contactUrl` in `site/site.json`) if they want something
      removed.

### Backups

- [ ] Run the manual backup in section 5 after this launch, and after any
      big change from now on, until the automatic weekly backup ships.

## 5. Manual backup

There's no automatic backup yet (it's a later piece of work). Until then,
run this by hand after seeding and after any big change:

```sh
task backup
```

or directly:

```sh
mkdir -p ~/emibonnie-backups
chmod 700 ~/emibonnie-backups
pg_dump --format=custom --file="$HOME/emibonnie-backups/$(date +%F)-main.dump" --dbname="$EMIBONNIE_DB"
```

Use **Postgres 17** client tools (`pg_dump`/`pg_restore`) to match Neon's
server version — check with `pg_dump --version`.

- The target directory is outside this repo, and only readable by you
  (`chmod 700`). **Never commit a dump file.** It contains translators'
  real tweet text and handles.
- Do the same for the `preview` branch (swap `--dbname="$EMIBONNIE_DB"` for
  `--dbname="$EMIBONNIE_DB_PREVIEW"`) if you've put anything in it worth
  keeping.
- **To restore**, into an **empty** database. The target (an empty branch
  you're restoring into) usually isn't `EMIBONNIE_DB`/`EMIBONNIE_DB_PREVIEW`
  itself, so read its **owner**-role connection string into its own
  variable the same no-echo way as the top of this guide, rather than
  typing or pasting it onto a command line. Then, in this order:
  ```sh
  read -rs RESTORE_TARGET_URL; export RESTORE_TARGET_URL

  # 1. Create the app role on the restore target. --target-env-var reads
  #    the owner URL from the variable you name, and never touches Vercel:
  #    it writes the new app-role connection string to a chmod 600 file
  #    (~/.emibonnie/app-restore_target_url.url) and prints only its path.
  site/scripts/create-app-role.sh --target-env-var RESTORE_TARGET_URL

  # 2. Restore the dump.
  pg_restore --no-owner --no-privileges --clean --if-exists --dbname="$RESTORE_TARGET_URL" <dump file>

  # 3. Re-grant the app role on the restored schema.
  DATABASE_URL="$RESTORE_TARGET_URL" APP_DB_ROLE=app npm run migrate
  ```
  - Step 1 says `app` **already exists** if the target was branched from
    a Neon branch that already had it (a child branch starts with its
    parent's roles). That's fine: skip it, or run it again with
    `--rotate --target-env-var RESTORE_TARGET_URL` to give the target its
    own password (and its own file).
  - `--no-owner --no-privileges` restores every object as the role you're
    connecting with (never re-creates the dump-time owner or its grants);
    the `npm run migrate` afterwards re-grants the `app` role on the
    restored schema, the same way it does after every other migrate. That
    needs `app` to exist on the target, which is why step 1 comes first
    (migrate fails with `role "app" does not exist` otherwise).
  - The site keeps using its current database until you switch it. Only
    if this restored database is going to serve the site: in Vercel,
    Settings → Environment Variables → **edit the existing**
    `DATABASE_URL` in the right scope, paste the contents of the file
    from step 1 (type **Secret**), redeploy (`task deploy:prod` or `task
    deploy:preview`), and delete the file.

## 6. Incident runbook

### (a) A secret leaked

If a `DATABASE_URL` (or any other secret) is exposed — committed by mistake,
pasted somewhere public, shown on a screen share:

- **If it's the `app` role's connection string that leaked** (the normal
  case — it's the one Vercel holds):
  ```sh
  task role:rotate:preview    # or
  task role:rotate:prod
  ```
  or directly: `site/scripts/create-app-role.sh --rotate [--prod]`. This
  generates a new password, replaces `app`'s password in the database
  with SQL (plaintext over TLS, as in 1(a); never the Neon console — see section
  1(a)/"Least privilege", above, for why: a console reset would make
  `app` a `neon_superuser` member), and updates the existing
  `DATABASE_URL` Secret in Vercel's matching scope for you, in one step
  (`vercel env update DATABASE_URL --environment <scope> --sensitive
  --yes`, value through stdin —
  [Vercel: `vercel env`](https://vercel.com/docs/cli/env)). If that
  Vercel step fails, the script writes the new connection string to a
  `chmod 600` file under `~/.emibonnie/` instead and prints its path:
  in Vercel, Settings → Environment Variables, **edit the existing
  `DATABASE_URL`** in that scope and replace its value with the file's
  contents (don't add a second one), then delete the file.

  > **Outage warning.** The moment the password changes, the live site
  > can no longer reach the database: the running deployment still has
  > the old password, and Vercel only gives a changed variable to *new*
  > deployments. It stays down until the redeploy finishes, so run the
  > deploy **straight away**, right after the rotation:
  > ```sh
  > task deploy:prod       # after task role:rotate:prod
  > task deploy:preview    # after task role:rotate:preview
  > ```
  > The script prints the same warning, with the right command, when it
  > finishes.
- **If the *owner*-role string leaked instead** (the one only you use, in
  `EMIBONNIE_DB`/`EMIBONNIE_DB_PREVIEW`): in the Neon console, open the
  affected branch → **Roles** → the owner role → **Reset password**, copy
  the new string, and re-run `read -rs EMIBONNIE_DB...; export
  EMIBONNIE_DB...` (top of this guide) with it. The owner role isn't
  created by this archive's own scripts, so resetting it in the console
  is the only option, and it's the one place that's appropriate (you
  never give it to Vercel, so it never needs least-privilege treatment).
- Either way, redeploy afterwards: `task deploy:preview` / `task
  deploy:prod` (or `site/scripts/deploy.sh [--prod]`), so the running
  site picks up the new value — immediately, for an `app` rotation (see
  the outage warning above).
- Check the Neon console's audit/activity log, and Vercel's Activity Log,
  for anything that used the leaked string before you rotated it.

### (b) A takedown request, before the account tools exist

The in-site remove/opt-out buttons are later work (Plan 2) and don't exist
yet. Until then, hiding an item means reaching into the database directly,
the same way the engine's own code does it, so it stays in the audit log
with a real actor on it.

**If the request is urgent** (something is actively circulating), also
purge the Vercel CDN cache right after hiding the item below — public
pages are cached for up to 5 minutes (`s-maxage=300`), so without a purge
the hidden item can keep being served from cache for that long:

```sh
task purge
# or directly: npx --yes vercel@65.1.0 cache purge --type cdn
```

([Vercel: `vercel cache`](https://vercel.com/docs/cli/cache).) If the CLI
can't reach it, the dashboard fallback is the project's "..." menu (or
**Settings**) → **Data Cache**/**CDN** → **Purge Cache**.

**What the engine already gives you:**
- Every item has `deleted_at`, `deleted_by` and `deleted_reason` columns,
  and is hidden from every public page and from search the moment
  `deleted_at` is set (`src/repo/visibility.js`). Nothing is hard-deleted.
- `deleted_reason` must be one of the engine's fixed codes (the
  `deleted_reasons` table); use `hidden_by_owner` for this.
- Every write is checked by a database trigger that refuses it unless
  `app.actor` is set first, in the same transaction, and every such write
  is copied into `audit_log` with that actor
  (`set_common`/`write_audit` in `src/db/migrations/001_initial.sql`). This
  is what the app's own code does via `db.transaction(fn, { actor })`
  (`src/db/client.js`) — there's no CLI for "hide one item" yet, so doing
  this by hand means setting `app.actor` yourself, the same way, with
  `select set_config(...)`.

**There's no CLI command or repo function for this yet** (the `add`
command, `npm run add`, only adds items — nothing removes one). So, until
Plan 2's tools ship, use this one exact statement, run against the
**owner**-role connection string for the right branch:

```sh
task takedown -- <the numeric id from the /t/<id> URL>
# or: ID=<the numeric id> task takedown
```

`task takedown` asks for confirmation, carries the id in a real
environment variable (`TAKEDOWN_ID`, never spliced into shell or SQL
text — the whole id is checked to be digits only before anything runs, so
an id like `1"; rm -rf ~; echo "`, `$(...)`, or one with a newline in it
is rejected, not executed), and
reminds you to purge the CDN cache afterwards. It's exactly this, run
directly:

```sh
psql "$EMIBONNIE_DB" -v ON_ERROR_STOP=1 -v id='<the numeric id from the /t/<id> URL>' <<'SQL'
begin;
select set_config('app.actor', 'system', true);

update items
set deleted_at = now(),
    deleted_by = 'system',
    deleted_reason = 'hidden_by_owner'
where id = (
  select item_id from item_sources
  where platform = 'x'                 -- or the other source platform
    and external_id = :'id'
    and role = 'primary'
    and kind = 'translation'
);

commit;
SQL
```

(Use `$EMIBONNIE_DB_PREVIEW` instead if the item is only in preview.) The
id is passed as a `psql` variable (`-v id=...`) and substituted as a
properly quoted literal (`:'id'`) — never built into the SQL text by
string concatenation, the same rule `task takedown` follows. `-v
ON_ERROR_STOP=1` makes `psql` stop and fail the whole script on the
first error, instead of continuing past it — important since this reaches
into a production database.

What this does and why it's safe:
- It's wrapped in `begin ... commit`, so either both statements apply or
  neither does.
- `set_config('app.actor', 'system', true)` sets the actor for this
  transaction only (the `true` third argument), the same mechanism the
  app's own code uses. `'system'` is the one user row that exists before
  anyone has signed in (seeded by the engine's first migration) — use it
  unless you've since created a real user row for yourself.
- The `update` targets `items` by its **public** id (the number in the
  `/t/<id>` URL) through `item_sources`, rather than by `items.id`
  directly, because the public URL is the source platform's id, not the
  internal one. `and kind = 'translation'` sits *inside* that
  `item_sources` subquery (not as a separate check on the outer `items`
  row), because that's where it actually disambiguates: the unique index
  behind `(platform, external_id)` with `role = 'primary'`
  (`item_sources_primary_per_kind`) only guarantees uniqueness *within one
  kind*. A check added only afterwards, against the outer row, wouldn't
  un-pick a wrong row the subquery had already returned for a different
  kind sharing the same `(platform, external_id)` pair — it's currently
  this archive's only kind, but this stays correct if that ever changes.
- Setting `deleted_reason = 'hidden_by_owner'` is required: a check
  constraint on `items` (`(deleted_at is null) = (deleted_reason is
  null)`) rejects the update without it.
- Because the write goes through the normal trigger path, it lands in
  `audit_log` with `actor = 'system'`, `action = 'update'`, so there's a
  record of who hid it and when, same as any other edit.
- Say "hide first, review second" when you respond: hide the item with the
  statement above, then look into the request afterwards.

**`psql` should print `UPDATE 1`.** If it prints `UPDATE 0` instead, the id
from the URL isn't that item's *current* `item_sources.external_id` — most
likely the post was edited on its platform since it was archived, and the
URL's id is an older version tracked in `source_aliases`. Look it up there
first:

```sql
select s.item_id
from source_aliases a
join item_sources s on s.id = a.source_id
where a.platform = 'x'
  and a.external_id = '<the numeric id from the /t/<id> URL>'
  and s.kind = 'translation';
```

(`source_aliases` has no `item_id` column of its own — it only has
`source_id`, which points at `item_sources.id`; the item's id comes from
*that* row's `item_id`, hence the join.)

Then run the `update` above with `id = <that item_id>` directly, instead
of the `item_sources` subquery.

If you ever need to find an item's internal id or its sources directly
(for example, to double check you're hiding the right one before you run
the statement above), read it first — never guess:

```sql
select i.id, i.occurred_on, s.external_id, s.url
from items i
join item_sources s on s.item_id = i.id and s.role = 'primary'
where s.external_id = '<the numeric id from the /t/<id> URL>';
```

Run that `select` on its own first, confirm it's the right item, then run
the `update` above.
