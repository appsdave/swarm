#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="${SWARM_PROJECT_ROOT:-$(pwd)}"
cd "$REPO_ROOT"

# Ensure we have at least one commit (worktrees require it)
if ! git rev-parse HEAD &>/dev/null; then
  echo "No commits yet — creating initial commit..."
  git add -A
  git commit -m "initial commit" --allow-empty
fi

DEFAULT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"

# --- Create worktree for frontend agent ---
BRANCH_FE="agent/frontend"
WORKTREE_FE="$REPO_ROOT/worktree-frontend"

if [ ! -d "$WORKTREE_FE" ]; then
  echo "Creating branch $BRANCH_FE and worktree at $WORKTREE_FE..."
  git branch "$BRANCH_FE" "$DEFAULT_BRANCH" 2>/dev/null || true
  git worktree add "$WORKTREE_FE" "$BRANCH_FE"
else
  echo "Worktree $WORKTREE_FE already exists, skipping."
fi

# --- Create worktree for backend agent ---
BRANCH_BE="agent/backend"
WORKTREE_BE="$REPO_ROOT/worktree-backend"

if [ ! -d "$WORKTREE_BE" ]; then
  echo "Creating branch $BRANCH_BE and worktree at $WORKTREE_BE..."
  git branch "$BRANCH_BE" "$DEFAULT_BRANCH" 2>/dev/null || true
  git worktree add "$WORKTREE_BE" "$BRANCH_BE"
else
  echo "Worktree $WORKTREE_BE already exists, skipping."
fi

echo ""
echo "✅ Worktrees ready:"
echo "   Frontend → $WORKTREE_FE  (branch: $BRANCH_FE)"
echo "   Backend  → $WORKTREE_BE  (branch: $BRANCH_BE)"
