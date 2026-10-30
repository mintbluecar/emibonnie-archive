#!/usr/bin/env bash
#
# site/scripts/create-app-role.sh [--prod] [--rotate] [--dry-run]
# site/scripts/create-app-role.sh --target-env-var NAME [--rotate] [--dry-run]
#
# Creates the least-privilege `app` database role on one branch, and adds
# its connection string to Vercel. The owner runs this once per branch:
#   site/scripts/create-app-role.sh            (the Neon `preview` branch)
#   site/scripts/create-app-role.sh --prod     (the Neon main branch)
# and again, with --rotate, whenever the password needs to change (a
# leaked secret -- site/docs/deploy.md, incident runbook 6a):
#   site/scripts/create-app-role.sh --rotate [--prod]
# and, for a database that is neither of those two branches (a restore
# target -- site/docs/deploy.md, section 5), with the owner URL in an env
# var of your choosing, and no Vercel step at all (fix round 4, R3):
#   site/scripts/create-app-role.sh --target-env-var RESTORE_TARGET_URL
#
# Added in fix round 1 (review, C1): a role created in the Neon console
# (or via the Neon API/CLI) is granted membership in `neon_superuser` --
#   "Your Postgres role and roles created in the Neon Console, API, and CLI
#   are granted membership in the neon_superuser role."
#   https://neon.com/docs/manage/roles
# -- which is admin-level (CREATEDB, CREATEROLE, BYPASSRLS included) and
# therefore NOT least privilege, however narrow the SQL grants look
# afterwards. The same page says roles created with SQL, from a client
# like psql, get only the ordinary privileges of a freshly created
# standalone Postgres role. So this script creates (or, with --rotate,
# repasswords) `app` with SQL, over the owner's own connection, never
# through the Neon console or the Neon API -- and that's also why it
# exists at all, rather than "reset the password in the Neon console" from
# earlier rounds' incident runbook: that would have put `app` back into
# `neon_superuser`. After this runs, `npm run migrate` (run with
# `APP_DB_ROLE=app`, as site/scripts/deploy.sh already does) grants `app`
# exactly what the engine's own `grant_app_role` gives it
# (src/db/migrations/001_initial.sql, src/repo/roles.js) -- read/write on
# every table except `audit_log` and the migration-tracking table.
# `site/scripts/check-app-role.sh` re-confirms this after every migrate.
#
# -----------------------------------------------------------------------
# How the password reaches Postgres (fix round 3, C1; fix round 5)
# -----------------------------------------------------------------------
# `create role app with login password $1` -- a bind parameter -- is not
# valid SQL. Postgres only accepts bind parameters inside SELECT/INSERT/
# UPDATE/DELETE/MERGE/VALUES (the "Parameters" paragraph of
# https://www.postgresql.org/docs/current/sql-prepare.html), never inside
# a DDL statement such as CREATE ROLE or ALTER ROLE; it fails with
# `syntax error at or near "$1"` (reproduced against PGlite). So the
# password is passed as a bind parameter to a plain `select set_config(...)`
# (valid: SELECT accepts parameters), and only then quoted into the DDL
# server-side with `format('%L')`, inside one transaction:
#
#   select set_config('app.pw', $1, true);        -- $1 = the password
#   do $$ begin
#     execute format('create role app login password %L', current_setting('app.pw'));
#   end $$;
#
# Fix round 5: $1 is the *plaintext* password. Rounds 3-4 sent a
# pre-computed SCRAM-SHA-256 verifier instead, and the real Neon preview
# branch refused it ("Neon only supports being given plaintext passwords").
# Neon's docs: "Passwords must be supplied in plain text but are encrypted
# when stored. Hashed passwords are not supported."
# (https://neon.com/docs/manage/roles). So, plainly:
#   - the plaintext password travels to Neon over TLS (the Neon serverless
#     driver's secure WebSocket; Neon connection strings carry
#     `sslmode=require`), and Neon stores it encrypted;
#   - if the statement fails, it can appear in the server's error log
#     (Postgres logs a failed statement's context, which holds it);
#   - it is never printed locally, never in argv, and never on disk except
#     inside the app-role connection string in the chmod-600 fallback file
#     (step 6 below).
#
# What this script does, in order:
#   1. Connects as the owner role (EMIBONNIE_DB or EMIBONNIE_DB_PREVIEW)
#      and checks whether `app` already exists.
#        - Without --rotate: refuses if it already exists, and says to
#          run this again with --rotate instead of touching the Neon
#          console (never recreates or overwrites an existing role).
#        - With --rotate: refuses if it does *not* already exist, and
#          says to run this again without --rotate first.
#   2. Generates a strong, URL-safe password locally
#      (`site/scripts/password.mjs`'s `randomPassword`: 44 characters,
#      about 264 bits, node's own `crypto`) and never prints it.
#   3. Runs `create role app login password %L` (or, with --rotate,
#      `alter role app password %L`) with that plaintext password, exactly
#      as shown above, through the engine's own db client
#      (src/db/client.js), inside one transaction. Steps 1-4 live in
#      `site/scripts/app-role.mjs` (fix round 4, N1), which also catches
#      every error and prints only its code and a redacted first line (the
#      password and any `password '...'` text replaced): a failed DDL's
#      `where` field holds the expanded statement, password included, and
#      is never printed. (The server's error log may still record it --
#      see above.)
#   4. Builds the app-role connection string from the owner URL: same
#      host, database and query parameters, with the username replaced by
#      `app` and the password by the one just generated.
#   5. Adds that string to Vercel as `DATABASE_URL`, type **Secret**, in
#      the matching scope (Preview, or Production with --prod), with the
#      value piped through stdin so it never appears in argv or in this
#      script's own output (https://vercel.com/docs/cli/env, checked
#      2026-10-23, and `npx --yes vercel@65.1.0 env add|update --help`):
#        - first time: `vercel env add DATABASE_URL --environment <scope>
#          --sensitive --yes`. "`vercel env add` and `vercel env update`
#          store each variable as Config or Secret... The `--sensitive`
#          and `--no-sensitive` flags map to Secret and Config."
#        - --rotate (fix round 4, R1): one step, `vercel env update
#          DATABASE_URL --environment <scope> --sensitive --yes` --
#          "The `vercel env update` sub-command updates the value of an
#          existing environment variable", stdin form `cat ~/.npmrc |
#          vercel env update NPM_RC preview`, and `--yes` "to skip the
#          update confirmation". This replaces fix round 3's silenced
#          `env rm` then `env add`, which could leave no DATABASE_URL at
#          all if the add failed after the rm succeeded.
#      65.1.0's help names the environment with `--environment` (the
#      positional form the docs page shows is parsed as a legacy alias),
#      so that's what this uses. Preview and git branches: in 65.1.0,
#      `env add` asks "Git branch?" for a Preview-only variable unless
#      `--git-branch` or `--yes` is given (read from the CLI bundle,
#      dist/commands/env/index.js: the prompt is skipped when
#      `opts["--yes"]`; `--yes` accepts the default, "Leave empty to apply
#      to all Preview branches"). This always passes `--yes` and never
#      `--git-branch`, so a Preview DATABASE_URL covers every preview
#      branch.
#      With --target-env-var, this step is skipped entirely: the string
#      goes straight to the file in step 6.
#   6. If that command fails for any reason, writes the connection string
#      to a `chmod 600` file outside this repo (`~/.emibonnie/app-<scope>.url`),
#      prints only that path and the steps to paste it into the Vercel
#      dashboard as a Secret by hand (with --rotate: edit the existing
#      DATABASE_URL, don't add a second one), and tells the owner to delete
#      the file afterwards. This file lives under `site/`, so it's exempt from
#      the engine's own fandom-neutrality check (`test/purity.test.js`)
#      and from `site/test/engineNeutral.test.js` (fix round 2: moved here
#      from `scripts/`, which had neither exemption).
#   7. With --rotate (fix round 4, R2): warns that the live site can't
#      reach the database until a redeploy finishes -- the running
#      deployment still holds the old password, and Vercel only gives a
#      changed variable to new deployments -- and names the `task deploy:*`
#      command to run straight away.
#
# Reads EMIBONNIE_DB / EMIBONNIE_DB_PREVIEW the same way site/scripts/deploy.sh
# does (lib.sh's read_db_url; or, with --target-env-var, the variable named
# there), and unsets all of them (plus DATABASE_URL) from its own
# environment the moment it has copied the one it needs. Never echoes, logs or writes the
# owner connection string, the generated password, or the app-role
# connection string, except into the one `chmod 600` fallback file in step
# 6 above.
#
# The shared preamble (arguments, target, the URL read and unset, `step`,
# the pinned `vercel`) is site/scripts/lib.sh.
#
# --dry-run prints the steps this run would take, with every secret
# redacted, and makes no database connection, runs no `node` (for the
# password/role steps), and calls no `vercel` command. Covered by
# site/test/createAppRoleScript.test.js, run with `node --test site/test/`.

set -euo pipefail
# shellcheck source=site/scripts/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

ROTATE=0
TARGET_ENV_VAR=""
USAGE_FLAGS="--prod, --rotate, --target-env-var NAME and/or --dry-run"
# shellcheck disable=SC2034 # EXTRA_ARGS_USED is read by lib.sh's select_target
extra_arg() {
  case "$1" in
    --rotate) ROTATE=1; EXTRA_ARGS_USED=1 ;;
    --target-env-var)
      if [ "$#" -lt 2 ] || [[ $2 == --* ]]; then
        echo "create-app-role.sh: --target-env-var needs a variable name, e.g. --target-env-var RESTORE_TARGET_URL" >&2
        exit 1
      fi
      TARGET_ENV_VAR="$2"
      EXTRA_ARGS_USED=2
      ;;
  esac
}
select_target "$@"

if [ -n "$TARGET_ENV_VAR" ]; then
  if ! [[ $TARGET_ENV_VAR =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
    echo "create-app-role.sh: --target-env-var expects an environment variable name (letters, digits, _), not '$TARGET_ENV_VAR'" >&2
    exit 1
  fi
  case "$TARGET_ENV_VAR" in
    PATH|HOME|PWD|SHELL|USER)
      echo "create-app-role.sh: --target-env-var $TARGET_ENV_VAR is a shell variable, not a connection string -- use a name of your own, e.g. RESTORE_TARGET_URL" >&2
      exit 1
      ;;
  esac
  if [ "$PROD" -eq 1 ]; then
    echo "create-app-role.sh: --target-env-var and --prod can't be combined -- --prod means the main branch (EMIBONNIE_DB); --target-env-var means some other database" >&2
    exit 1
  fi
fi

cd "$REPO_ROOT"

# SET_VERCEL=1: add/update the Vercel Secret. 0 (--target-env-var): file only.
SET_VERCEL=1
if [ -n "$TARGET_ENV_VAR" ]; then
  TARGET="$TARGET_ENV_VAR"
  DB_VAR_NAME="$TARGET_ENV_VAR"
  SET_VERCEL=0
fi
read_db_url

# The flags to repeat this run with, for the hints printed below.
FLAG_TEXT=""
if [ "$PROD" -eq 1 ]; then FLAG_TEXT=" --prod"; fi
if [ -n "$TARGET_ENV_VAR" ]; then FLAG_TEXT=" --target-env-var $TARGET_ENV_VAR"; fi

if [ "$PROD" -eq 1 ]; then
  REDEPLOY_TASK="task deploy:prod"
  REDEPLOY_SCRIPT="site/scripts/deploy.sh --prod"
else
  REDEPLOY_TASK="task deploy:preview"
  REDEPLOY_SCRIPT="site/scripts/deploy.sh"
fi

# Fix round 4, R2: after a rotation the running deployment still holds the
# old password, and Vercel only hands a changed variable to *new*
# deployments -- so until the redeploy finishes, the live site can't reach
# the database at all.
rotation_outage_warning() {
  log "WARNING: the database password has changed. The live $TARGET site can't reach the database until a redeploy finishes."
  log "Redeploy straight away: $REDEPLOY_TASK   (or: $REDEPLOY_SCRIPT)"
}

# Fix round 4, R1: --rotate updates the existing variable in one step.
if [ "$ROTATE" -eq 1 ]; then
  VERCEL_ENV_CMD=(env update DATABASE_URL --environment "$TARGET" --sensitive --yes)
  ROLE_STMT="alter role app password %L"
else
  VERCEL_ENV_CMD=(env add DATABASE_URL --environment "$TARGET" --sensitive --yes)
  ROLE_STMT="create role app login password %L"
fi

FALLBACK_NAME=".emibonnie/app-$(printf '%s' "$TARGET" | tr '[:upper:]' '[:lower:]').url"

# Steps 1-4 of the header, all inside site/scripts/app-role.mjs.
run_app_role() {
  set +e
  APP_URL="$(with_db env ROTATE="$ROTATE" node site/scripts/app-role.mjs)"
  NODE_STATUS=$?
  set -e
  DB_URL=""

  if [ "$NODE_STATUS" -eq 2 ]; then
    echo "create-app-role.sh: role 'app' already exists on the $TARGET database -- refusing to recreate it." >&2
    if [ -n "$TARGET_ENV_VAR" ]; then
      echo "If this database was branched or restored from one that already had 'app', that's expected. To give it a new password: site/scripts/create-app-role.sh --rotate$FLAG_TEXT. Never reset it from the Neon console -- that would put 'app' back into neon_superuser (see the header comment above)." >&2
    else
      echo "To rotate its password instead: site/scripts/create-app-role.sh --rotate$FLAG_TEXT (or 'task role:rotate:preview' / 'task role:rotate:prod'). Never reset it from the Neon console -- that would put 'app' back into neon_superuser (see the header comment above)." >&2
    fi
    exit 1
  fi
  if [ "$NODE_STATUS" -eq 3 ]; then
    echo "create-app-role.sh: --rotate was given but role 'app' does not exist yet on the $TARGET database." >&2
    echo "Run this once without --rotate first: site/scripts/create-app-role.sh$FLAG_TEXT" >&2
    exit 1
  fi
  if [ "$NODE_STATUS" -ne 0 ]; then
    echo "create-app-role.sh: could not create or rotate role 'app' on the $TARGET database (the error code is on the line above)." >&2
    exit "$NODE_STATUS"
  fi
  if [ "$ROTATE" -eq 1 ]; then
    log "rotated role 'app''s password on the $TARGET database"
  else
    log "created role 'app' on the $TARGET database"
  fi
}

write_fallback_file() {
  FALLBACK_FILE="$HOME/$FALLBACK_NAME"
  mkdir -p "$(dirname "$FALLBACK_FILE")"
  chmod 700 "$(dirname "$FALLBACK_FILE")"
  (umask 077 && printf '%s' "$APP_URL" > "$FALLBACK_FILE")
  chmod 600 "$FALLBACK_FILE"
}

# Step 5 of the header, or step 6 if it fails.
set_vercel_secret() {
  if printf '%s' "$APP_URL" | vercel "${VERCEL_ENV_CMD[@]}"; then
    if [ "$ROTATE" -eq 1 ]; then
      log "updated the DATABASE_URL Secret in Vercel's $TARGET scope"
    else
      log "set DATABASE_URL as a Secret in Vercel's $TARGET scope"
    fi
  else
    write_fallback_file
    log "vercel ${VERCEL_ENV_CMD[0]} ${VERCEL_ENV_CMD[1]} could not set the Secret directly. Wrote the connection string to:"
    log "  $FALLBACK_FILE"
    if [ "$ROTATE" -eq 1 ]; then
      log "Paste it into Vercel by hand: Settings -> Environment Variables -> edit the existing DATABASE_URL in the $TARGET scope (type Secret) and replace its value. Don't add a second one."
    else
      log "Paste it into Vercel by hand: Settings -> Environment Variables -> add DATABASE_URL, type Secret, scope $TARGET."
    fi
    log "Then delete that file."
  fi
  APP_URL=""
}

# --target-env-var: step 6 only.
write_target_file() {
  write_fallback_file
  APP_URL=""
  log "--target-env-var: Vercel was not touched. The app-role connection string for this database is in:"
  log "  $FALLBACK_FILE"
  log "Use it only if this database is going to serve the site (Vercel: Settings -> Environment Variables -> edit the existing DATABASE_URL, type Secret, in the right scope; then redeploy). Delete that file once it's no longer needed."
}

if [ "$ROTATE" -eq 1 ]; then
  EXISTS_TEXT="check that role 'app' already exists on the $TARGET database (select 1 from pg_roles where rolname = 'app'); refuse if it doesn't"
else
  EXISTS_TEXT="check whether role 'app' already exists on the $TARGET database (select 1 from pg_roles where rolname = 'app'); refuse if it does, and say to use --rotate instead"
fi
step 1 "DATABASE_URL=<redacted> node site/scripts/app-role.mjs, which will: $EXISTS_TEXT; generate a strong password locally (site/scripts/password.mjs's randomPassword, node's own crypto) -- never printed, never in argv; send that plaintext password to Neon over TLS as a bind parameter (Neon requires plaintext and stores it encrypted: https://neon.com/docs/manage/roles), where it can appear in the server's error log if the statement fails; in one transaction: select set_config('app.pw', '<redacted>', true); do \$\$ ... execute format('$ROLE_STMT', current_setting('app.pw')); end \$\$; print only an error code and a redacted message if that fails (never the statement, which holds the password); build the app-role URL from the owner URL: same host/database/parameters, user 'app', the new password" -- run_app_role

if [ "$SET_VERCEL" -eq 1 ]; then
  step 2 "vercel ${VERCEL_ENV_CMD[*]} (value piped through stdin, never in argv or output); if that fails, a chmod 600 file, ~/$FALLBACK_NAME, printing only its path" -- set_vercel_secret
else
  step 2 "skip Vercel (--target-env-var): write the URL to a chmod 600 file, ~/$FALLBACK_NAME, and print only its path" -- write_target_file
fi

if [ "$ROTATE" -eq 1 ] && [ "$SET_VERCEL" -eq 1 ]; then
  step 3 "warn that the live $TARGET site can't reach the database until a redeploy finishes, and say to run: $REDEPLOY_TASK" -- rotation_outage_warning
fi
