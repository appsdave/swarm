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

All request/response bodies are JSON. Endpoints that create resources return
**201**; most others return **200**. Validation errors return **400** and
missing resources return **404**.

### Health

```
GET /api/health
```

Response `200`:

```json
{ "status": "ok", "timestamp": "2026-03-28T21:08:00.000Z" }
```

### Agents

```
GET    /api/agents              — List all agents with full snapshots
GET    /api/agents/:id          — Single agent snapshot
PUT    /api/agents/:id/status   — Update status  { status, task? }
POST   /api/agents/:id/block    — Block agent    { waitingFor }
POST   /api/agents/:id/unblock  — Unblock agent
```

**GET /api/agents** — `200`

```json
{
  "agents": [
    {
      "agentId": "backend-1",
      "status": "running",
      "task": "Building backend application",
      "lastPoll": "2026-03-28T21:08:00.000Z",
      "blocked": null,
      "schema": null,
      "needs": null,
      "offers": null
    }
  ]
}
```

**GET /api/agents/:id** — `200` or `404`

Same shape as a single element in the array above.

**PUT /api/agents/:id/status** — `200` or `400`

Request: `{ "status": "running", "task": "Doing work" }` (`task` is optional).

Response: `{ "agentId": "backend-1", "status": "running", "task": "Doing work" }`

**POST /api/agents/:id/block** — `200` or `400`

Request: `{ "waitingFor": "schema:frontend" }`

Response: `{ "agentId": "backend-1", "status": "blocked", "waitingFor": "schema:frontend" }`

**POST /api/agents/:id/unblock** — `200`

Response: `{ "agentId": "backend-1", "status": "running" }`

### Messages

```
POST   /api/messages               — Send direct message  { from, to, text }
GET    /api/messages/:agentId      — Read inbox
DELETE /api/messages/:agentId      — Clear inbox
POST   /api/messages/broadcast     — Broadcast message     { from, text }
GET    /api/messages/broadcast/log — Broadcast history      ?limit=50 (max 200)
```

**POST /api/messages** — `201` or `400`

Request: `{ "from": "backend-1", "to": "frontend", "text": "Schema ready" }`

Response: `{ "from": "backend-1", "to": "frontend", "text": "Schema ready", "timestamp": "..." }`

**GET /api/messages/:agentId** — `200`

```json
{
  "agentId": "frontend",
  "messages": [
    { "from": "backend-1", "text": "Schema ready" }
  ]
}
```

**DELETE /api/messages/:agentId** — `200`

Response: `{ "agentId": "frontend", "cleared": 1 }`

**POST /api/messages/broadcast** — `201` or `400`

Request: `{ "from": "backend-1", "text": "All schemas published" }`

Response: `{ "from": "backend-1", "text": "All schemas published", "timestamp": "..." }`

**GET /api/messages/broadcast/log** — `200`

```json
{ "messages": [{ "from": "backend-1", "text": "All schemas published", "timestamp": "..." }] }
```

### Schemas

```
GET    /api/schemas/:agentId    — Retrieve published schema
PUT    /api/schemas/:agentId    — Publish schema  { schema }
```

**PUT /api/schemas/:agentId** — `200` or `400`

Request: `{ "schema": { "tables": { "users": { "id": "int", "name": "text" } } } }`

Response: `{ "agentId": "backend", "schema": { ... } }`

**GET /api/schemas/:agentId** — `200` or `404`

Response: `{ "agentId": "backend", "schema": { ... } }`

### Negotiation

```
GET    /api/negotiation                   — Full needs/offers state
PUT    /api/negotiation/:agentId/needs    — Set needs   { needs }
PUT    /api/negotiation/:agentId/offers   — Set offers  { offers }
```

**GET /api/negotiation** — `200`

```json
{
  "negotiation": {
    "backend-1": { "needs": "schema:frontend", "offers": "API endpoints, DB schema" }
  }
}
```

**PUT /api/negotiation/:agentId/needs** — `200` or `400`

Request: `{ "needs": "schema:frontend" }`

Response: `{ "agentId": "backend-1", "needs": "schema:frontend" }`

**PUT /api/negotiation/:agentId/offers** — `200` or `400`

Request: `{ "offers": "API endpoints, DB schema" }`

Response: `{ "agentId": "backend-1", "offers": "API endpoints, DB schema" }`

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

`agent-event` payloads include an `agentId`, a `type` field (`status-change`,
`blocked`, `unblocked`, `schema-published`, `message-sent`, `needs-updated`,
`offers-updated`), a `payload` object, and a `timestamp`.

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

Tests use the Node.js built-in test runner (`node:test`) and require a live
Redis connection (the test suite calls `connectAll()` to exercise the full
stack including pub/sub):

```bash
# Make sure SWARM_REDIS_URL is set (or a local Redis is running on port 6379)
npm test
```

The test suite covers all route groups including validation of required fields,
error responses, and the full create → read → delete lifecycle for messages,
schemas, and negotiation state. Test keys are cleaned up automatically via
`beforeEach` / `after` hooks.

## Graceful Shutdown

The server listens for `SIGINT` and `SIGTERM`, closes the HTTP listener, and
disconnects all three Redis clients before exiting.
