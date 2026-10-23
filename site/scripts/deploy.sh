#!/usr/bin/env bash
#
# site/scripts/deploy.sh [--prod] [--dry-run]
#
# Manual deploy for this archive. The owner runs this on their own machine,
# logged in to the fan Vercel CLI account. There is no GitHub Actions
# deploy and no Vercel token for this site (owner decision, 2026-10-21).
# CI on GitHub still runs tests only.
#
# Stops at the first failure (`set -euo pipefail`; no `set -x`, so nothing
# this script does is echoed verbatim -- see "Secrets" below). Order:
#   1. npm ci
#   2. npm run build        -- writes the gitignored vercel.json (region,
#                              CSP, headers, rewrites, includeFiles; see
#                              docs/start-your-own.md, "Make site/ yours")
#   3. npm run check
#   4. npm test
#   5. node --test site/test/   -- the name-leak guard
#   6. npm run e2e:site
#   7. npm run doctor
#   8. npm run migrate              -- APP_DB_ROLE=app, against the target
#                                       branch (requires the `app` role to
#                                       already exist: site/scripts/create-app-role.sh)
#   9. site/scripts/check-app-role.sh    -- the least-privilege check (fix round 1)
#  10. vercel pull / vercel build / vercel deploy --prebuilt  [--prod]
#  11. print the deployment URL
#
# Without --prod: deploys a PREVIEW build against the Neon `preview` branch.
# With --prod: asks for a typed confirmation before touching the production
# database, then migrates and deploys production.
#
# -----------------------------------------------------------------------
# First deploy of a brand-new Vercel project is always production
# (fix round 1, I2; detection fixed in fix round 3)
# -----------------------------------------------------------------------
# "The first deployment of a new project is always a production deployment.
# This happens even when you... Run `vercel` or `vercel deploy` from the CLI
# without `--prod`... Run `vercel deploy --target=preview`."
# https://vercel.com/docs/deployments/environments#first-deployment
# So, in preview mode, this script always warns about this, and -- before
# step 1, so nothing real runs first -- tries to confirm this project
# already has a deployment (`vercel list`), *failing closed*: it goes on
# only if that lists at least one `https://...vercel.app` deployment URL,
# and stops on anything else rather than guessing. See
# `site/docs/deploy.md`, section 2, for the owner's actual first-deploy
# order (which is run with `--prod` for exactly this reason).
#
# -----------------------------------------------------------------------
# Deploy mechanism (controller ruling, 2026-10-23): local prebuilt, not a
# plain `vercel deploy`
# -----------------------------------------------------------------------
# `vercel.json` is written by `npm run build` (step 2) and is gitignored
# (see `.gitignore`'s site-repo block). This script has to ship exactly the
# file it just built, so it uses:
#
#   vercel pull --yes --environment=<preview|production>
#   vercel build [--prod]
#   vercel deploy --prebuilt [--prod]
#
# rather than a bare `vercel deploy` (which uploads source for Vercel to
# build *remotely*). Why, with the docs this was checked against:
#
# - `vercel build` runs entirely on this machine and writes `.vercel/output/`
#   per the Build Output API, reading whatever `vercel.json` is on disk right
#   now. No upload happens at this step, so no ignore-file behaviour can
#   substitute a different `vercel.json`.
#   https://vercel.com/docs/cli/build
# - `vercel deploy --prebuilt` ships that `.vercel/output/` directory
#   as-is. Vercel's own "ignored files" list calls this out explicitly:
#   "The `.vercel/output` directory is not ignored when `vercel deploy
#   --prebuilt` is used to deploy a prebuilt Vercel Project, according to
#   the Build Output API specification."
#   https://vercel.com/docs/builds/build-features#ignored-files-and-folders
#   https://vercel.com/docs/cli/deploying-from-cli#deploying-from-local-build-prebuilt
#   This is the only path that *guarantees* the `vercel.json` this run just
#   built is the one that ships.
# - A bare `vercel deploy` would instead upload the current project
#   directory for a *remote* build. Vercel's current docs on what the CLI
#   uploads (https://vercel.com/docs/deployments/vercel-ignore and
#   https://vercel.com/docs/builds/build-features#ignored-files-and-folders)
#   list the literal `.gitignore` *file* among what's always skipped, but
#   document no fallback that reads `.gitignore`'s *patterns* -- only a
#   project's own `.vercelignore` does that, and this repo has none. Relying
#   on that undocumented behaviour to keep `vercel.json` out of a remote
#   build (or, worse, to decide whether it's even uploaded at all) is
#   exactly the ambiguity the prebuilt path avoids entirely.
# - The engine's own Actions-path example
#   (docs/deploy-workflow.example.yml) already uses this same
#   pull/build/deploy --prebuilt sequence, for the same documented reason
#   ("vercel.json is build output (gitignored): `vercel build` reads it
#   before running any builder"). This script mirrors it for the manual
#   path, including the engine example's exact CLI pin (fix round 1, M4).
# - `vercel pull` cannot fetch the value of a Secret-type environment
#   variable -- https://vercel.com/docs/cli/env#exporting-development-environment-variables:
#   "For Secret variables whose values cannot be read from Vercel, the CLI
#   keeps the real value already in your local file... If your local file
#   has no real value for that key, the CLI writes a placeholder." That's
#   fine here: this build is static (esbuild bundling plus HTML
#   generation) and never touches the database, so `vercel build` needs no
#   working `DATABASE_URL`. Only step 7 (doctor), step 8 (migrate) and step
#   9 (the least-privilege check), below, need one, and they get it from
#   this script, not from `vercel pull`.
# - (fix round 1, M5) `vercel build`'s own build step re-runs `npm run
#   build` itself (`vercel.json`'s `buildCommand`), so step 2 below looks
#   redundant with that -- it isn't. Step 2 has to run *before* `vercel
#   build` even starts, because (a) `vercel.json` must already exist on
#   disk for `vercel build` to read it at all (see
#   docs/start-your-own.md, "Make site/ yours"), and (b) steps 3-7 below
#   (check, test, the name-leak guard, e2e:site, doctor) all run against
#   this same build's output, before `vercel build` ever runs.
#
# -----------------------------------------------------------------------
# Secrets
# -----------------------------------------------------------------------
# This script reads two *owner-role* Neon connection strings from the
# environment (never from a file this script writes, never logged, never
# echoed -- there is no `set -x` anywhere in this file):
#   EMIBONNIE_DB           Neon main branch       (used with --prod)
#   EMIBONNIE_DB_PREVIEW   Neon `preview` branch  (used without --prod)
# deploy.sh reads the one it needs into its own, unexported shell variable,
# then immediately `unset`s EMIBONNIE_DB, EMIBONNIE_DB_PREVIEW and
# DATABASE_URL (fix round 1, I1) so no step after that point -- including
# `npm run build`, the test runs, and the Vercel CLI -- can inherit any of
# the three from this process's environment by accident. The chosen value
# is re-exported as `DATABASE_URL` only on the single command line of the
# doctor step (7), the migrate step (8) and the least-privilege check (9)
# below -- never for the whole script, and never for build or deploy. If
# the needed variable is empty, this script stops before running anything.
#
# -----------------------------------------------------------------------
# Testing this script offline
# -----------------------------------------------------------------------
# `--dry-run` prints, in order, the steps this run would take, with every
# URL redacted (`<redacted>`), and performs no network call and no
# git/vercel/npm command, and opens no database connection. It still
# refuses when the needed database env var is empty, before printing
# anything else. Covered by site/test/deployScript.test.js, run with
# `node --test site/test/`.

set -euo pipefail

PROD=0
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --prod) PROD=1 ;;
    --dry-run) DRY_RUN=1 ;;
    *)
      echo "deploy.sh: unknown argument '$arg' (expected --prod and/or --dry-run)" >&2
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

# Indirect expansion: read the env var *named by* $DB_VAR_NAME, never its
# literal text, and never echo its value.
DB_URL="${!DB_VAR_NAME:-}"
if [ -z "$DB_URL" ]; then
  echo "deploy.sh: \$$DB_VAR_NAME is not set (it must hold the owner-role connection string for the $TARGET database) -- stopping before any step runs" >&2
  exit 1
fi

# Fix round 1, I1: drop every database secret from this process's own
# environment the moment we've copied the one we need into $DB_URL, so no
# later step -- a child process, a build tool, the Vercel CLI -- can see it
# just by inheriting this shell's environment.
unset EMIBONNIE_DB EMIBONNIE_DB_PREVIEW DATABASE_URL

log() {
  echo "[deploy:$TARGET] $*"
}

# Diagnostic only (never a secret itself): how many of the three database
# env var names are still visible in this process's environment, right
# after the unset above. Should always be 0. Exercised by
# site/test/deployScript.test.js ("the three database env vars are unset
# for every later step").
REMAINING_DB_VARS="$(env | grep -cE '^(EMIBONNIE_DB|EMIBONNIE_DB_PREVIEW|DATABASE_URL)=' || true)"
log "env check: EMIBONNIE_DB/EMIBONNIE_DB_PREVIEW/DATABASE_URL remaining in this process's environment: $REMAINING_DB_VARS"

# Fix round 1, M4: pin the Vercel CLI to the same version the engine's own
# Actions-path example uses (docs/deploy-workflow.example.yml), rather than
# whatever `vercel` happens to resolve to on this machine's PATH.
VERCEL_CLI_VERSION="65.1.0"
vercel() {
  npx --yes "vercel@${VERCEL_CLI_VERSION}" "$@"
}

# Fix round 1, M4: refuse before doing anything real if this directory
# isn't linked to a Vercel project yet.
if [ "$DRY_RUN" -eq 1 ]; then
  log "would check that .vercel/project.json exists (run 'vercel link' first if it doesn't)"
else
  if [ ! -f "$REPO_ROOT/.vercel/project.json" ]; then
    echo "deploy.sh: $REPO_ROOT/.vercel/project.json is missing -- run 'vercel link' first, then re-run this script." >&2
    exit 1
  fi
fi

# Fix round 1, I3: never ship a stale build from an earlier run.
if [ "$DRY_RUN" -eq 1 ]; then
  log "would run: rm -rf .vercel/output"
else
  rm -rf "$REPO_ROOT/.vercel/output"
fi

if [ "$PROD" -eq 0 ]; then
  log "reminder: a brand-new Vercel project's FIRST deployment is always production, even without --prod (https://vercel.com/docs/deployments/environments#first-deployment). If this is the very first deploy of this project, stop and run 'site/scripts/deploy.sh --prod' instead -- see site/docs/deploy.md, section 2."

  # First-deploy detection (fix round 3: fail closed, run before step 1,
  # capture stderr too; fix round 4, N3: match positively). This proceeds
  # only when `vercel list` exits 0 *and* its output (stdout and stderr
  # together) contains at least one deployment URL --
  # `https://<something>.vercel.app`. Anything else stops this run: a
  # non-zero exit, empty output, "No deployments found.", or any wording
  # this script doesn't recognise. Fix round 3 instead stopped only on a
  # non-zero exit or the words "no deployments", so empty or unfamiliar
  # output with exit 0 slipped through as "has deployments" -- failing
  # open. A false "has deployments" would let a real first deploy run as a
  # preview, quietly land on `preview` data, and still ship it as this
  # project's one-and-only production deployment.
  if [ "$DRY_RUN" -eq 1 ]; then
    log "would check (failing closed) whether this project already has a deployment, via 'vercel list', before step 1 -- proceeding only if it lists at least one https://...vercel.app address, and otherwise stopping here, telling you to use --prod"
  else
    log "checking whether this project already has a deployment (a brand-new project's first deploy must be --prod)"
    set +e
    LIST_OUTPUT="$(vercel list 2>&1)"
    LIST_STATUS=$?
    set -e
    if [ "$LIST_STATUS" -ne 0 ] || ! printf '%s\n' "$LIST_OUTPUT" | grep -Eq 'https://[A-Za-z0-9.-]+\.vercel\.app'; then
      if [ "$LIST_STATUS" -ne 0 ]; then
        echo "deploy.sh: 'vercel list' failed (exit $LIST_STATUS) -- can't confirm this project already has a deployment, so stopping before running anything else." >&2
      else
        echo "deploy.sh: 'vercel list' showed no deployment URL (https://...vercel.app) -- can't confirm this project already has a deployment, so stopping before running anything else." >&2
      fi
      echo "A brand-new Vercel project's first deployment is always production, regardless of flags (https://vercel.com/docs/deployments/environments#first-deployment)." >&2
      echo "If this is genuinely the first deploy of this project, run 'task deploy:prod' (site/scripts/deploy.sh --prod) instead. If it already has one, check that you're logged in to the fan Vercel account and that .vercel/project.json is linked to the right project, run 'npx --yes vercel@$VERCEL_CLI_VERSION list' yourself to see what it says, and retry." >&2
      exit 1
    fi
    log "confirmed: this project already has at least one deployment"
  fi
fi

# Runs a real step (or, under --dry-run, only announces it) and labels it
# with its place in the fixed step order from the top of this file.
step() {
  local n="$1" label="$2"
  shift 2
  if [ "$DRY_RUN" -eq 1 ]; then
    log "step $n: would run: $label"
    return 0
  fi
  log "step $n: running: $label"
  "$@"
}

log "starting (target: $TARGET)"

# Production confirmation comes first, before any check runs, so a typo
# never costs a re-run of the checks (owner, 2026-10-23). It accepts 'yes'
# and asks again on anything else; 'no', an empty answer or three misses
# stop the run with nothing changed.
if [ "$PROD" -eq 1 ]; then
  if [ "$DRY_RUN" -eq 1 ]; then
    log "would ask for confirmation ('yes') before any step runs, since this deploys and migrates PRODUCTION"
  else
    echo "This run migrates the PRODUCTION database ($DB_VAR_NAME) and deploys to production."
    CONFIRMED=0
    for attempt in 1 2 3; do
      read -r -p "Type 'yes' to continue (or 'no' to stop): " CONFIRM
      CONFIRM="$(printf '%s' "$CONFIRM" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
      if [ "$CONFIRM" = "yes" ]; then CONFIRMED=1; break; fi
      if [ "$CONFIRM" = "no" ] || [ -z "$CONFIRM" ]; then break; fi
      echo "Didn't catch that -- please type 'yes' or 'no'."
    done
    if [ "$CONFIRMED" -ne 1 ]; then
      echo "deploy.sh: not confirmed -- stopping before any step runs (nothing changed)" >&2
      exit 1
    fi
  fi
fi

step 1 "npm ci" npm ci
step 2 "npm run build" npm run build
step 3 "npm run check" npm run check
step 4 "npm test" npm test
step 5 "node --test site/test/ (name-leak guard)" node --test site/test/
step 6 "npm run e2e:site" npm run e2e:site

if [ "$DRY_RUN" -eq 1 ]; then
  log "step 7: would run: DATABASE_URL=<redacted> npm run doctor"
else
  log "step 7: running: npm run doctor"
  DATABASE_URL="$DB_URL" npm run doctor
fi

if [ "$DRY_RUN" -eq 1 ]; then
  log "step 8: would run: DATABASE_URL=<redacted> APP_DB_ROLE=app npm run migrate"
  log "step 8: (this fails with \"role \\\"app\\\" does not exist\" unless site/scripts/create-app-role.sh already ran for this branch)"
else
  log "step 8: running: npm run migrate"
  DATABASE_URL="$DB_URL" APP_DB_ROLE=app npm run migrate
fi

# Fix round 1, C1: the least-privilege check, run after every migrate.
CHECK_ARGS=()
PROD_FLAG_TEXT=""
if [ "$PROD" -eq 1 ]; then
  CHECK_ARGS+=(--prod)
  PROD_FLAG_TEXT=" --prod"
fi
if [ "$DRY_RUN" -eq 1 ]; then
  log "step 9: would run: site/scripts/check-app-role.sh$PROD_FLAG_TEXT"
else
  log "step 9: running: site/scripts/check-app-role.sh$PROD_FLAG_TEXT"
  DATABASE_URL="$DB_URL" "$REPO_ROOT/site/scripts/check-app-role.sh" "${CHECK_ARGS[@]}"
fi

if [ "$DRY_RUN" -eq 1 ]; then
  log "step 10: would run: vercel pull --yes --environment=$TARGET"
  if [ "$PROD" -eq 1 ]; then
    log "step 10: would run: vercel build --prod"
    log "step 10: would run: vercel deploy --prebuilt --prod"
  else
    log "step 10: would run: vercel build"
    log "step 10: would run: vercel deploy --prebuilt"
  fi
  log "step 11: would print the deployment URL"
else
  log "step 10: running: vercel pull --yes --environment=$TARGET"
  vercel pull --yes --environment="$TARGET"
  if [ "$PROD" -eq 1 ]; then
    log "step 10: running: vercel build --prod"
    vercel build --prod
    log "step 10: running: vercel deploy --prebuilt --prod"
    DEPLOY_URL="$(vercel deploy --prebuilt --prod)"
  else
    log "step 10: running: vercel build"
    vercel build
    log "step 10: running: vercel deploy --prebuilt"
    DEPLOY_URL="$(vercel deploy --prebuilt)"
  fi
  log "step 11: deployed"
  echo "$DEPLOY_URL"
fi
