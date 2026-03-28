#!/usr/bin/env bash
set -euo pipefail

SWARM_HOME="${SWARM_HOME:-${HOME}/.swarm}"
SWARM_SRC_DIR="${SWARM_SRC_DIR:-${SWARM_HOME}/src/ambition}"
DEFAULT_REPO_URL="${SWARM_REPO_URL:-}"

REPO_URL="${1:-$DEFAULT_REPO_URL}"

if [ -z "$REPO_URL" ]; then
  cat >&2 <<'EOF'
Usage:
  bash bootstrap-swarm.sh <git-repo-url>

Example one-liner:
  curl -fsSL <raw-bootstrap-url> | bash -s -- https://github.com/<owner>/ambition.git
EOF
  exit 1
fi

mkdir -p "$(dirname "$SWARM_SRC_DIR")"

if [ -d "$SWARM_SRC_DIR/.git" ]; then
  echo "📥 Updating existing swarm source checkout in $SWARM_SRC_DIR..."
  git -C "$SWARM_SRC_DIR" fetch --tags origin
  DEFAULT_REMOTE_BRANCH="$(git -C "$SWARM_SRC_DIR" remote show origin | awk '/HEAD branch/ {print $NF}')"
  DEFAULT_REMOTE_BRANCH="${DEFAULT_REMOTE_BRANCH:-main}"
  git -C "$SWARM_SRC_DIR" checkout "$DEFAULT_REMOTE_BRANCH"
  git -C "$SWARM_SRC_DIR" pull --ff-only origin "$DEFAULT_REMOTE_BRANCH"
else
  echo "📦 Cloning swarm source into $SWARM_SRC_DIR..."
  git clone "$REPO_URL" "$SWARM_SRC_DIR"
fi

echo "⚙️ Installing swarm into $SWARM_HOME..."
bash "$SWARM_SRC_DIR/install-swarm.sh"

echo ""
echo "✅ Bootstrap complete."
echo "Run this now if your current shell cannot find 'swarm' yet:"
echo 'export PATH="$HOME/.swarm/bin:$PATH"'