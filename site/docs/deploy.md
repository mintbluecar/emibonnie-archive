# Deploying and running this archive

This is the owner's guide for `site/scripts/deploy.sh`: what's already set up, what's
left to do by hand, how the first deploy goes, how to check it worked, the
launch checklist, manual backups, and what to do if something goes wrong.

It assumes you've read [`docs/start-your-own.md`](../../docs/start-your-own.md)
and [`docs/limits.md`](../../docs/limits.md) in the engine. Nothing here repeats
the engine's own setup steps; it only covers what's specific to this archive
and to the manual (no GitHub Actions) deploy path.

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

or the same thing directly:

```sh
EMIBONNIE_DB_PREVIEW="<preview branch's OWNER-role connection string>" site/scripts/create-app-role.sh
EMIBONNIE_DB="<main branch's OWNER-role connection string>" site/scripts/create-app-role.sh --prod
```

Run the first one against `preview`, the second against the main branch.
Each one:
- connects as the owner role and creates `app` with SQL (`create role app
  with login password '<a freshly generated, strong, URL-safe password>'`)
  — never printing the password, never through the Neon console;
- refuses, with instructions for rotating the password instead, if `app`
  already exists on that branch (so you can't run this twice by accident);
- builds that branch's app-role connection string (same host, database and
  parameters, user `app`, the new password) and adds it to Vercel as
  `DATABASE_URL`, type **Secret**, in the matching scope — see (b), below.

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
account this archive uses: X, Google, GitHub, Vercel, Neon, **and the
domain registrar**.

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
also prints a reminder of this every time it runs in preview mode, and
makes a best-effort check for "this project has no deployments yet" when
it can reach Vercel.

In order:

1. **Create the `app` role on both branches** — section 1(a), above:
   ```sh
   task role:preview
   task role:prod
   ```
   or directly:
   ```sh
   EMIBONNIE_DB_PREVIEW="<preview branch's OWNER-role string>" site/scripts/create-app-role.sh
   EMIBONNIE_DB="<main branch's OWNER-role string>" site/scripts/create-app-role.sh --prod
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
   does.
3. **Run the least-privilege check on both branches:**
   ```sh
   task check-role:preview
   task check-role:prod
   ```
   or directly:
   ```sh
   DATABASE_URL="$EMIBONNIE_DB_PREVIEW" site/scripts/check-app-role.sh
   DATABASE_URL="$EMIBONNIE_DB" site/scripts/check-app-role.sh --prod
   ```
   Both must print "least-privilege check passed". Don't continue if
   either doesn't.
4. **Make the first deploy `site/scripts/deploy.sh --prod`** (not a plain
   `site/scripts/deploy.sh`) — see the reasoning above.
   ```sh
   task deploy:prod
   ```
   or directly:
   ```sh
   EMIBONNIE_DB="$EMIBONNIE_DB" site/scripts/deploy.sh --prod
   ```
   `--prod` asks you to type a confirmation phrase before it touches the
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

## 3. Verification checklist

**Against the production domain** (not a generated `*.vercel.app`
deployment URL — Vercel only serves the production domain from the latest
*production* deployment):

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

**For a preview deployment,** `curl -I` against its generated URL will
usually hit Vercel's deployment protection wall and never reach this
site's own headers. Use `vercel curl` instead, which adds the bypass
token for you:

```sh
npx --yes vercel@65.1.0 curl -I /
```

— "The `vercel curl` command works like `curl`, but automatically handles
deployment protection bypass tokens for you." ([Vercel: `vercel curl`](https://vercel.com/docs/cli/curl))
Run it from this repo, linked to the project, so it can find the right
deployment and bypass token.

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
- [ ] The domain is registered with the fan email, with registrant data
      redacted (WHOIS privacy on).
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
- **To restore**, into an **empty** database:
  ```sh
  pg_restore --no-owner --no-privileges --clean --if-exists --dbname="<target database's OWNER-role string>" <dump file>
  APP_DB_ROLE=app DATABASE_URL="<same target database's OWNER-role string>" npm run migrate
  ```
  `--no-owner --no-privileges` restores every object as the role you're
  connecting with (never re-creates the dump-time owner or its grants);
  the `npm run migrate` afterwards re-grants the `app` role on the
  restored schema, the same way it does after every other migrate.

## 6. Incident runbook

### (a) A secret leaked

If a `DATABASE_URL` (or any other secret) is exposed — committed by mistake,
pasted somewhere public, shown on a screen share:

1. In the Neon console, open the affected branch → **Roles** → the leaked
   role (`app`, or the owner role if that's what leaked) → **Reset
   password**. This invalidates the old connection string immediately.
2. Copy the new connection string.
3. In Vercel, update the `DATABASE_URL` Secret (Settings → Environment
   Variables → edit → paste the new value) for the affected scope
   (Production or Preview).
4. Redeploy: `site/scripts/deploy.sh` (add `--prod` for production), so the
   running site picks up the new value. The migrate step inside it will
   reconnect with the new string.
5. Check the Neon console's audit/activity log, and Vercel's Activity Log,
   for anything that used the leaked string before you rotated it.

### (b) A takedown request, before the account tools exist

The in-site remove/opt-out buttons are later work (Plan 2) and don't exist
yet. Until then, hiding an item means reaching into the database directly,
the same way the engine's own code does it, so it stays in the audit log
with a real actor on it.

**If the request is urgent** (something is actively circulating), also
purge the Vercel CDN cache for this project (Project → the "..." menu →
**Purge Cache**, or the equivalent in **Settings** → **Data Cache**) right
after hiding the item below — public pages are cached for up to 5 minutes
(`s-maxage=300`), so without a purge the hidden item can keep being served
from cache for that long.

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

`task takedown` asks for confirmation, passes the id to `psql` as a bound
variable (never interpolated into the SQL text — see "What this does and
why it's safe", below), and reminds you to purge the CDN cache afterwards.
It's exactly this, run directly:

```sh
psql "$EMIBONNIE_DB" -v ON_ERROR_STOP=1 -v id='<the numeric id from the /t/<id> URL>' <<'SQL'
begin;
select set_config('app.actor', 'system', true);

update items
set deleted_at = now(),
    deleted_by = 'system',
    deleted_reason = 'hidden_by_owner'
where kind = 'translation'
  and id = (
    select item_id from item_sources
    where platform = 'x'                 -- or the other source platform
      and external_id = :'id'
      and role = 'primary'
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
  internal one. `and kind = 'translation'` keeps this narrowed to the one
  item kind this archive currently has, in case a future kind ever shares
  the same `(platform, external_id)` pairing.
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
select item_id from source_aliases
where platform = 'x' and external_id = '<the numeric id from the /t/<id> URL>';
```

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
