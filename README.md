# Ambition — Autonomous Agent Swarm

An orchestration framework that runs concurrent AI coding agents (powered by [Junie CLI](https://www.jetbrains.com/junie/)) and coordinates them through a shared Redis blackboard. A Rust-based TUI provides real-time visibility into agent status, logs, and inter-agent messaging.

## Architecture

```
┌──────────────┐      ┌──────────────┐
│  Agent A      │      │  Agent B      │
│  (Frontend)   │      │  (Backend)    │
│  worktree-    │      │  worktree-    │
│  frontend/    │      │  backend/     │
└──────┬───────┘      └──────┬───────┘
       │   publish / poll     │
       └───────┬──────────────┘
               ▼
       ┌───────────────┐
       │  Render Redis  │
       │  (swarm-brain) │
       └───────┬───────┘
               │ status, schemas, messages
               ▼
       ┌───────────────┐
       │   Swarm TUI    │
       │   (Ratatui)    │
       └───────────────┘
```

Key components:

- **Junie CLI** — Concurrent agents running with a non-interactive `--task` prompt
- **Render Redis (swarm-brain)** — Cloud-hosted Key-Value store acting as the shared blackboard
- **Swarm TUI** — Rust terminal UI built with [Ratatui](https://ratatui.rs/) for real-time monitoring
- **Git Worktrees** — Isolated branches/folders so agents never overwrite each other
- **Post-agent scripts** — Automatic commit, rebase, push, and PR creation when agents finish

## Project Structure

```
ambition/
├── README.md                  # This file
├── package.json               # npm scripts for building and launching
├── tui/                       # Rust TUI application (Ratatui + Tokio)
│   ├── Cargo.toml
│   ├── Cargo.lock
│   ├── runtime-prompts/       # Agent prompt templates injected at launch
│   │   ├── frontend-1.md
│   │   └── backend-1.md
│   └── src/main.rs
├── backend/                   # Node.js Express API server
│   ├── package.json
│   ├── README.md              # Backend-specific documentation
│   ├── src/
│   │   ├── app.js             # Express app setup
│   │   ├── server.js          # Server entry point
│   │   ├── routes/            # API route handlers
│   │   │   ├── agents.js      # Agent status endpoints
│   │   │   ├── events.js      # SSE event stream
│   │   │   ├── messages.js    # Inter-agent messaging
│   │   │   ├── negotiation.js # Request/offer negotiation
│   │   │   └── schemas.js     # Schema publishing/retrieval
│   │   └── services/
│   │       ├── redis.js       # Redis client wrapper
│   │       └── agentComm.js   # Agent communication helpers
│   └── tests/
│       └── api.test.js        # Integration tests (Node built-in test runner)
├── prompts/                   # Agent system-prompt templates
│   ├── agent-frontend.md
│   └── agent-backend.md
├── scripts/
│   └── post-agent-commit.sh   # Auto commit/rebase/push/PR after agent exits
├── setup-worktrees.sh         # Creates git worktrees for agents
├── install-swarm.sh           # Builds TUI and installs CLI globally
├── launch-swarm.sh            # Shell-based swarm launcher (no TUI)
└── bootstrap-swarm.sh         # One-liner remote install from GitHub
```

## Redis Key Conventions

| Key Pattern | Type | Description |
|---|---|---|
| `agent:<id>:status` | string | Agent lifecycle state: `running`, `blocked`, `done`, `error` |
| `agent:<id>:task` | string | Current task description |
| `agent:<id>:last_poll` | string | ISO-8601 timestamp of last poll |
| `schema:backend` | string (JSON) | Published backend DB schema |
| `schema:frontend` | string (JSON) | Published frontend component schema |
| `blocked:<agent>` | string | What the agent is waiting for, e.g. `schema:backend` |
| `request:<agent>:needs` | string | What the agent currently needs from others |
| `request:<agent>:offers` | string | What the agent can provide or has published |
| `msg:<agent>` | list | Direct message inbox for `<agent>` (FIFO via `LPUSH`/`LRANGE`) |
| `project:status` | string | Overall project state: `in_progress`, `integrating`, `done` |

### Direct Messaging

Agents send messages to each other via Redis list-based queues:

```bash
# Send a message to backend
LPUSH msg:backend "frontend-1|Your message here"

# Read your inbox
LRANGE msg:frontend-1 0 -1

# Clear your inbox after reading
DEL msg:frontend-1
```

Messages follow the format `<sender-id>|<message text>`. Each agent checks its inbox every poll cycle and responds before continuing work.

## Polling & Negotiation Protocol

1. Agent sets `agent:<id>:status` → `running` on startup.
2. Agent publishes `request:<id>:offers` (what it can provide) and `request:<id>:needs` (what it needs).
3. Agent checks `request:<other>:needs` — if it can fulfill a request, it publishes that data immediately.
4. When blocked, agent sets `agent:<id>:status` → `blocked` and `blocked:<id>` → the key it needs.
5. Agent enters polling loop: `sleep 60` → check Redis for the needed key → check inbox (`msg:<id>`) → fulfill any `request:<other>:needs` → repeat.
6. When the needed data appears, agent sets status back to `running` and cleans up `blocked:<id>`.
7. On completion, agent sets `agent:<id>:status` → `done`.

## Setup Guide

### Prerequisites

- **Git** (with worktree support, i.e. Git ≥ 2.5)
- **Rust toolchain** (`rustup` + `cargo`) — to build the TUI
- **Junie CLI** — install and authenticate per JetBrains docs
- **Node.js** (≥ 20) — for the backend API server
- **redis-cli** (optional, for debugging) — `sudo apt install redis-tools` or `brew install redis`

### Step 1 — Redis Instance

Your `swarm-brain` instance is live on Render:

| Field | Value |
|---|---|
| **Service ID** | `red-d73vnn9aae7s73b8e8b0` |
| **Region** | Ohio |
| **Plan** | Standard (1 GB RAM, 1000 connections) |
| **Runtime** | Valkey 8.1.4 |
| **Internal URL** | `redis://red-d73vnn9aae7s73b8e8b0:6379` |

#### Enable External Access

By default, external traffic is blocked. To connect from your local machine:

1. Go to [swarm-brain dashboard](https://dashboard.render.com) → **swarm-brain** → **Info** page.
2. Scroll to **Networking → Inbound IP Restrictions**.
3. Add `0.0.0.0/0` (allow all) for development, or your specific IP.
4. Click **Save**.
5. The **External Key Value URL** will now appear in the **Connections** section — copy it.

> **Security**: For production, restrict to your IP only. Find it with `curl ifconfig.me`.

### Step 2 — Create Git Worktrees

From the project root:

```bash
./setup-worktrees.sh
```

This creates two folders:
- `worktree-frontend/` → branch `agent/frontend`
- `worktree-backend/` → branch `agent/backend`

### Step 3 — Set the Redis Connection URL

Recommended once-per-machine command:

```bash
swarm setup --redis-url "<paste your External Key Value URL here>"
```

This saves the value into `~/.swarm/env`, and the `swarm` wrapper auto-loads it for future commands.

For the current shell session only:

```bash
export SWARM_REDIS_URL="<paste your External Key Value URL here>"
```

The External URL will look like: `rediss://red-d73vnn9aae7s73b8e8b0:PASSWORD@ohio-valkey.render.com:6379`

To make it permanent manually:

```bash
echo 'export SWARM_REDIS_URL="<your-external-url>"' >> ~/.bashrc
source ~/.bashrc
```

### Step 4 — Verify the Connection (Optional)

```bash
redis-cli -u "$SWARM_REDIS_URL" PING
```

You should see `PONG`. If you get a TLS error, try:

```bash
redis-cli -u "$SWARM_REDIS_URL" --tls PING
```

### Step 5 — Install the Global Launcher

The toolchain installs to `~/.swarm` so it is self-contained under your home directory.

**One-liner install from GitHub:**

```bash
curl -fsSL https://raw.githubusercontent.com/<owner>/<repo>/main/bootstrap-swarm.sh | bash -s -- https://github.com/<owner>/<repo>.git
```

This clones or updates the source into `~/.swarm/src/ambition`, builds the Rust TUI, installs binaries to `~/.swarm/bin`, and wires `~/.bashrc`/`~/.zshrc` to auto-load `~/.swarm/env`.

**From a local clone:**

```bash
./install-swarm.sh
source ~/.bashrc
```

Or without reloading the shell:

```bash
export PATH="$HOME/.swarm/bin:$PATH"
```

**What gets installed:**

| Path | Description |
|---|---|
| `~/.swarm/bin/swarm` | Primary CLI wrapper (see [CLI Reference](#cli-reference)) |
| `~/.swarm/bin/swarm-tui` | Compiled Rust TUI binary |
| `~/.swarm/bin/swarm-task` | Compatibility alias for `swarm` |
| `~/.swarm/share/` | Prompt templates, scripts, worktree setup |
| `~/.swarm/env` | Persisted environment config (`SWARM_REDIS_URL`, etc.) |
| `~/.swarm/src/ambition/` | Source checkout (when using the bootstrap installer) |
| `~/.swarm/src_root` | Path to source repo for `swarm update` |

### Step 6 — Prepare Any Project

From the root of the project you want the agents to work on:

```bash
swarm setup
```

This creates `worktree-frontend/` and `worktree-backend/` inside the current project.

You can combine setup with the Redis URL:

```bash
swarm setup --redis-url "rediss://<your External Key Value URL>"
```

### Step 7 — Launch the Swarm

The easiest command is:

```bash
swarm
```

This opens the TUI for the current project. Type the task into the `Swarm Task Input` box and press `Enter`.

To pass the task from the command line:

```bash
swarm run "Update the documentation, README, and setup instructions"
```

See the full [CLI Reference](#cli-reference) below for all launch options.

## CLI Reference

```
Usage: swarm [command] [options]

Commands:
  tui            Launch the interactive TUI (default)
  run <task>     Launch the TUI with a task prompt
  shell          Launch the shell-based swarm runner
  setup          Set up Git worktrees for the current project
  update, -u     Pull latest source and re-install
  help, --help   Show this help message

Examples:
  swarm                                       # start the TUI
  swarm run "Build a todo app"                # start with a task
  swarm setup                                 # create worktrees
  swarm setup --redis-url "rediss://..."      # setup with Redis URL
  swarm update                                # self-update from source
```

### TUI vs Shell Launcher

| Feature | `swarm` / `swarm run` (TUI) | `swarm shell` |
|---|---|---|
| UI | Interactive Ratatui terminal UI | Plain shell output |
| Log viewing | Real-time split panes per agent | Tail log files manually |
| Redis events | Shown inline (blocked, unblocked, schema published) | Check Redis manually |
| Task input | Type in the input box or pass via CLI | Uses prompt templates |
| Agent cleanup | Automatic when both agents report `done` | Automatic via background monitor |
| Log location | Displayed in TUI | `.swarm-logs/agent-frontend.log`, `.swarm-logs/agent-backend.log` |

### Manual Launch (Alternative)

```bash
# Agent A — Frontend
cd worktree-frontend
junie --task "$(<../prompts/agent-frontend.md)" --project .

# Agent B — Backend
cd worktree-backend
junie --task "$(<../prompts/agent-backend.md)" --project .
```

### Environment Variables

| Variable | Description |
|---|---|
| `SWARM_REDIS_URL` | Redis connection URL (required) |
| `SWARM_TASK_PROMPT` | Task text passed to agents when launching via TUI |
| `SWARM_PROJECT_ROOT` | Override the project root directory |
| `SWARM_INSTALL_HOME` | Override the install directory (default: `~/.swarm/share`) |

## npm Scripts

The root `package.json` provides convenience scripts:

```bash
npm run build          # Build the Rust TUI (cargo build --release)
npm run start          # Launch the TUI (cargo run --release)
npm run dev            # Launch the TUI in dev mode (cargo run)
npm run launch         # Launch the shell-based swarm runner
```

## Post-Agent Commit Script

When an agent finishes, the launcher automatically runs `scripts/post-agent-commit.sh`, which:

1. Stages and commits any uncommitted changes in the agent's worktree
2. Rebases onto `main` and the other agent's branch to incorporate parallel work
3. Pushes the branch to the remote
4. Opens a pull request via `gh` (GitHub CLI)

The script uses Redis to coordinate push ordering so PRs from concurrent agents don't conflict.

## Backend API Server

The `backend/` directory contains a Node.js Express server that provides a REST API on top of the Redis blackboard. This is useful for web dashboards or external integrations.

### Routes

| Endpoint | Description |
|---|---|
| `/api/agents` | Agent status and lifecycle management |
| `/api/schemas` | Schema publishing and retrieval |
| `/api/messages` | Inter-agent messaging |
| `/api/negotiation` | Request/offer negotiation |
| `/api/events` | Server-sent events (SSE) stream for real-time updates |

### Running the Backend

```bash
cd backend
npm install
npm start
```

## Verifying Agent Communication

Three ways to confirm agents are coordinating:

### 1. Inside the TUI Logs

The TUI shows Redis-derived events inline:
- Task updates
- `waiting on schema:backend`
- `unblocked in Redis`
- `Redis key schema:backend was published`

### 2. From Redis Directly

```bash
redis-cli -u "$SWARM_REDIS_URL" MGET agent:frontend:status agent:backend:status blocked:frontend blocked:backend
redis-cli -u "$SWARM_REDIS_URL" MGET schema:backend schema:frontend
```

If one agent is blocked and the other publishes a schema key, that is real swarm communication.

### 3. From the Shell Launcher Logs

```bash
tail -f .swarm-logs/agent-frontend.log
tail -f .swarm-logs/agent-backend.log
```

## Swarm Lifecycle

1. **Launch** — The TUI (or shell launcher) clears stale Redis keys and starts both Junie agents in their respective worktrees.
2. **Running** — Each agent works independently, publishing schemas and checking the blackboard for data it needs.
3. **Blocked** — When an agent needs data from the other, it sets its status to `blocked` and enters a polling loop (every 60 seconds).
4. **Unblocked** — When the needed Redis key appears, the agent resumes work.
5. **Done** — Each agent sets its status to `done` when finished.
6. **Cleanup** — The launcher detects both agents are `done`, stops lingering Junie processes, and runs the post-agent commit script.

Each TUI session is a one-off swarm run. When agents finish, logs stay visible and you can type a new task into the input box for the next run.

## Troubleshooting

| Problem | Fix |
|---|---|
| `SWARM_REDIS_URL is not set` | Run `swarm setup --redis-url "rediss://..."`, or export it manually |
| `Could not connect to Redis` | Check the URL is the **External** one, not Internal |
| TLS errors | Render Redis uses `rediss://` (TLS). Make sure your URL starts with `rediss://` and your client supports TLS |
| Worktree already exists | Delete with `git worktree remove worktree-frontend` then re-run setup |
| `swarm` command not found | Run `export PATH="$HOME/.swarm/bin:$PATH"` or open a new shell |
| Agents not communicating | Verify both agents have the same `SWARM_REDIS_URL`; check keys with `redis-cli` |
| Build fails (TUI) | Ensure Rust toolchain is installed: `rustup update stable` |
| Post-commit PR fails | Ensure `gh` (GitHub CLI) is installed and authenticated: `gh auth status` |
