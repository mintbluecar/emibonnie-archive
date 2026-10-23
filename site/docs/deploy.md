# Deploying and running this archive

This is the owner's guide for `scripts/deploy.sh`: what's already set up, what's
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

**(a) Create the app role in Neon, on both branches.**

In the Neon console, for **both** the main branch and the `preview` branch:

1. Go to the branch → **Roles** → **Create role**. Name it `app`.
2. Copy the connection string Neon shows for that role, for that branch.
   Keep the main branch's and the `preview` branch's app-role strings
   separate — you'll need them in step (b).

Don't give the app role write access to anything you haven't checked: the
engine's own migration grants it read/write on every table except the audit
log and the migration-tracking table (see "Least privilege", below). You
don't need to grant anything by hand.

**(b) Set `DATABASE_URL` in Vercel, after the project is linked.**

The executor (not you) runs `vercel link` once to connect this repo to a
Vercel project. After that's done:

1. In the Vercel dashboard, open the project → **Settings** →
   **Environment Variables**.
2. Add `DATABASE_URL`, type **Secret** (write-only after saving):
   - **Production** scope → the **main branch's app-role** connection string
     (from step (a)).
   - **Preview** scope → the **`preview` branch's app-role** connection
     string (from step (a)).

Only `DATABASE_URL` is needed. The app never reads a second, preview-only
variable name — Vercel picks the right value for you based on which scope a
deployment belongs to.

**(c) Confirm 2FA.**

Check that 2FA (an authenticator app or a passkey) is on for every fan
account this archive uses: X, Google, GitHub, Vercel, and Neon.

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
never the owner-role one.

## 2. First deploy

Do the **preview** branch first, check it, then do **production**.

### Preview

```sh
DATABASE_URL="<preview branch's OWNER-role string>" npm run setup
# Expected: the engine migration applied, then "seeded 2 people"

DATABASE_URL="<preview branch's OWNER-role string>" npm run seed-dev
# Expected: "seeded 6"
```

Use the **owner**-role string here, not the app role's — `setup` and
`seed-dev` are things you run by hand, not the deployed app.

Then run the deploy script without `--prod`:

```sh
EMIBONNIE_DB_PREVIEW="<preview branch's OWNER-role string>" scripts/deploy.sh
```

(`EMIBONNIE_DB_PREVIEW` only needs to be set for this one command — it's read
from your shell's environment, never written anywhere.)

Check the preview deployment with the checklist in section 3, below.

### Production

Once the preview looks right:

```sh
DATABASE_URL="<main branch's OWNER-role string>" npm run setup
# Expected: "seeded 2 people"

DATABASE_URL="<main branch's OWNER-role string>" npm run seed-dev
# Expected: "seeded 6"

EMIBONNIE_DB="<main branch's OWNER-role string>" scripts/deploy.sh --prod
```

`--prod` asks you to type a confirmation phrase before it touches the
production database — read the prompt before answering.

## 3. Verification checklist

Run this after every deploy (preview or production), against that
deployment's URL:

- **Headers.** `curl -I https://<deployment-url>/` and check for:
  - a `Content-Security-Policy` header
  - `Strict-Transport-Security` (HSTS)
  - `Cache-Control: ...s-maxage=300...` on a public page
  - an `x-vercel-id` header containing `sin1` (confirms the Singapore
    region)
- **Link preview.** Paste a `/t/<id>` link into Telegram and into X (or
  Threads). Both should show the right title and description, not a
  generic fallback.
- **On a phone:** open an entry with a clip. It should play, and stay
  pinned at the top while you scroll the credits and bubbles below it.
- **Neon console:** the project's compute settings still show autoscaling
  capped at **0.25 CU**.

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
mkdir -p ~/emibonnie-backups
pg_dump --format=custom --file="$HOME/emibonnie-backups/$(date +%Y-%m-%d)-main.dump" "<main branch's OWNER-role string>"
```

Use **Postgres 17** client tools (`pg_dump`/`pg_restore`) to match Neon's
server version — check with `pg_dump --version`.

- The target directory is outside this repo. **Never commit a dump file.**
  It contains translators' real tweet text and handles.
- Do the same for the `preview` branch if you've put anything in it worth
  keeping.
- To restore into an **empty** database:
  `pg_restore --clean --if-exists --dbname="<target database's OWNER-role string>" <dump file>`.

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
4. Redeploy: `scripts/deploy.sh` (add `--prod` for production), so the
   running site picks up the new value. The migrate step inside it will
   reconnect with the new string.
5. Check the Neon console's audit/activity log, and Vercel's Activity Log,
   for anything that used the leaked string before you rotated it.

### (b) A takedown request, before the account tools exist

The in-site remove/opt-out buttons are later work (Plan 2) and don't exist
yet. Until then, hiding an item means reaching into the database directly,
the same way the engine's own code does it, so it stays in the audit log
with a real actor on it.

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
Plan 2's tools ship, use this one exact statement pattern, run with `psql`
against the **owner**-role connection string for the right branch:

```sql
begin;
select set_config('app.actor', 'system', true);

update items
set deleted_at = now(),
    deleted_by = 'system',
    deleted_reason = 'hidden_by_owner'
where id = (
  select item_id from item_sources
  where platform = 'x'                 -- or the other source platform
    and external_id = '<the numeric id from the /t/<id> URL>'
    and role = 'primary'
);

commit;
```

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
  internal one.
- Setting `deleted_reason = 'hidden_by_owner'` is required: a check
  constraint on `items` (`(deleted_at is null) = (deleted_reason is
  null)`) rejects the update without it.
- Because the write goes through the normal trigger path, it lands in
  `audit_log` with `actor = 'system'`, `action = 'update'`, so there's a
  record of who hid it and when, same as any other edit.
- Say "hide first, review second" when you respond: hide the item with the
  statement above, then look into the request afterwards.

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
