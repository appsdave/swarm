#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="${SWARM_PROJECT_ROOT:-$(pwd)}"
SWARM_HOME="${SWARM_HOME:-${HOME}/.swarm}"
ENV_FILE="${SWARM_HOME}/env"
cd "$REPO_ROOT"

persist_redis_url() {
  local redis_url="$1"

  mkdir -p "$SWARM_HOME"
  touch "$ENV_FILE"

  if grep -Eq '^export SWARM_REDIS_URL=' "$ENV_FILE"; then
    python3 - "$ENV_FILE" "$redis_url" <<'PY'
from pathlib import Path
import shlex
import re
import sys

path = Path(sys.argv[1])
value = sys.argv[2]
replacement = f"export SWARM_REDIS_URL={shlex.quote(value)}"
content = path.read_text()
updated = re.sub(r'^export SWARM_REDIS_URL=.*$', replacement, content, count=1, flags=re.MULTILINE)
path.write_text(updated)
PY
  else
    printf '\nexport SWARM_REDIS_URL=%q\n' "$redis_url" >>"$ENV_FILE"
  fi

  export SWARM_REDIS_URL="$redis_url"
}

REDIS_URL_TO_SAVE=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --redis-url)
      if [ "$#" -lt 2 ]; then
        echo "❌ Missing value for --redis-url"
        exit 1
      fi
      REDIS_URL_TO_SAVE="$2"
      shift 2
      ;;
    --redis-url=*)
      REDIS_URL_TO_SAVE="${1#*=}"
      shift
      ;;
    *)
      echo "❌ Unknown argument: $1"
      echo "Usage: swarm setup [--redis-url <rediss://...>]"
      exit 1
      ;;
  esac
done

if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  . "$ENV_FILE"
fi

if [ -n "$REDIS_URL_TO_SAVE" ]; then
  persist_redis_url "$REDIS_URL_TO_SAVE"
fi

if ! git rev-parse --show-toplevel >/dev/null 2>&1; then
  echo "❌ '$REPO_ROOT' is not a Git repository. Run 'swarm setup' from a Git project root."
  exit 1
fi

# Ensure we have at least one commit (worktrees require it)
if ! git rev-parse HEAD &>/dev/null; then
  echo "No commits yet — creating initial commit..."
  git add -A
  git commit -m "initial commit" --allow-empty
fi

# Prune stale worktree registrations (handles "missing but already registered" errors)
git worktree prune 2>/dev/null || true

BASE_REF="$(git rev-parse --verify HEAD)"

branch_ref_usable() {
  local branch_name="$1"
  local prefix=""
  local part

  IFS='/' read -r -a parts <<<"$branch_name"
  if [ "${#parts[@]}" -le 1 ]; then
    return 0
  fi

  for part in "${parts[@]:0:${#parts[@]}-1}"; do
    if [ -n "$prefix" ]; then
      prefix="$prefix/$part"
    else
      prefix="$part"
    fi

    if git show-ref --verify --quiet "refs/heads/$prefix"; then
      return 1
    fi
  done

  return 0
}

pick_branch_name() {
  local role="$1"
  local candidate

  for candidate in "agent/$role" "swarm/$role" "swarm-$role"; do
    if git show-ref --verify --quiet "refs/heads/$candidate"; then
      printf '%s\n' "$candidate"
      return
    fi

    if branch_ref_usable "$candidate"; then
      printf '%s\n' "$candidate"
      return
    fi
  done

  printf 'swarm-%s\n' "$role"
}

ensure_branch() {
  local branch_name="$1"

  if git show-ref --verify --quiet "refs/heads/$branch_name"; then
    return
  fi

  git branch "$branch_name" "$BASE_REF"
}

# --- Create worktree for frontend agent ---
BRANCH_FE="$(pick_branch_name frontend)"
WORKTREE_FE="$REPO_ROOT/worktree-frontend"

if [ ! -d "$WORKTREE_FE" ]; then
  echo "Creating branch $BRANCH_FE and worktree at $WORKTREE_FE..."
  ensure_branch "$BRANCH_FE"
  git worktree add "$WORKTREE_FE" "$BRANCH_FE"
else
  echo "Worktree $WORKTREE_FE already exists, skipping."
fi

# --- Create worktree for backend agent ---
BRANCH_BE="$(pick_branch_name backend)"
WORKTREE_BE="$REPO_ROOT/worktree-backend"

if [ ! -d "$WORKTREE_BE" ]; then
  echo "Creating branch $BRANCH_BE and worktree at $WORKTREE_BE..."
  ensure_branch "$BRANCH_BE"
  git worktree add "$WORKTREE_BE" "$BRANCH_BE"
else
  echo "Worktree $WORKTREE_BE already exists, skipping."
fi

echo ""
echo "✅ Worktrees ready:"
echo "   Frontend → $WORKTREE_FE  (branch: $BRANCH_FE)"
echo "   Backend  → $WORKTREE_BE  (branch: $BRANCH_BE)"

if [ -n "${SWARM_REDIS_URL:-}" ]; then
  echo "   Redis    → configured via $ENV_FILE"
else
  echo ""
  echo "Next: save Redis once so future swarm commands auto-load it:"
  echo '   swarm setup --redis-url "rediss://<your External Key Value URL>"'
fi
