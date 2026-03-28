#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"

# Verify worktrees exist
if [ ! -d "$REPO_ROOT/worktree-frontend" ] || [ ! -d "$REPO_ROOT/worktree-backend" ]; then
  echo "❌ Worktrees not found. Run ./setup-worktrees.sh first."
  exit 1
fi

# Verify Redis URL is set
if [ -z "${SWARM_REDIS_URL:-}" ]; then
  echo "⚠️  SWARM_REDIS_URL is not set. Agents won't be able to communicate."
  echo "   Export it first: export SWARM_REDIS_URL=\"<your-render-redis-url>\""
  exit 1
fi

echo "🚀 Launching Agent Swarm..."
echo "   Redis: $SWARM_REDIS_URL"
echo ""

# Launch Agent B (Backend) — starts first so schema is published early
echo "🔧 Starting Agent B (Backend)..."
cd "$REPO_ROOT/worktree-backend"
junie --headless --system-prompt "$REPO_ROOT/prompts/agent-backend.md" . &
PID_BACKEND=$!
echo "   PID: $PID_BACKEND"

# Launch Agent A (Frontend)
echo "🎨 Starting Agent A (Frontend)..."
cd "$REPO_ROOT/worktree-frontend"
junie --headless --system-prompt "$REPO_ROOT/prompts/agent-frontend.md" . &
PID_FRONTEND=$!
echo "   PID: $PID_FRONTEND"

echo ""
echo "✅ Swarm launched!"
echo "   Agent A (Frontend) PID: $PID_FRONTEND"
echo "   Agent B (Backend)  PID: $PID_BACKEND"
echo ""
echo "Monitor with: redis-cli -u \$SWARM_REDIS_URL MGET agent:frontend:status agent:backend:status"
echo "Stop with:    kill $PID_FRONTEND $PID_BACKEND"

# Wait for both agents
wait $PID_BACKEND $PID_FRONTEND
echo "🏁 All agents finished."
