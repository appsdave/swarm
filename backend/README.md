# Ambition Backend

REST + SSE API service that wraps the Redis blackboard protocol for the
Ambition agent swarm. Built with Express and ioredis.

## Quick Start

```bash
# Prerequisites: Node.js >= 20, a running Redis/Valkey instance

# Install dependencies
cd backend
npm install

# Set the Redis connection URL (TLS URLs use rediss://)
export SWARM_REDIS_URL="rediss://red-XXXXX:PASSWORD@ohio-valkey.render.com:6379"

# Start the server (default port 3001)
npm start

# Or with file-watch for development
npm run dev
```

The server prints all available routes on startup.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `SWARM_REDIS_URL` | `redis://localhost:6379` | Redis/Valkey connection URL. Use `rediss://` for TLS. |
| `PORT` | `3001` | HTTP listen port |

## Project Structure

```
backend/
├── src/
│   ├── app.js              # Express app factory (routes, middleware)
│   ├── server.js           # Entry point — connects Redis, starts HTTP listener
│   ├── routes/
│   │   ├── agents.js       # /api/agents — agent lifecycle & status
│   │   ├── messages.js     # /api/messages — direct & broadcast messaging
│   │   ├── schemas.js      # /api/schemas — schema publishing & retrieval
│   │   ├── negotiation.js  # /api/negotiation — needs/offers coordination
│   │   └── events.js       # /api/events — SSE real-time event stream
│   └── services/
│       ├── redis.js        # Redis client management (cmd, pub, sub)
│       └── agentComm.js    # Business logic — agent state, messaging, pub/sub bridge
├── tests/
│   └── api.test.js         # Integration tests (Node.js built-in test runner)
├── package.json
└── .gitignore
```

## API Endpoints

### Health

```
GET /api/health  →  { status: "ok", timestamp: "..." }
```

### Agents

```
GET    /api/agents              — List all agents with full snapshots
GET    /api/agents/:id          — Single agent snapshot
PUT    /api/agents/:id/status   — Update status  { status, task? }
POST   /api/agents/:id/block    — Block agent    { waitingFor }
POST   /api/agents/:id/unblock  — Unblock agent
```

### Messages

```
POST   /api/messages               — Send direct message  { from, to, text }
GET    /api/messages/:agentId      — Read inbox
DELETE /api/messages/:agentId      — Clear inbox
POST   /api/messages/broadcast     — Broadcast message     { from, text }
GET    /api/messages/broadcast/log — Broadcast history      ?limit=50 (max 200)
```

### Schemas

```
GET    /api/schemas/:agentId    — Retrieve published schema
PUT    /api/schemas/:agentId    — Publish schema  { schema }
```

### Negotiation

```
GET    /api/negotiation                   — Full needs/offers state
PUT    /api/negotiation/:agentId/needs    — Set needs   { needs }
PUT    /api/negotiation/:agentId/offers   — Set offers  { offers }
```

### Events (SSE)

```
GET    /api/events   — Server-Sent Events stream
```

Event types pushed over the stream:

| Event | Trigger |
|---|---|
| `connected` | Client opens the SSE connection |
| `agent-event` | Any agent lifecycle change (status, schema, message, block/unblock) |
| `broadcast` | A broadcast message is sent |
| `raw` | Unparseable pub/sub message (fallback) |

## Redis Integration

The service maintains three ioredis connections:

| Client | Purpose |
|---|---|
| **cmd** | Regular key-value commands (GET, SET, MGET, LPUSH, …) |
| **sub** | Subscribed to `swarm:agent-events` and `swarm:broadcast` channels |
| **pub** | Publishes events to those same channels |

All write operations that change agent state also publish a structured event
via `swarm:agent-events`, so SSE listeners receive updates in real time.

## Testing

Tests use the Node.js built-in test runner and import the Express app directly
(no Redis connection required):

```bash
npm test
```

The test suite covers all route groups including validation of required fields
and error responses.

## Graceful Shutdown

The server listens for `SIGINT` and `SIGTERM`, closes the HTTP listener, and
disconnects all three Redis clients before exiting.
