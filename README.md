# Ambition — Autonomous Agent Swarm

## Architecture

This project implements a self-polling, multi-agent swarm using:

- **Junie CLI** — Concurrent agents running with a non-interactive `--task` prompt
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
| `request:<agent>:needs` | string | What the agent currently needs from others (free text or JSON) |
| `request:<agent>:offers` | string | What the agent can provide or has published |
| `push:<label>` | string | Post-completion push status set by `post-agent-commit.sh`: `pushing`, `done`, or `failed` (expires after 600 s) |
| `project:status` | string | Overall project state: `in_progress`, `integrating`, `done` |
| `msg:<id>` | list | Agent inbox (direct messages as `sender\|text`) |
| `swarm:broadcast-log` | list | Persistent broadcast message log (capped at 200) |

## Pub/Sub Channels

The backend bridges Redis pub/sub to SSE so frontends and monitors receive
real-time updates without polling.

| Channel | Purpose |
|---|---|
| `swarm:agent-events` | Structured agent lifecycle events (status changes, schema publications, messages) |
| `swarm:broadcast` | Broadcast messages sent to all agents |

## Backend API Reference

The backend runs on **port 3001** by default (`PORT` env var) and exposes a
REST+SSE API that wraps the Redis blackboard protocol.

### Health

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | Returns `{ status: "ok", timestamp }` |

### Agents

| Method | Path | Body / Query | Description |
|---|---|---|---|
| `GET` | `/api/agents` | — | List all known agents with full snapshot |
| `GET` | `/api/agents/:id` | — | Single agent snapshot (status, task, schema, needs, offers, …) |
| `PUT` | `/api/agents/:id/status` | `{ status, task? }` | Update agent status and optional task description |
| `POST` | `/api/agents/:id/block` | `{ waitingFor }` | Mark agent as blocked on a specific key |
| `POST` | `/api/agents/:id/unblock` | — | Mark agent as running again |

### Messages

| Method | Path | Body / Query | Description |
|---|---|---|---|
| `POST` | `/api/messages` | `{ from, to, text }` | Send a direct message to another agent's inbox |
| `GET` | `/api/messages/:agentId` | — | Read an agent's inbox |
| `DELETE` | `/api/messages/:agentId` | — | Clear an agent's inbox |
| `POST` | `/api/messages/broadcast` | `{ from, text }` | Broadcast a message to all agents |
| `GET` | `/api/messages/broadcast/log` | `?limit=50` (max 200) | Retrieve broadcast message history |

### Schemas

| Method | Path | Body / Query | Description |
|---|---|---|---|
| `GET` | `/api/schemas/:agentId` | — | Retrieve a published schema |
| `PUT` | `/api/schemas/:agentId` | `{ schema }` | Publish or update a schema (JSON object or string) |

### Negotiation

| Method | Path | Body / Query | Description |
|---|---|---|---|
| `GET` | `/api/negotiation` | — | Full needs/offers state for all known agents |
| `PUT` | `/api/negotiation/:agentId/needs` | `{ needs }` | Update what an agent needs from others |
| `PUT` | `/api/negotiation/:agentId/offers` | `{ offers }` | Update what an agent can provide |

### Events (SSE)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/events` | Server-Sent Events stream of real-time swarm events |

SSE event types: `connected`, `agent-event`, `broadcast`, `raw`.

## Polling & Negotiation Protocol

1. Agent checks its own `agent:<id>:status` key on startup, sets to `running`.
2. Agent publishes `request:<id>:offers` (what it can provide) and `request:<id>:needs` (what it needs from others).
3. Agent checks `request:<other>:needs` — if it can fulfill a request, it prioritizes publishing that data immediately.
4. When blocked, agent sets `agent:<id>:status` → `blocked` and `blocked:<id>` → the key it needs.
5. Agent enters polling loop: `sleep 60` → check Redis for the needed key → also check `request:<other>:needs` and fulfill if possible → repeat.
6. When the needed data appears, agent sets status back to `running`, cleans up `blocked:<id>` and `request:<id>:needs`.
7. On completion, agent sets `agent:<id>:status` → `done`.

## Setup Guide

### Step 1 — Redis Instance (Already Created)

Your `swarm-brain` instance is live:

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

### Step 2 — Install Prerequisites

- **Git** — already installed if you cloned this repo.
- **Junie CLI** — install and authenticate per JetBrains docs.
- **redis-cli** (optional, for debugging) — `sudo apt install redis-tools` or `brew install redis`.

### Step 3 — Create Git Worktrees

From the project root:

```bash
./setup-worktrees.sh
```

This creates two folders:
- `worktree-frontend/` → branch `agent/frontend`
- `worktree-backend/` → branch `agent/backend`

### Step 4 — Set the Redis Connection URL

Recommended once-per-machine command:

```bash
swarm setup --redis-url "<paste your External Key Value URL here>"
```

That saves the value into `~/.swarm/env`, and the `swarm` wrapper auto-loads it for future commands.

If you only want it for the current shell session, you can still use:

```bash
export SWARM_REDIS_URL="<paste your External Key Value URL here>"
```

The External URL will look like: `rediss://red-d73vnn9aae7s73b8e8b0:PASSWORD@ohio-valkey.render.com:6379`

To make it permanent manually:

```bash
echo 'export SWARM_REDIS_URL="<your-external-url>"' >> ~/.bashrc
source ~/.bashrc
```

### Step 5 — Verify the Connection (Optional)

```bash
redis-cli -u "$SWARM_REDIS_URL" PING
```

You should see `PONG`. If you get a TLS error, try:

```bash
redis-cli -u "$SWARM_REDIS_URL" --tls PING
```

### Step 6 — Install the Global Launcher (Recommended)

The new default install location is `~/.swarm`, so the toolchain is self-contained under your home directory.

If you want a one-liner install from GitHub, use:

```bash
curl -fsSL https://raw.githubusercontent.com/<owner>/<repo>/main/bootstrap-swarm.sh | bash -s -- https://github.com/<owner>/<repo>.git
```

That bootstrap command clones or updates the source into `~/.swarm/src/ambition`, installs the runtime into `~/.swarm`, makes sure `~/.swarm/bin` is added to `~/.bashrc` and `~/.zshrc`, and wires those shells to auto-load `~/.swarm/env`.

If you already cloned the repo manually, you can still install directly with:

```bash
./install-swarm.sh
source ~/.bashrc
```

If you do not want to reload your shell config, use:

```bash
export PATH="$HOME/.swarm/bin:$PATH"
```

This installs:

- `swarm` → the primary global command that opens the TUI
- `swarm-tui` → the compiled Rust TUI in `~/.swarm/bin`
- `swarm-task` → a compatibility alias to the same wrapper
- support scripts and prompt templates in `~/.swarm/share`
- persisted environment config in `~/.swarm/env`
- the source checkout under `~/.swarm/src/ambition` when you use the bootstrap installer

If you want the `PATH` change to persist manually:

```bash
echo 'export PATH="$HOME/.swarm/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

### Step 7 — Prepare Any Project You Want To Swarm

From the root of the project you want the agents to work on:

```bash
swarm setup
```

That creates `worktree-frontend/` and `worktree-backend/` inside the current project.

You can also save your Redis URL during setup so you do not need a separate export step:

```bash
swarm setup --redis-url "rediss://<your External Key Value URL>"
```

### Step 8 — Launch the Swarm

The easiest command is:

```bash
swarm
```

That opens the TUI for the current project. Type the task into the `Swarm Task Input` box and press `Enter`.

If you want to pass the task from the command line instead, use:

```bash
swarm run "Update the documentation, README, and setup instructions"
```

That uses the wrapper so the task text after `run` is passed to the TUI/Junie launcher.

If you prefer entering the task inside the UI instead of on the command line, just run:

```bash
swarm-tui
```

Then type the task into the `Swarm Task Input` box at the bottom of the screen and press `Enter`.

You can also start the shell-based launcher instead:

```bash
swarm shell
```

Or run the shell launcher directly:

```bash
swarm-task shell
```

The shell launcher starts both agents concurrently and writes logs to `.swarm-logs/agent-frontend.log` and `.swarm-logs/agent-backend.log` in the current project.

If you want to give the swarm a shared mission, pass it as a task prompt:

```bash
./tui/target/release/swarm-tui "Build the frontend and backend for the new dashboard flow"
```

Or set it via environment variable before launching the TUI:

```bash
export SWARM_TASK_PROMPT="Build the frontend and backend for the new dashboard flow"
./tui/target/release/swarm-tui
```

The role-specific instructions for each agent are generated automatically in `.swarm/runtime-prompts/` by the TUI, and the shell launcher uses either the current project's `prompts/` directory or the installed templates in `~/.swarm/share/prompts/`.

### Manual Launch (Alternative)

```bash
# Agent A — Frontend
cd worktree-frontend
junie --task "$(<../prompts/agent-frontend.md)" --project .

# Agent B — Backend
cd worktree-backend
junie --task "$(<../prompts/agent-backend.md)" --project .
```

### Where do I enter prompts?

- **Interactive in the TUI**: start `swarm` or `swarm-tui`, type your task directly in the `Swarm Task Input` box, then press `Enter`.
- **Swarm-wide task via CLI**: pass it as positional CLI text, for example `swarm run "Build the dashboard"`, or set `SWARM_TASK_PROMPT`.
- **Per-agent role/system prompt**: edit `prompts/agent-frontend.md` and `prompts/agent-backend.md` in the current project for the shell launcher, or let the TUI generate per-agent prompt files in `.swarm/runtime-prompts/`.
- **Direct one-off Junie run**: use `junie --task "your prompt here" --project .` from the relevant worktree.

Each TUI launch is a one-off swarm run. When the agents finish, the logs stay visible, the tracked PIDs are released, and you can type a brand-new task into the same input box and press `Enter` again for the next swarm.

### How do I confirm the agents are actually communicating?

You now have `3` ways to confirm this:

1. **Inside the TUI logs**
   - The TUI now shows Redis-derived events such as:
     - task updates
     - `waiting on schema:backend`
     - `unblocked in Redis`
     - `Redis key schema:backend was published`
   - This makes it much easier to see that coordination is happening and that it is not just one agent printing output.

2. **From Redis directly**

   ```bash
   redis-cli -u "$SWARM_REDIS_URL" MGET agent:frontend:status agent:backend:status blocked:frontend blocked:backend
   redis-cli -u "$SWARM_REDIS_URL" MGET schema:backend schema:frontend
   ```

   If one agent is blocked and the other publishes a schema key, that is real swarm communication.

3. **From the shell launcher logs**
   - Check `.swarm-logs/agent-frontend.log`
   - Check `.swarm-logs/agent-backend.log`

### What happens when both agents are done?

- The TUI clears the previous swarm Redis keys before every new launch, watches fresh Redis status updates, and once every tracked agent reports `done`, it requests the Junie child processes to stop.
- The shell launcher also clears stale Redis keys first, then monitors Redis and kills lingering agent PIDs once both `agent:frontend:status` and `agent:backend:status` are `done`.
- This prevents finished Junie processes from sitting around and wasting RAM.

### Troubleshooting

| Problem | Fix |
|---|---|
| `SWARM_REDIS_URL is not set` | Run `swarm setup --redis-url "rediss://<your External Key Value URL>"`, or export it manually |
| `Could not connect to Redis` | Check the URL is the **External** one, not Internal |
| TLS errors | Render free-tier Redis uses `rediss://` (TLS). Make sure your client supports it |
| Worktree already exists | Delete with `git worktree remove worktree-frontend` then re-run setup |
