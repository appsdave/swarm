# Ambition — Autonomous Agent Swarm

## Architecture

This project implements a self-polling, multi-agent swarm using:

- **Junie CLI (Headless)** — Concurrent agents running without manual input
- **Render Redis (swarm-brain)** — Cloud-hosted Key-Value store acting as the shared "Blackboard"
- **Render MCP & Terminal Tools** — Protocols for agents to read/write the blackboard
- **Git Worktrees** — Isolated branches/folders so agents never overwrite each other

## Redis Key Conventions

| Key Pattern | Type | Description |
|---|---|---|
| `agent:<id>:status` | string | Agent lifecycle state: `running`, `blocked`, `done`, `error` |
| `agent:<id>:task` | string | Current task description |
| `agent:<id>:last_poll` | string | ISO-8601 timestamp of last poll |
| `schema:backend` | string (JSON) | Published backend DB schema |
| `schema:frontend` | string (JSON) | Published frontend component schema |
| `blocked:<agent>` | string | What the agent is waiting for, e.g. `schema:backend` |
| `project:status` | string | Overall project state: `in_progress`, `integrating`, `done` |
| `messages:<from>:<to>` | list | Message queue between agents |

## Polling Protocol

1. Agent checks its own `agent:<id>:status` key on startup, sets to `running`.
2. When blocked, agent sets `agent:<id>:status` → `blocked` and `blocked:<id>` → the key it needs.
3. Agent enters polling loop: `sleep 60` → check Redis for the needed key → evaluate → repeat.
4. When the needed data appears, agent sets status back to `running` and resumes work.
5. On completion, agent sets `agent:<id>:status` → `done`.

## Agent Launch Instructions

### Prerequisites
- Junie CLI installed and authenticated
- Render Redis instance `swarm-brain` created (set connection URL in env)
- Git repository initialized

### Quick Start

```bash
# 1. Set your Redis connection URL
export SWARM_REDIS_URL="<your-render-redis-url>"

# 2. Create worktrees
./setup-worktrees.sh

# 3. Launch the swarm
./launch-swarm.sh
```

### Manual Launch

```bash
# Agent A — Frontend
cd worktree-frontend
junie --headless --system-prompt ../prompts/agent-frontend.md .

# Agent B — Backend
cd worktree-backend
junie --headless --system-prompt ../prompts/agent-backend.md .
```
