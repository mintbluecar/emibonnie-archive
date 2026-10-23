#!/usr/bin/env bash
#
# site/scripts/create-app-role.sh [--prod] [--dry-run]
#
# Creates the least-privilege `app` database role on one branch, and adds
# its connection string to Vercel. The owner runs this once per branch:
#   site/scripts/create-app-role.sh            (the Neon `preview` branch)
#   site/scripts/create-app-role.sh --prod     (the Neon main branch)
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
# standalone Postgres role. So this script creates `app` with SQL --
# `create role app with login password '<generated>'` -- over the owner's
# own connection, never through the Neon console or the Neon API. After
# this runs, `npm run migrate` (run with `APP_DB_ROLE=app`, as
# site/scripts/deploy.sh already does) grants `app` exactly what the engine's
# own `grant_app_role` gives it (src/db/migrations/001_initial.sql,
# src/repo/roles.js) -- read/write on every table except `audit_log` and
# the migration-tracking table. `site/scripts/check-app-role.sh` re-confirms
# this after every migrate.
#
# What this script does, in order:
#   1. Connects as the owner role (EMIBONNIE_DB or EMIBONNIE_DB_PREVIEW)
#      and checks whether `app` already exists. If it does, this script
#      refuses and prints how to rotate its password instead (see
#      site/docs/deploy.md, incident runbook) -- it never recreates or
#      overwrites an existing role.
#   2. Generates a strong, URL-safe password locally (`openssl rand -base64
#      33`, with `+`/`/` mapped to `-`/`_` and the padding stripped) and
#      never prints it.
#   3. Runs `create role app with login password $1` as a parameterised
#      query through the engine's own db client (src/db/client.js), with
#      the password read from an environment variable, never from argv and
#      never from a `psql -c '...'` command line.
#   4. Builds the app-role connection string from the owner URL: same
#      host, database and query parameters, with the username replaced by
#      `app` and the password by the one just generated.
#   5. Adds that string to Vercel as `DATABASE_URL`, type **Secret**, in
#      the matching scope (Preview, or Production with --prod), piping the
#      value through stdin to `vercel env add` so it never appears in argv
#      or in this script's own output --
#      https://vercel.com/docs/cli/env:
#        "vercel env add [name] [environment] < [file]"
#        "`vercel env add`... store[s] each variable as Config or Secret.
#        Use --type config or --type secret..."
#        (Production and Preview already default to Secret; this script
#        passes --sensitive anyway, to be explicit.)
#   6. If that command fails for any reason, writes the connection string
#      to a `chmod 600` file outside this repo (`~/.emibonnie/app-<scope>.url`),
#      prints only that path and the steps to paste it into the Vercel
#      dashboard as a Secret by hand, and tells the owner to delete the
#      file afterwards. This file lives under `site/`, so it's exempt from
#      the engine's own fandom-neutrality check (`test/purity.test.js`)
#      and from `site/test/engineNeutral.test.js` (fix round 2: moved here
#      from `scripts/`, which had neither exemption).
#
# Reads EMIBONNIE_DB / EMIBONNIE_DB_PREVIEW the same way site/scripts/deploy.sh
# does, and unsets both (plus DATABASE_URL) from its own environment the
# moment it has copied the one it needs. Never echoes, logs or writes the
# owner connection string, the generated password, or the app-role
# connection string, except into the one `chmod 600` fallback file in step
# 6 above.
#
# --dry-run prints the steps this run would take, with every secret
# redacted, and makes no database connection, runs no `openssl`, and calls
# no `vercel` command. Covered by site/test/createAppRoleScript.test.js,
# run with `node --test site/test/`.

set -euo pipefail

PROD=0
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --prod) PROD=1 ;;
    --dry-run) DRY_RUN=1 ;;
    *)
      echo "create-app-role.sh: unknown argument '$arg' (expected --prod and/or --dry-run)" >&2
      exit 1
      ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

if [ "$PROD" -eq 1 ]; then
  TARGET="production"
  DB_VAR_NAME="EMIBONNIE_DB"
else
  TARGET="preview"
  DB_VAR_NAME="EMIBONNIE_DB_PREVIEW"
fi

OWNER_URL="${!DB_VAR_NAME:-}"
if [ -z "$OWNER_URL" ]; then
  echo "create-app-role.sh: \$$DB_VAR_NAME is not set (it must hold the owner-role connection string for the $TARGET database) -- stopping before any step runs" >&2
  exit 1
fi
unset EMIBONNIE_DB EMIBONNIE_DB_PREVIEW DATABASE_URL

log() {
  echo "[create-app-role:$TARGET] $*"
}

VERCEL_CLI_VERSION="65.1.0"
vercel() {
  npx --yes "vercel@${VERCEL_CLI_VERSION}" "$@"
}

if [ "$DRY_RUN" -eq 1 ]; then
  log "would check whether role 'app' already exists on the $TARGET branch (select 1 from pg_roles where rolname = 'app')"
  log "would refuse and print rotation steps if it already exists"
  log "would generate a strong password locally (openssl rand -base64 33, mapped to URL-safe characters) -- never printed"
  log "would run: create role app with login password '<redacted>' (parameterised, via a node one-liner using the owner connection -- never through the Neon console)"
  log "would build the app-role URL from the owner URL: same host/database/parameters, user 'app', the new password"
  log "would run: vercel env add DATABASE_URL $TARGET --sensitive --yes (value piped through stdin, never in argv or output)"
  log "would fall back to a chmod 600 file under ~/.emibonnie/ if that command fails, and print only its path"
  exit 0
fi

CODE='
import { createDb, dbOptionsFromEnv } from "./src/db/client.js";
const password = process.env.APP_ROLE_PASSWORD;
if (!password) {
  console.error("APP_ROLE_PASSWORD is not set");
  process.exit(1);
}
const db = createDb(dbOptionsFromEnv(process.env));
try {
  const existing = await db.query("select 1 from pg_roles where rolname = $1", ["app"]);
  if (existing.rows.length > 0) {
    console.error("ROLE_EXISTS");
    process.exitCode = 2;
  } else {
    await db.query("create role app with login password $1", [password]);
    console.log("ROLE_CREATED");
  }
} finally {
  await db.end();
}
'

PASSWORD="$(openssl rand -base64 33 | tr '+/' '-_' | tr -d '=\n')"

set +e
DATABASE_URL="$OWNER_URL" APP_ROLE_PASSWORD="$PASSWORD" node --input-type=module -e "$CODE"
NODE_STATUS=$?
set -e

if [ "$NODE_STATUS" -eq 2 ]; then
  PASSWORD=""
  echo "create-app-role.sh: role 'app' already exists on the $TARGET branch -- refusing to recreate it." >&2
  echo "To rotate its password instead: Neon console -> the $TARGET branch -> Roles -> app -> Reset password, then update the DATABASE_URL Secret in Vercel's $TARGET scope and redeploy (site/docs/deploy.md, incident runbook, section 6a)." >&2
  exit 1
fi
if [ "$NODE_STATUS" -ne 0 ]; then
  PASSWORD=""
  echo "create-app-role.sh: could not create role 'app' on the $TARGET branch." >&2
  exit "$NODE_STATUS"
fi
log "created role 'app' on the $TARGET branch"

APP_URL="$(DATABASE_URL="$OWNER_URL" APP_ROLE_PASSWORD="$PASSWORD" node -e '
const u = new URL(process.env.DATABASE_URL);
u.username = "app";
u.password = process.env.APP_ROLE_PASSWORD;
process.stdout.write(u.toString());
')"
PASSWORD=""

if printf '%s' "$APP_URL" | vercel env add DATABASE_URL "$TARGET" --sensitive --yes; then
  log "added DATABASE_URL as a Secret in Vercel's $TARGET scope"
else
  FALLBACK_DIR="$HOME/.emibonnie"
  mkdir -p "$FALLBACK_DIR"
  chmod 700 "$FALLBACK_DIR"
  FALLBACK_FILE="$FALLBACK_DIR/app-$TARGET.url"
  printf '%s' "$APP_URL" > "$FALLBACK_FILE"
  chmod 600 "$FALLBACK_FILE"
  log "vercel env add could not set the Secret directly. Wrote the connection string to:"
  log "  $FALLBACK_FILE"
  log "Paste it into Vercel by hand: Settings -> Environment Variables -> add DATABASE_URL, type Secret, scope $TARGET."
  log "Then delete that file."
fi
APP_URL=""
