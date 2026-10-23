#!/usr/bin/env bash
#
# scripts/deploy.sh [--prod] [--dry-run]
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
#   8. npm run migrate      -- APP_DB_ROLE=app, against the target branch
#   9. vercel deploy --prebuilt [--prod]
#  10. print the deployment URL
#
# Without --prod: deploys a PREVIEW build against the Neon `preview` branch.
# With --prod: asks for a typed confirmation before touching the production
# database, then migrates and deploys production.
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
#   path.
# - `vercel pull` cannot fetch the value of a Secret-type environment
#   variable -- https://vercel.com/docs/cli/env#exporting-development-environment-variables:
#   "For Secret variables whose values cannot be read from Vercel, the CLI
#   keeps the real value already in your local file... If your local file
#   has no real value for that key, the CLI writes a placeholder." That's
#   fine here: this build is static (esbuild bundling plus HTML
#   generation) and never touches the database, so `vercel build` needs no
#   working `DATABASE_URL`. Only step 7 (doctor) and step 8 (migrate), below,
#   need one, and they get it from this script, not from `vercel pull`.
#
# -----------------------------------------------------------------------
# Secrets
# -----------------------------------------------------------------------
# This script reads two *owner-role* Neon connection strings from the
# environment (never from a file this script writes, never logged, never
# echoed -- there is no `set -x` anywhere in this file):
#   EMIBONNIE_DB           Neon main branch       (used with --prod)
#   EMIBONNIE_DB_PREVIEW   Neon `preview` branch  (used without --prod)
# The chosen one is exported as `DATABASE_URL` only on the single command
# line of the doctor step (7) and the migrate step (8) below -- never for
# the whole script, and never for build or deploy. If the needed variable
# is empty, this script stops before running anything.
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

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
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

log() {
  echo "[deploy:$TARGET] $*"
}

# Runs a real step (or, under --dry-run, only announces it) and labels it
# with its place in the fixed 10-step order from the top of this file.
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

if [ "$PROD" -eq 1 ]; then
  if [ "$DRY_RUN" -eq 1 ]; then
    log "step 8: would ask for typed confirmation ('yes, migrate production') before touching the production database"
  else
    echo "About to run migrations against the PRODUCTION database ($DB_VAR_NAME)."
    read -r -p "Type 'yes, migrate production' to continue: " CONFIRM
    if [ "$CONFIRM" != "yes, migrate production" ]; then
      echo "deploy.sh: confirmation text did not match -- stopping before migrating" >&2
      exit 1
    fi
  fi
fi

if [ "$DRY_RUN" -eq 1 ]; then
  log "step 8: would run: DATABASE_URL=<redacted> APP_DB_ROLE=app npm run migrate"
else
  log "step 8: running: npm run migrate"
  DATABASE_URL="$DB_URL" APP_DB_ROLE=app npm run migrate
fi

if [ "$DRY_RUN" -eq 1 ]; then
  log "step 9: would run: vercel pull --yes --environment=$TARGET"
  if [ "$PROD" -eq 1 ]; then
    log "step 9: would run: vercel build --prod"
    log "step 9: would run: vercel deploy --prebuilt --prod"
  else
    log "step 9: would run: vercel build"
    log "step 9: would run: vercel deploy --prebuilt"
  fi
  log "step 10: would print the deployment URL"
else
  log "step 9: running: vercel pull --yes --environment=$TARGET"
  vercel pull --yes --environment="$TARGET"
  if [ "$PROD" -eq 1 ]; then
    log "step 9: running: vercel build --prod"
    vercel build --prod
    log "step 9: running: vercel deploy --prebuilt --prod"
    DEPLOY_URL="$(vercel deploy --prebuilt --prod)"
  else
    log "step 9: running: vercel build"
    vercel build
    log "step 9: running: vercel deploy --prebuilt"
    DEPLOY_URL="$(vercel deploy --prebuilt)"
  fi
  log "step 10: deployed"
  echo "$DEPLOY_URL"
fi
