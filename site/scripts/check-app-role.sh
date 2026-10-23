#!/usr/bin/env bash
#
# site/scripts/check-app-role.sh [--prod] [--dry-run]
#
# The least-privilege check for the `app` database role (fix round 1, C1 of
# the Task 10 review). `site/scripts/deploy.sh` runs this right after every
# migrate; the owner can also run it by hand, standalone, any time.
#
# Fails unless all three of these are `f` (false):
#
#   select pg_has_role('app', 'neon_superuser', 'member'),
#          has_table_privilege('app', 'audit_log', 'update'),
#          has_table_privilege('app', 'audit_log', 'delete');
#
# Why this specific check: a role created in the Neon console (or via the
# Neon API/CLI) is granted membership in `neon_superuser`, which is NOT
# least privilege --
#   "Your Postgres role and roles created in the Neon Console, API, and CLI
#   are granted membership in the neon_superuser role."
#   https://neon.com/docs/manage/roles
# -- whereas "roles created with SQL from clients like psql, pgAdmin, or
# the Neon SQL Editor are only granted the basic public schema privileges
# granted to newly created roles in a standalone Postgres installation"
# (same page). That's why `site/scripts/create-app-role.sh` creates `app` with a
# SQL statement over the owner's own connection, never through the Neon
# console, and why this script re-checks it: a role created the wrong way,
# by mistake, would otherwise look fine until it mattered. The two
# `has_table_privilege` checks confirm the engine's own
# `grant_app_role` (src/db/migrations/001_initial.sql, called from
# src/repo/roles.js during every migrate) hasn't been widened to cover
# `audit_log`, which it must never grant write access to.
#
# Reads its database connection the same way site/scripts/deploy.sh and
# site/scripts/create-app-role.sh do:
#   EMIBONNIE_DB           Neon main branch       (used with --prod)
#   EMIBONNIE_DB_PREVIEW   Neon `preview` branch  (used without --prod)
# -- or, when deploy.sh calls this script itself, an already-exported
# DATABASE_URL (deploy.sh unsets the two EMIBONNIE_DB* names before this
# point, so this script prefers an inherited DATABASE_URL over looking
# them up again). Either way, it never echoes, logs or writes the URL, and
# unsets all three names from its own environment once it has what it
# needs, the same as the other two scripts.
#
# --dry-run prints the one step this run would take and performs no
# database connection. Covered by site/test/checkAppRoleScript.test.js, run
# with `node --test site/test/`.

set -euo pipefail

PROD=0
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --prod) PROD=1 ;;
    --dry-run) DRY_RUN=1 ;;
    *)
      echo "check-app-role.sh: unknown argument '$arg' (expected --prod and/or --dry-run)" >&2
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

# Fix round 3, minor: prefer the named var (EMIBONNIE_DB/EMIBONNIE_DB_PREVIEW)
# over any DATABASE_URL already sitting in the environment, rather than the
# other way around -- a stray, unrelated DATABASE_URL left over in the
# owner's shell from something else must never silently outrank the
# variable that actually names which branch this run means to check.
# deploy.sh (the one caller that passes DATABASE_URL instead) always runs
# this as a standalone process with EMIBONNIE_DB/EMIBONNIE_DB_PREVIEW
# already unset (its own fix round 1, I1), so this still picks up
# DATABASE_URL correctly in that case -- there's nothing for the named var
# to outrank there.
OWNER_URL="${!DB_VAR_NAME:-${DATABASE_URL:-}}"
if [ -z "$OWNER_URL" ]; then
  echo "check-app-role.sh: neither \$$DB_VAR_NAME nor \$DATABASE_URL is set (one must hold the owner-role connection string for the $TARGET database) -- stopping before any step runs" >&2
  exit 1
fi
unset EMIBONNIE_DB EMIBONNIE_DB_PREVIEW DATABASE_URL

log() {
  echo "[check-app-role:$TARGET] $*"
}

if [ "$DRY_RUN" -eq 1 ]; then
  log "would run: select pg_has_role('app','neon_superuser','member'), has_table_privilege('app','audit_log','update'), has_table_privilege('app','audit_log','delete') -- and fail unless all three are f"
  exit 0
fi

CODE='
import { createDb, dbOptionsFromEnv } from "./src/db/client.js";
const db = createDb(dbOptionsFromEnv(process.env));
try {
  const { rows } = await db.query(
    "select pg_has_role($1, $2, $3) as superuser_member, has_table_privilege($1, $4, $5) as can_update_audit, has_table_privilege($1, $4, $6) as can_delete_audit",
    ["app", "neon_superuser", "member", "audit_log", "update", "delete"],
  );
  const row = rows[0];
  console.log(JSON.stringify(row));
  const bad = [];
  if (row.superuser_member) bad.push("app is a member of neon_superuser");
  if (row.can_update_audit) bad.push("app can UPDATE audit_log");
  if (row.can_delete_audit) bad.push("app can DELETE from audit_log");
  if (bad.length > 0) {
    console.error("NOT_LEAST_PRIVILEGE: " + bad.join("; "));
    process.exitCode = 1;
  }
} finally {
  await db.end();
}
'

DATABASE_URL="$OWNER_URL" node --input-type=module -e "$CODE"
log "least-privilege check passed: app is not a neon_superuser member and cannot update or delete audit_log rows"
