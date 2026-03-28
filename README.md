# Ambition — Autonomous Agent Swarm

## Architecture

This project runs a small autonomous swarm built from:

- **Junie CLI (headless)** for concurrent agent sessions
- **Render Redis (`swarm-brain`)** for the shared blackboard
- **Git worktrees** so each agent stays isolated in its own checkout
- **Prompt files** that define each agent's role, Redis protocol, and work rules

## Current Swarm Workflow

The current setup launches two agents from separate worktrees:

| Agent | Agent ID | Worktree | Branch | Prompt | Responsibility |
|---|---|---|---|---|---|
| Agent A1 — Frontend | `frontend-1` | `worktree-frontend/` | `agent/frontend` | `prompts/agent-frontend.md` | Frontend implementation and frontend-facing workflow updates |
| Agent B1 — Backend | `backend-1` | `worktree-backend/` | `agent/backend` | `prompts/agent-backend.md` | Backend implementation, API work, and schema publishing |

`setup-worktrees.sh` creates the worktrees and branches. `launch-swarm.sh` starts the backend first so it can publish `schema:backend` as early as possible.

## Redis Blackboard Keys

| Key Pattern | Type | Description |
|---|---|---|
| `agent:<id>:status` | string | Agent lifecycle state: `running`, `blocked`, `done`, `error` |
| `agent:<id>:task` | string | Current task description |
| `agent:<id>:last_poll` | string | ISO-8601 timestamp of the last blocked poll |
| `blocked:<id>` | string | Dependency currently blocking an agent, e.g. `schema:backend` |
| `schema:backend` | string (JSON) | Published backend schema or contract data |
| `schema:frontend` | string (JSON) | Published frontend component/schema data |
| `project:status` | string | Overall swarm state, e.g. `in_progress`, `integrating`, `done` |
| `messages:<from>:<to>` | list | Optional direct message queue between agents |

### Example agent lifecycle

Frontend startup:

```bash
redis-cli -u "$SWARM_REDIS_URL" SET agent:frontend-1:status running
redis-cli -u "$SWARM_REDIS_URL" SET agent:frontend-1:task "Building frontend application"
```

Frontend blocked on backend schema:

```bash
redis-cli -u "$SWARM_REDIS_URL" SET agent:frontend-1:status blocked
redis-cli -u "$SWARM_REDIS_URL" SET blocked:frontend-1 "schema:backend"
redis-cli -u "$SWARM_REDIS_URL" SET agent:frontend-1:last_poll "2026-03-28T16:44:00Z"
```

Frontend resumes after receiving data:

```bash
redis-cli -u "$SWARM_REDIS_URL" SET agent:frontend-1:status running
redis-cli -u "$SWARM_REDIS_URL" DEL blocked:frontend-1
```

Frontend completes:

```bash
redis-cli -u "$SWARM_REDIS_URL" SET agent:frontend-1:status done
redis-cli -u "$SWARM_REDIS_URL" SET agent:frontend-1:task "Frontend complete"
```

## Setup

### Prerequisites

- Git repository initialized with at least one commit
- Junie CLI installed and authenticated
- Render Redis instance available, with its connection string exported as `SWARM_REDIS_URL`
- `redis-cli` installed if you want to monitor the blackboard from the terminal

### Quick start

```bash
# 1. Export the shared Redis URL
export SWARM_REDIS_URL="<your-render-redis-url>"

# 2. Create the agent worktrees
./setup-worktrees.sh

# 3. Launch the swarm from the repo root
./launch-swarm.sh
```

### What the setup script creates

`./setup-worktrees.sh` prepares:

- `worktree-frontend/` on branch `agent/frontend`
- `worktree-backend/` on branch `agent/backend`

Each worktree is the project root for the agent running inside it.

### Manual launch

```bash
# Agent B1 — Backend
cd worktree-backend
junie --headless --system-prompt ../prompts/agent-backend.md .

# Agent A1 — Frontend
cd ../worktree-frontend
junie --headless --system-prompt ../prompts/agent-frontend.md .
```

## Monitoring and troubleshooting

Check current swarm state:

```bash
redis-cli -u "$SWARM_REDIS_URL" MGET \
  agent:frontend-1:status \
  agent:frontend-1:task \
  agent:backend-1:status \
  agent:backend-1:task \
  project:status
```

Inspect whether an agent is blocked:

```bash
redis-cli -u "$SWARM_REDIS_URL" MGET \
  blocked:frontend-1 \
  agent:frontend-1:last_poll \
  blocked:backend-1 \
  agent:backend-1:last_poll
```

If an agent is blocked, it should sleep for 60 seconds between polls and only resume once the dependency key contains data.
