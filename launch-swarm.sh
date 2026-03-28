#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="${SWARM_PROJECT_ROOT:-$(pwd)}"
INSTALL_HOME="${SWARM_INSTALL_HOME:-$(cd "$(dirname "$0")" && pwd)}"
PROMPT_ROOT="$PROJECT_ROOT/prompts"
if [ ! -d "$PROMPT_ROOT" ]; then
  PROMPT_ROOT="$INSTALL_HOME/prompts"
fi

SCRIPTS_DIR="$PROJECT_ROOT/scripts"
if [ ! -d "$SCRIPTS_DIR" ]; then
  SCRIPTS_DIR="$INSTALL_HOME/scripts"
fi
POST_COMMIT_SCRIPT="$SCRIPTS_DIR/post-agent-commit.sh"

LOG_DIR="$PROJECT_ROOT/.swarm-logs"
mkdir -p "$LOG_DIR"

PID_BACKEND=""
PID_FRONTEND=""
MONITOR_PID=""

cleanup() {
  for pid in "$PID_FRONTEND" "$PID_BACKEND" "$MONITOR_PID"; do
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
}

trap cleanup EXIT INT TERM

redis_get() {
  local key="$1"
  if [[ "$SWARM_REDIS_URL" == rediss://* ]]; then
    redis-cli -u "$SWARM_REDIS_URL" --tls GET "$key" 2>/dev/null || true
  else
    redis-cli -u "$SWARM_REDIS_URL" GET "$key" 2>/dev/null || true
  fi
}

redis_del() {
  if [[ "$SWARM_REDIS_URL" == rediss://* ]]; then
    redis-cli -u "$SWARM_REDIS_URL" --tls DEL "$@" >/dev/null 2>&1 || true
  else
    redis-cli -u "$SWARM_REDIS_URL" DEL "$@" >/dev/null 2>&1 || true
  fi
}

wait_for_swarm_done() {
  while true; do
    local backend_status frontend_status
    backend_status="$(redis_get agent:backend:status | tr -d '\r')"
    frontend_status="$(redis_get agent:frontend:status | tr -d '\r')"

    if [ "$backend_status" = "done" ] && [ "$frontend_status" = "done" ]; then
      echo "🧠 Redis confirms both agents are done. Stopping lingering Junie processes..."
      for pid in "$PID_FRONTEND" "$PID_BACKEND"; do
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
          kill "$pid" 2>/dev/null || true
        fi
      done
      return 0
    fi

    sleep 5
  done
}

# Verify worktrees exist
if [ ! -d "$PROJECT_ROOT/worktree-frontend" ] || [ ! -d "$PROJECT_ROOT/worktree-backend" ]; then
  echo "❌ Worktrees not found in $PROJECT_ROOT. Run 'swarm setup' first."
  exit 1
fi

if [ ! -f "$PROMPT_ROOT/agent-frontend.md" ] || [ ! -f "$PROMPT_ROOT/agent-backend.md" ]; then
  echo "❌ Agent prompt templates not found in $PROMPT_ROOT. Re-run ./install-swarm.sh."
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
echo "   Logs:  $LOG_DIR"
echo ""

echo "🧹 Clearing stale swarm Redis state..."
redis_del \
  agent:frontend:status \
  agent:frontend:task \
  agent:frontend:last_poll \
  blocked:frontend \
  agent:backend:status \
  agent:backend:task \
  agent:backend:last_poll \
  blocked:backend \
  schema:frontend \
  schema:backend \
  project:status

# Launch Agent B (Backend) — starts first so schema is published early
echo "🔧 Starting Agent B (Backend)..."
(
  cd "$PROJECT_ROOT/worktree-backend"
  junie --task "$(<"$PROMPT_ROOT/agent-backend.md")" --project . >>"$LOG_DIR/agent-backend.log" 2>&1
  echo "📦 Agent B exited — running post-completion commit/push/PR..."
  if [ -x "$POST_COMMIT_SCRIPT" ]; then
    bash "$POST_COMMIT_SCRIPT" "$PROJECT_ROOT/worktree-backend" "agent/backend" "backend" >>"$LOG_DIR/agent-backend.log" 2>&1
  fi
) &
PID_BACKEND=$!
echo "   PID: $PID_BACKEND"
echo "   Log: $LOG_DIR/agent-backend.log"

# Launch Agent A (Frontend)
echo "🎨 Starting Agent A (Frontend)..."
(
  cd "$PROJECT_ROOT/worktree-frontend"
  junie --task "$(<"$PROMPT_ROOT/agent-frontend.md")" --project . >>"$LOG_DIR/agent-frontend.log" 2>&1
  echo "📦 Agent A exited — running post-completion commit/push/PR..."
  if [ -x "$POST_COMMIT_SCRIPT" ]; then
    bash "$POST_COMMIT_SCRIPT" "$PROJECT_ROOT/worktree-frontend" "agent/frontend" "frontend" >>"$LOG_DIR/agent-frontend.log" 2>&1
  fi
) &
PID_FRONTEND=$!
echo "   PID: $PID_FRONTEND"
echo "   Log: $LOG_DIR/agent-frontend.log"

echo ""
echo "✅ Swarm launched!"
echo "   Agent A (Frontend) PID: $PID_FRONTEND"
echo "   Agent B (Backend)  PID: $PID_BACKEND"
echo ""
echo "Monitor with: redis-cli -u \$SWARM_REDIS_URL MGET agent:frontend:status agent:backend:status"
echo "Verify coordination with: redis-cli -u \$SWARM_REDIS_URL MGET blocked:frontend blocked:backend schema:backend schema:frontend"
echo "Stop with:    kill $PID_FRONTEND $PID_BACKEND"

wait_for_swarm_done &
MONITOR_PID=$!

# Wait for both agents
wait $PID_BACKEND $PID_FRONTEND || true
if [ -n "$MONITOR_PID" ] && kill -0 "$MONITOR_PID" 2>/dev/null; then
  kill "$MONITOR_PID" 2>/dev/null || true
fi
echo "🏁 All agents finished."
