# Ambition — Autonomous Agent Swarm

This repository bootstraps a small autonomous swarm that coordinates through Render Redis and isolated Git worktrees. It currently ships with two worktrees and two prompt files:

- `worktree-backend` on branch `agent/backend`
- `worktree-frontend` on branch `agent/frontend`

The same Redis blackboard protocol also works for suffixed agent IDs such as `backend-1` or `frontend-2`; just keep the key names consistent inside the prompt you launch.

## Architecture

The workflow combines four pieces:

- **Junie CLI (headless)** — runs each agent without interactive input
- **Render Redis (`SWARM_REDIS_URL`)** — shared blackboard for coordination, status, and hand-offs
- **Git worktrees** — separate branches/directories so agents do not overwrite each other
- **Prompt files** — define each agent's identity, responsibilities, and Redis protocol

## Repository Layout

| Path | Purpose |
|---|---|
| `README.md` | Setup, launch, and Redis coordination guide |
| `setup-worktrees.sh` | Creates the frontend/backend worktrees and branches |
| `launch-swarm.sh` | Starts the backend agent first, then the frontend agent |
| `prompts/agent-backend.md` | Backend agent system prompt |
| `prompts/agent-frontend.md` | Frontend agent system prompt |

## Prerequisites

Before launching the swarm, make sure you have:

- Git with `worktree` support
- Junie CLI installed and authenticated
- A Render Redis / Key Value instance
- `redis-cli` available locally if you want to inspect keys manually
- `SWARM_REDIS_URL` exported in your shell (or loaded from a local `.env` file)

Example:

```bash
export SWARM_REDIS_URL="rediss://default:<password>@<host>:6379"
```

If you keep the value in `.env`, load it before launching:

```bash
set -a
source ./.env
set +a
```

## Setup Workflow

### 1. Create the agent worktrees

```bash
./setup-worktrees.sh
```

What the script does:

- Ensures the repository has at least one commit (required by `git worktree`)
- Creates branch `agent/frontend` and directory `worktree-frontend`
- Creates branch `agent/backend` and directory `worktree-backend`
- Skips worktrees that already exist, so it is safe to re-run

### 2. Review or adjust the prompts

The shipped prompts use Redis agent IDs `frontend` and `backend`.

If your orchestration layer uses IDs like `frontend-1` or `backend-1`, update the prompt files before launch so these values stay aligned everywhere:

- `agent:<id>:status`
- `agent:<id>:task`
- `agent:<id>:last_poll`
- `blocked:<id>`

### 3. Launch the swarm

```bash
./launch-swarm.sh
```

`launch-swarm.sh` performs the following checks and actions:

1. Confirms both worktrees exist
2. Confirms `SWARM_REDIS_URL` is set
3. Starts the backend agent first so it can publish `schema:backend` early
4. Starts the frontend agent second
5. Waits for both processes to finish

## Manual Launch

Use manual launch when you want to run only one agent, test a modified prompt, or attach different tooling around the swarm.

```bash
# Backend agent
cd worktree-backend
junie --headless --system-prompt ../prompts/agent-backend.md .

# Frontend agent
cd ../worktree-frontend
junie --headless --system-prompt ../prompts/agent-frontend.md .
```

## Redis Blackboard Protocol

The swarm communicates through Redis keys with a shared naming scheme.

| Key Pattern | Type | Description |
|---|---|---|
| `agent:<id>:status` | string | Agent lifecycle state: `running`, `blocked`, `done`, `error` |
| `agent:<id>:task` | string | Human-readable description of the current task |
| `agent:<id>:last_poll` | string | ISO-8601 timestamp of the last blocked poll |
| `schema:backend` | string (JSON) | Backend schema or contract published for dependent agents |
| `schema:frontend` | string (JSON) | Frontend schema, contract, or UI metadata |
| `blocked:<id>` | string | Redis key that the blocked agent is waiting for |
| `project:status` | string | Optional overall project status maintained by the orchestrator |
| `messages:<from>:<to>` | list | Optional message queue between agents |

### Standard status lifecycle

1. Agent starts and sets `agent:<id>:status` to `running`
2. Agent updates `agent:<id>:task` as work progresses
3. If blocked, agent sets `agent:<id>:status` to `blocked` and writes `blocked:<id>`
4. While blocked, the agent polls no faster than every 60 seconds
5. When unblocked, the agent returns to `running`
6. On completion, the agent sets only its own `agent:<id>:status` to `done`

### Polling loop

When an agent needs data from another agent:

```text
SET agent:<id>:status blocked
SET blocked:<id> "<required-key>"
SET agent:<id>:last_poll <iso-timestamp>

sleep 60
GET <required-key>

# repeat until data exists

SET agent:<id>:status running
DEL blocked:<id>
```

Do not poll faster than once per 60 seconds, and do not terminate the agent while it is waiting.

## Monitoring and Debugging

Check agent status and tasks:

```bash
redis-cli -u "$SWARM_REDIS_URL" MGET \
  agent:backend:status agent:backend:task \
  agent:frontend:status agent:frontend:task
```

Inspect published schemas:

```bash
redis-cli -u "$SWARM_REDIS_URL" GET schema:backend
redis-cli -u "$SWARM_REDIS_URL" GET schema:frontend
```

Watch blocked agents:

```bash
redis-cli -u "$SWARM_REDIS_URL" KEYS 'blocked:*'
```

## Troubleshooting

- **`SWARM_REDIS_URL` is missing** — export it first or load `.env` into your shell before running `launch-swarm.sh`
- **Worktrees are missing** — run `./setup-worktrees.sh` again; it is idempotent for existing worktrees
- **Agent IDs do not match Redis keys** — make sure the prompt file, monitoring commands, and any manual Redis commands all use the same `<id>`
- **One agent finishes early** — that agent should only mark its own Redis status as `done`; do not mark the whole project complete unless your orchestrator owns that decision
