# shellcheck shell=bash
#
# site/scripts/lib.sh -- the preamble deploy.sh, create-app-role.sh and
# check-app-role.sh share. Source it right after `set -euo pipefail`:
#
#   . "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
#
# It runs nothing on its own except setting SCRIPT and REPO_ROOT. It gives:
#
#   SCRIPT            the calling script's file name, for messages
#   REPO_ROOT         the repo root (two levels above this file)
#   select_target "$@"
#                     parses --prod and --dry-run, and sets PROD and DRY_RUN
#                     (0/1), TARGET (production|preview) and DB_VAR_NAME
#                     (EMIBONNIE_DB|EMIBONNIE_DB_PREVIEW). Any other argument
#                     goes to the caller's own `extra_arg` function, if it
#                     defines one: it is called with the remaining arguments
#                     and sets EXTRA_ARGS_USED to how many it took (0: not
#                     its argument either). Anything left over stops the run
#                     with "unknown argument", naming $USAGE_FLAGS.
#   read_db_url       reads the variable *named by* $DB_VAR_NAME (indirect
#                     expansion -- never its literal text, never echoed)
#                     into the unexported shell variable DB_URL, stops if
#                     it's empty, then unsets EMIBONNIE_DB,
#                     EMIBONNIE_DB_PREVIEW, DATABASE_URL and $DB_VAR_NAME,
#                     so no later child process can inherit any of them.
#   with_db CMD...    runs CMD with DATABASE_URL=$DB_URL in its environment
#                     only (an env prefix, never argv).
#   step N DESCRIPTION -- CMD...
#                     prints "step N: running: DESCRIPTION" and runs CMD, or,
#                     under --dry-run, prints "step N: would run:
#                     DESCRIPTION" and runs nothing. Dry and real runs go
#                     through the same call, so they can't list different
#                     steps. DESCRIPTION is printed: it must never hold a
#                     secret (write DATABASE_URL=<redacted>).
#   vercel ARGS...    the Vercel CLI, pinned to VERCEL_CLI_VERSION -- the
#                     same pin as the engine's Actions-path example
#                     (docs/deploy-workflow.example.yml; fix round 1, M4).
#   log TEXT...       prints "[<script>:<target>] TEXT".
#
# No `set -x` anywhere: nothing here is echoed verbatim.

SCRIPT="${0##*/}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

VERCEL_CLI_VERSION="65.1.0"
vercel() {
  npx --yes "vercel@${VERCEL_CLI_VERSION}" "$@"
}

log() {
  echo "[${SCRIPT%.sh}:${TARGET:-}] $*"
}

select_target() {
  PROD=0
  DRY_RUN=0
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --prod) PROD=1; shift ;;
      --dry-run) DRY_RUN=1; shift ;;
      *)
        EXTRA_ARGS_USED=0
        if declare -F extra_arg >/dev/null; then extra_arg "$@"; fi
        if [ "$EXTRA_ARGS_USED" -eq 0 ]; then
          echo "$SCRIPT: unknown argument '$1' (expected ${USAGE_FLAGS:---prod and/or --dry-run})" >&2
          exit 1
        fi
        shift "$EXTRA_ARGS_USED"
        ;;
    esac
  done
  if [ "$PROD" -eq 1 ]; then
    TARGET="production"
    DB_VAR_NAME="EMIBONNIE_DB"
  else
    TARGET="preview"
    DB_VAR_NAME="EMIBONNIE_DB_PREVIEW"
  fi
}

read_db_url() {
  local value="${!DB_VAR_NAME:-}"
  if [ -z "$value" ]; then
    echo "$SCRIPT: \$$DB_VAR_NAME is not set (it must hold the owner-role connection string for the $TARGET database) -- stopping before any step runs" >&2
    exit 1
  fi
  unset EMIBONNIE_DB EMIBONNIE_DB_PREVIEW DATABASE_URL "$DB_VAR_NAME"
  # Unset first, so an exported DB_URL from the caller's shell can't make
  # this one exported too.
  unset DB_URL
  DB_URL="$value"
}

with_db() {
  DATABASE_URL="$DB_URL" "$@"
}

step() {
  local n="$1" description="$2"
  if [ "$#" -lt 4 ] || [ "$3" != "--" ]; then
    echo "$SCRIPT: step $n: expected: step N DESCRIPTION -- COMMAND..." >&2
    exit 2
  fi
  shift 3
  if [ "$DRY_RUN" -eq 1 ]; then
    log "step $n: would run: $description"
    return 0
  fi
  log "step $n: running: $description"
  "$@"
}
