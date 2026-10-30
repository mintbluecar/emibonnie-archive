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
# this script does is echoed verbatim -- see "Secrets" below). Every step
# goes through site/scripts/lib.sh's `step`, which prints it and runs it
# from one call, so --dry-run lists exactly the steps a real run takes.
# Order (review, 2026-10-30: build before touching the database):
#   0. .vercel/project.json exists; in preview mode, the first-deploy check
#      (below)
#   1. npm ci
#   2. npm run build        -- writes the gitignored vercel.json (region,
#                              CSP, headers, rewrites, includeFiles; see
#                              docs/start-your-own.md, "Make site/ yours")
#   3. npm run check
#   4. npm test
#   5. node --test site/test/   -- the name-leak guard
#   6. npm run e2e:site
#   7. the tracked files are unchanged since the start
#   8. vercel pull --yes --environment=<preview|production>
#   9. vercel build [--prod]
#  10. --prod only: the typed confirmation
#  11. npm run doctor
#  12. npm run migrate              -- APP_DB_ROLE=app, against the target
#                                       branch (requires the `app` role to
#                                       already exist: site/scripts/create-app-role.sh)
#  13. site/scripts/check-app-role.sh    -- the least-privilege check (fix round 1)
#  14. vercel deploy --prebuilt [--prod], printing the deployment URL
#  15. the region the API function ran in (x-vercel-id), against
#      site.json's region
#
# So a failed check, a changed tree or a failed `vercel build` stops the
# run before any database is touched, and production is asked about only
# once there is a build ready to ship. This script never deletes
# `.vercel/output` itself: `vercel build` (the pinned 65.1.0) removes it
# before it builds -- its dist/commands/build/index.js runs
# `fs.remove(outputDir)` ahead of the build -- so a stale build can't ship,
# and answering "no" at step 10 leaves the new build in place.
#
# Without --prod: deploys a PREVIEW build against the Neon `preview` branch.
# With --prod: once the build is ready, asks for a typed confirmation before
# touching the production database, then migrates and deploys production.
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
#   working `DATABASE_URL`. Only step 11 (doctor), step 12 (migrate) and
#   step 13 (the least-privilege check), below, need one, and they get it
#   from this script, not from `vercel pull`.
# - (fix round 1, M5) `vercel build`'s own build step re-runs `npm run
#   build` itself (`vercel.json`'s `buildCommand`), so step 2 below looks
#   redundant with that -- it isn't. Step 2 has to run *before* `vercel
#   build` even starts, because (a) `vercel.json` must already exist on
#   disk for `vercel build` to read it at all (see
#   docs/start-your-own.md, "Make site/ yours"), and (b) steps 3-6 below
#   (check, test, the name-leak guard, e2e:site) all run against this same
#   build's output, before `vercel build` ever runs.
#
# -----------------------------------------------------------------------
# Secrets
# -----------------------------------------------------------------------
# This script reads two *owner-role* Neon connection strings from the
# environment (never from a file this script writes, never logged, never
# echoed -- there is no `set -x` anywhere in this file):
#   EMIBONNIE_DB           Neon main branch       (used with --prod)
#   EMIBONNIE_DB_PREVIEW   Neon `preview` branch  (used without --prod)
# deploy.sh reads the one it needs into its own, unexported shell variable
# (site/scripts/lib.sh's read_db_url), then immediately `unset`s EMIBONNIE_DB, EMIBONNIE_DB_PREVIEW and
# DATABASE_URL (fix round 1, I1) so no step after that point -- including
# `npm run build`, the test runs, and the Vercel CLI -- can inherit any of
# the three from this process's environment by accident. The chosen value
# is re-exported as `DATABASE_URL` only on the single command line of the
# doctor step (11), the migrate step (12) and the least-privilege check
# (13) below (lib.sh's with_db) -- never for the whole script, and never for build or deploy. If
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
# `node --test site/test/`, which also runs the real script in a scratch
# copy with fake npm, vercel and curl.


set -euo pipefail
# shellcheck source=site/scripts/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

# --quick (owner, 2026-10-23): for fast iteration, skip the heavy checks
# (npm ci when node_modules exists, npm run check, npm test, e2e:site).
# Still runs: build, the name-leak guard, the tree-unchanged guard, doctor,
# migrate and the least-privilege check.
QUICK=0
USAGE_FLAGS="--prod, --quick and/or --dry-run"
# shellcheck disable=SC2034 # EXTRA_ARGS_USED is read by lib.sh's select_target
extra_arg() {
  case "$1" in
    --quick) QUICK=1; EXTRA_ARGS_USED=1 ;;
  esac
}
select_target "$@"
cd "$REPO_ROOT"
read_db_url

PROD_ARGS=()
PROD_FLAG_TEXT=""
if [ "$PROD" -eq 1 ]; then
  PROD_ARGS=(--prod)
  PROD_FLAG_TEXT=" --prod"
fi

# Fix round 1, M4: refuse before doing anything real if this directory
# isn't linked to a Vercel project yet.
require_vercel_link() {
  if [ ! -f "$REPO_ROOT/.vercel/project.json" ]; then
    echo "deploy.sh: $REPO_ROOT/.vercel/project.json is missing -- run 'vercel link' first, then re-run this script." >&2
    exit 1
  fi
}

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
first_deploy_check() {
  local list_output list_status
  set +e
  list_output="$(vercel list 2>&1)"
  list_status=$?
  set -e
  if [ "$list_status" -ne 0 ] || ! printf '%s\n' "$list_output" | grep -Eq 'https://[A-Za-z0-9.-]+\.vercel\.app'; then
    if [ "$list_status" -ne 0 ]; then
      echo "deploy.sh: 'vercel list' failed (exit $list_status) -- can't confirm this project already has a deployment, so stopping before running anything else." >&2
    else
      echo "deploy.sh: 'vercel list' showed no deployment URL (https://...vercel.app) -- can't confirm this project already has a deployment, so stopping before running anything else." >&2
    fi
    echo "A brand-new Vercel project's first deployment is always production, regardless of flags (https://vercel.com/docs/deployments/environments#first-deployment)." >&2
    echo "If this is genuinely the first deploy of this project, run 'task deploy:prod' (site/scripts/deploy.sh --prod) instead. If it already has one, check that you're logged in to the fan Vercel account and that .vercel/project.json is linked to the right project, run 'npx --yes vercel@$VERCEL_CLI_VERSION list' yourself to see what it says, and retry." >&2
    exit 1
  fi
  log "confirmed: this project already has at least one deployment"
}

# The tracked files must not change while this runs: a build made from a
# half-changed tree once shipped a broken production deploy (2026-10-23).
# Generated files are gitignored, so the build itself doesn't count.
tree_fingerprint() {
  # Outside a git checkout (the offline tests run a copy) there is nothing to compare.
  git -C "$REPO_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo no-git; return 0; }
  { git -C "$REPO_ROOT" rev-parse HEAD; git -C "$REPO_ROOT" status --porcelain; git -C "$REPO_ROOT" diff HEAD; } | shasum | cut -d' ' -f1
}
tree_unchanged() {
  if [ "$(tree_fingerprint)" != "$TREE_AT_START" ]; then
    echo "deploy.sh: the repo's files changed while this deploy was running -- stopping before building, so a half-changed copy can't ship. Nothing was deployed; re-run when no one is editing the repo." >&2
    exit 1
  fi
}

# Accepts 'yes' and asks again on anything else; 'no', an empty answer or
# three misses stop the run before the database is touched. The build is
# ready by now, so a typo costs no re-run of the checks.
confirm_production() {
  local attempt answer
  echo "This run migrates the PRODUCTION database ($DB_VAR_NAME) and deploys to production."
  for attempt in 1 2 3; do
    read -r -p "Type 'yes' to continue (or 'no' to stop): " answer || answer=""
    answer="$(printf '%s' "$answer" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
    if [ "$answer" = "yes" ]; then return 0; fi
    if [ "$answer" = "no" ] || [ -z "$answer" ]; then break; fi
    if [ "$attempt" -lt 3 ]; then echo "Didn't catch that -- please type 'yes' or 'no'."; fi
  done
  echo "deploy.sh: not confirmed -- stopping before the database is touched (nothing was migrated or deployed; the build is still in .vercel/output)" >&2
  exit 1
}

deploy_prebuilt() {
  DEPLOY_URL="$(vercel deploy --prebuilt ${PROD_ARGS[@]+"${PROD_ARGS[@]}"})"
  log "deployed"
  echo "$DEPLOY_URL"
}

# Review 2026-10-30, Task 1: production answered with
# `x-vercel-id: sin1::iad1::...` -- the function ran in iad1, far from the
# database. The second `::` field is where the function ran; it is
# compared with site.json's `region`. A mismatch is a warning, not a
# failure: the deployment has already shipped.
post_deploy_region() {
  local url="$1" expected headers status id ran
  # Guarded: an unreadable site.json must not stop the script (set -e) after the deploy shipped.
  expected="$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync("site/site.json", "utf8")).region ?? ""))' 2>/dev/null || true)"
  if [ -z "$expected" ]; then
    echo "deploy.sh: could not check the function region (no region in site/site.json)" >&2
    return 0
  fi
  headers="$(curl -sI --max-time 30 "$url/api/home" | tr -d '\r' || true)"
  status="$(printf '%s\n' "$headers" | awk 'NR == 1 { print $2 }')"
  if [ "$status" != "200" ]; then
    echo "deploy.sh: could not check the function region (HTTP ${status:-000})" >&2
    return 0
  fi
  id="$(printf '%s\n' "$headers" | awk 'tolower($1) == "x-vercel-id:" { print $2; exit }')"
  ran="$(printf '%s' "$id" | awk -F'::' '{ print $2 }')"
  # A cached answer never reached a function, so its second field is no region.
  if ! [[ $ran =~ ^[a-z]+[0-9]+$ ]]; then
    echo "deploy.sh: could not check the function region (x-vercel-id: ${id:-missing})" >&2
    return 0
  fi
  if [ "$ran" = "$expected" ]; then
    log "function region $ran (site.json's region)"
  else
    echo "deploy.sh: WARNING: the API function ran in $ran, expected $expected (site.json's region) -- see site/docs/deploy.md, \"Function region\"" >&2
  fi
}

# Skips a heavy check under --quick, saying so.
heavy() {
  local n="$1" description="$2"
  if [ "$QUICK" -eq 1 ]; then
    log "step $n: skipped (--quick): $description"
    return 0
  fi
  step "$@"
}

log "starting (target: $TARGET)"

step 0 "check that .vercel/project.json exists (run 'vercel link' first if it doesn't)" -- require_vercel_link
if [ "$PROD" -eq 0 ]; then
  log "reminder: a brand-new Vercel project's FIRST deployment is always production, even without --prod (https://vercel.com/docs/deployments/environments#first-deployment). If this is the very first deploy of this project, stop and run 'site/scripts/deploy.sh --prod' instead -- see site/docs/deploy.md, section 2."
  step 0 "vercel list -- check, failing closed, that this project already has a deployment (an https://...vercel.app address); otherwise stop here and say to use --prod" -- first_deploy_check
fi

TREE_AT_START=""
if [ "$DRY_RUN" -eq 0 ]; then TREE_AT_START="$(tree_fingerprint)"; fi

if [ "$QUICK" -eq 1 ] && [ -d "$REPO_ROOT/node_modules" ]; then
  log "step 1: skipped (--quick, node_modules present): npm ci"
else
  step 1 "npm ci" -- npm ci
fi
step 2 "npm run build" -- npm run build
heavy 3 "npm run check" -- npm run check
heavy 4 "npm test" -- npm test
step 5 "node --test site/test/ (name-leak guard)" -- node --test site/test/
heavy 6 "npm run e2e:site" -- npm run e2e:site
step 7 "check the repo's tracked files are unchanged since the start, before building" -- tree_unchanged
step 8 "vercel pull --yes --environment=$TARGET" -- vercel pull --yes --environment="$TARGET"
step 9 "vercel build$PROD_FLAG_TEXT" -- vercel build ${PROD_ARGS[@]+"${PROD_ARGS[@]}"}
if [ "$PROD" -eq 1 ]; then
  step 10 "ask for confirmation ('yes'), since this migrates and deploys PRODUCTION" -- confirm_production
fi
step 11 "DATABASE_URL=<redacted> npm run doctor" -- with_db npm run doctor
step 12 "DATABASE_URL=<redacted> APP_DB_ROLE=app npm run migrate (fails with \"role app does not exist\" unless site/scripts/create-app-role.sh already ran for this branch)" -- with_db env APP_DB_ROLE=app npm run migrate
# Fix round 1, C1: the least-privilege check, run after every migrate.
step 13 "DATABASE_URL=<redacted> site/scripts/check-app-role.sh$PROD_FLAG_TEXT" -- with_db "$REPO_ROOT/site/scripts/check-app-role.sh" ${PROD_ARGS[@]+"${PROD_ARGS[@]}"}
step 14 "vercel deploy --prebuilt$PROD_FLAG_TEXT, then print the deployment URL" -- deploy_prebuilt
step 15 "curl -sI <deployment URL>/api/home, and compare the region in its x-vercel-id with site.json's" -- post_deploy_region "${DEPLOY_URL:-}"
