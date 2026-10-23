#!/usr/bin/env bash
#
# site/scripts/create-app-role.sh [--prod] [--rotate] [--dry-run]
#
# Creates the least-privilege `app` database role on one branch, and adds
# its connection string to Vercel. The owner runs this once per branch:
#   site/scripts/create-app-role.sh            (the Neon `preview` branch)
#   site/scripts/create-app-role.sh --prod     (the Neon main branch)
# and again, with --rotate, whenever the password needs to change (a
# leaked secret -- site/docs/deploy.md, incident runbook 6a):
#   site/scripts/create-app-role.sh --rotate [--prod]
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
# Fix round 3, C1: how the password reaches Postgres without ever being
# sent as SQL text
# -----------------------------------------------------------------------
# An earlier round of this script ran `create role app with login
# password $1`, a bind parameter -- which is not valid SQL. Postgres only
# accepts bind parameters inside SELECT/INSERT/UPDATE/DELETE/MERGE/VALUES
# (the "Parameters" paragraph of
# https://www.postgresql.org/docs/current/sql-prepare.html), never inside
# a DDL statement such as CREATE ROLE or ALTER ROLE; it fails with
# `syntax error at or near "$1"` (reproduced against PGlite).
#
# Instead, `site/scripts/scram.mjs` computes a SCRAM-SHA-256 *verifier*
# for the generated password entirely on this machine (RFC 5802/7677,
# node's own `crypto`), in exactly the text Postgres stores in
# `pg_authid.rolpassword`
# (https://www.postgresql.org/docs/current/auth-password.html). That
# verifier -- never the plaintext password -- is then passed as a bind
# parameter to a plain `select set_config(...)` (valid: SELECT accepts
# parameters), and only *that* already-computed, already-constrained
# value is spliced into `create/alter role ... password %L` with
# `format()`, inside one transaction:
#
#   select set_config('app.pw', $1, true);        -- $1 = the verifier
#   do $$ begin
#     execute format('create role app login password %L', current_setting('app.pw'));
#   end $$;
#
# The plaintext password is generated on this machine (`scram.mjs`'s
# `randomPassword`) and never leaves it except inside the app-role
# connection string this script builds afterwards -- it's never sent to
# Postgres at all, encrypted or not; only the verifier reaches the server.
# Confirmed against PGlite: `pg_authid.rolpassword` ends up byte-for-byte
# equal to the verifier this script computed
# (site/test/scram.test.js).
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
#      (`site/scripts/scram.mjs`'s `randomPassword`, node's own `crypto`
#      -- no dependency on the `openssl` binary) and never prints it.
#   3. Computes its SCRAM-SHA-256 verifier (`scram.mjs`'s
#      `scramSha256Verifier`) and runs `create role app login password
#      %L` (or, with --rotate, `alter role app password %L`) exactly as
#      shown above, through the engine's own db client
#      (src/db/client.js), inside one transaction.
#   4. Builds the app-role connection string from the owner URL: same
#      host, database and query parameters, with the username replaced by
#      `app` and the password by the one just generated.
#   5. Adds that string to Vercel as `DATABASE_URL`, type **Secret**, in
#      the matching scope (Preview, or Production with --prod). With
#      --rotate this *replaces* whatever was there: `vercel env rm
#      DATABASE_URL <scope> --yes` (ignoring failure -- there may be
#      nothing to remove yet) then `vercel env add ... --sensitive --yes`,
#      with the value piped through stdin so it never appears in argv or
#      in this script's own output --
#      https://vercel.com/docs/cli/env:
#        "vercel env add [name] [environment] < [file]"
#        "`vercel env add`... store[s] each variable as Config or Secret.
#        Use --type config or --type secret..."
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
# redacted, and makes no database connection, runs no `node` (for the
# password/verifier/role steps), and calls no `vercel` command. Covered by
# site/test/createAppRoleScript.test.js, run with `node --test site/test/`.

set -euo pipefail

PROD=0
DRY_RUN=0
ROTATE=0
for arg in "$@"; do
  case "$arg" in
    --prod) PROD=1 ;;
    --dry-run) DRY_RUN=1 ;;
    --rotate) ROTATE=1 ;;
    *)
      echo "create-app-role.sh: unknown argument '$arg' (expected --prod, --rotate and/or --dry-run)" >&2
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
  if [ "$ROTATE" -eq 1 ]; then
    log "would check that role 'app' already exists on the $TARGET branch (select 1 from pg_roles where rolname = 'app'); would refuse if it doesn't"
  else
    log "would check whether role 'app' already exists on the $TARGET branch (select 1 from pg_roles where rolname = 'app'); would refuse if it does, and say to use --rotate instead"
  fi
  log "would generate a strong password locally (site/scripts/scram.mjs's randomPassword, node's own crypto) -- never printed"
  log "would compute its SCRAM-SHA-256 verifier locally (site/scripts/scram.mjs) -- the plaintext password is never sent to Postgres, encrypted or not"
  if [ "$ROTATE" -eq 1 ]; then
    log "would run, in one transaction: select set_config('app.pw', '<redacted>', true); do \$\$ ... execute format('alter role app password %L', current_setting('app.pw')); end \$\$;"
  else
    log "would run, in one transaction: select set_config('app.pw', '<redacted>', true); do \$\$ ... execute format('create role app login password %L', current_setting('app.pw')); end \$\$;"
  fi
  log "would build the app-role URL from the owner URL: same host/database/parameters, user 'app', the new password"
  if [ "$ROTATE" -eq 1 ]; then
    log "would run: vercel env rm DATABASE_URL $TARGET --yes (ignoring failure)"
  fi
  log "would run: vercel env add DATABASE_URL $TARGET --sensitive --yes (value piped through stdin, never in argv or output)"
  log "would fall back to a chmod 600 file under ~/.emibonnie/ if that command fails, and print only its path"
  exit 0
fi

# A heredoc with a quoted delimiter, not a single-quoted string: the SQL
# text below needs literal single quotes of its own (SQL string literals
# use them), and a single-quoted bash string can't contain any --
# unescapably, since backslash isn't special inside one either. A quoted
# heredoc does no expansion at all (like a single-quoted string) but
# imposes no restriction on which characters appear in its body.
CODE="$(cat <<'JSEOF'
import { createDb, dbOptionsFromEnv } from "./src/db/client.js";
import { scramSha256Verifier, randomPassword } from "./site/scripts/scram.mjs";

const rotate = process.env.ROTATE === "1";
const db = createDb(dbOptionsFromEnv(process.env));
try {
  const existing = await db.query("select 1 from pg_roles where rolname = $1", ["app"]);
  const exists = existing.rows.length > 0;
  if (rotate && !exists) {
    console.error("ROLE_MISSING");
    process.exitCode = 3;
  } else if (!rotate && exists) {
    console.error("ROLE_EXISTS");
    process.exitCode = 2;
  } else {
    const password = randomPassword();
    const verifier = scramSha256Verifier(password);
    const stmt = rotate ? "alter role app password %L" : "create role app login password %L";
    await db.transaction(async (tx) => {
      await tx.query("select set_config('app.pw', $1, true)", [verifier]);
      await tx.exec(`do $$ begin execute format('${stmt}', current_setting('app.pw')); end $$;`);
    }, { actor: "system" });
    const url = new URL(process.env.DATABASE_URL);
    url.username = "app";
    url.password = password;
    console.error(rotate ? "ROLE_ROTATED" : "ROLE_CREATED");
    process.stdout.write(url.toString());
  }
} finally {
  await db.end();
}
JSEOF
)"

set +e
APP_URL="$(DATABASE_URL="$OWNER_URL" ROTATE="$ROTATE" node --input-type=module -e "$CODE")"
NODE_STATUS=$?
set -e

ROTATE_FLAG_TEXT=""
if [ "$PROD" -eq 1 ]; then ROTATE_FLAG_TEXT=" --prod"; fi

if [ "$NODE_STATUS" -eq 2 ]; then
  echo "create-app-role.sh: role 'app' already exists on the $TARGET branch -- refusing to recreate it." >&2
  echo "To rotate its password instead: site/scripts/create-app-role.sh --rotate$ROTATE_FLAG_TEXT (or 'task role:rotate:preview' / 'task role:rotate:prod'). Never reset it from the Neon console -- that would put 'app' back into neon_superuser (see the header comment above)." >&2
  exit 1
fi
if [ "$NODE_STATUS" -eq 3 ]; then
  echo "create-app-role.sh: --rotate was given but role 'app' does not exist yet on the $TARGET branch." >&2
  echo "Run this once without --rotate first: site/scripts/create-app-role.sh$ROTATE_FLAG_TEXT (or 'task role:preview' / 'task role:prod')." >&2
  exit 1
fi
if [ "$NODE_STATUS" -ne 0 ]; then
  echo "create-app-role.sh: could not create or rotate role 'app' on the $TARGET branch." >&2
  exit "$NODE_STATUS"
fi
if [ "$ROTATE" -eq 1 ]; then
  log "rotated role 'app''s password on the $TARGET branch"
else
  log "created role 'app' on the $TARGET branch"
fi

if [ "$ROTATE" -eq 1 ]; then
  vercel env rm DATABASE_URL "$TARGET" --yes >/dev/null 2>&1 || true
fi

if printf '%s' "$APP_URL" | vercel env add DATABASE_URL "$TARGET" --sensitive --yes; then
  log "set DATABASE_URL as a Secret in Vercel's $TARGET scope"
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
