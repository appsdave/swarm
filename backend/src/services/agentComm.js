import { getClient, getSubscriber, getPublisher } from "./redis.js";

/** Redis pub/sub channel for real-time agent events. */
const CHANNEL_AGENT_EVENTS = "swarm:agent-events";

/** Redis pub/sub channel for broadcast messages. */
const CHANNEL_BROADCAST = "swarm:broadcast";

/** Known agent key prefixes matching the existing blackboard protocol. */
const AGENT_KEYS = {
  status: (id) => `agent:${id}:status`,
  task: (id) => `agent:${id}:task`,
  lastPoll: (id) => `agent:${id}:last_poll`,
  blocked: (id) => `blocked:${id}`,
  schema: (id) => `schema:${id}`,
  needs: (id) => `request:${id}:needs`,
  offers: (id) => `request:${id}:offers`,
  inbox: (id) => `msg:${id}`,
};

// ─── Notification helper ────────────────────────────────────────────

const NOTIF_KEY = "swarm:notifications";
const MAX_NOTIFICATIONS = 200;

/**
 * Push a notification to the persistent notification list and emit an SSE event.
 * Called internally when messages are sent, broadcasts occur, or agents change status.
 */
async function pushNotification(redis, { type, agentId, message }) {
  const notif = {
    id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: type || "info",
    agentId: agentId || null,
    message: message || "",
    timestamp: new Date().toISOString(),
    read: false,
  };
  await redis.lpush(NOTIF_KEY, JSON.stringify(notif));
  await redis.ltrim(NOTIF_KEY, 0, MAX_NOTIFICATIONS - 1);

  // Fire SSE event for real-time delivery
  broadcastSSE("agent-event", {
    agentId: notif.agentId || "system",
    type: "notification",
    payload: { id: notif.id, type: notif.type, message: notif.message },
    timestamp: notif.timestamp,
  });

  return notif;
}

// ─── Event listeners for SSE ────────────────────────────────────────

const sseClients = new Set();

export function addSSEClient(res) {
  sseClients.add(res);
  res.on("close", () => sseClients.delete(res));
}

function broadcastSSE(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    res.write(payload);
  }
}

// ─── Pub/Sub bridge ─────────────────────────────────────────────────

export async function startPubSubBridge() {
  const sub = getSubscriber();
  await sub.subscribe(CHANNEL_AGENT_EVENTS, CHANNEL_BROADCAST);

  sub.on("message", (channel, message) => {
    try {
      const data = JSON.parse(message);
      if (channel === CHANNEL_AGENT_EVENTS) {
        broadcastSSE("agent-event", data);
      } else if (channel === CHANNEL_BROADCAST) {
        broadcastSSE("broadcast", data);
      }
    } catch {
      broadcastSSE("raw", { channel, message });
    }
  });
}

/**
 * Publish a structured event to the agent-events channel.
 * This supplements the existing key-value protocol with real-time push.
 */
export async function publishAgentEvent(agentId, eventType, payload = {}) {
  const pub = getPublisher();
  const event = {
    agentId,
    type: eventType,
    payload,
    timestamp: new Date().toISOString(),
  };
  await pub.publish(CHANNEL_AGENT_EVENTS, JSON.stringify(event));
  return event;
}

/**
 * Broadcast a message to all agents (via pub/sub + stored list).
 */
export async function broadcastMessage(fromAgent, text) {
  const redis = getClient();
  const pub = getPublisher();

  const msg = {
    from: fromAgent,
    text,
    timestamp: new Date().toISOString(),
  };

  // Store in a persistent broadcast log (capped at 200 entries)
  await redis.lpush("swarm:broadcast-log", JSON.stringify(msg));
  await redis.ltrim("swarm:broadcast-log", 0, 199);

  // Also push via pub/sub for real-time delivery
  await pub.publish(CHANNEL_BROADCAST, JSON.stringify(msg));

  // Auto-generate a notification for the broadcast
  await pushNotification(redis, {
    type: "broadcast",
    agentId: fromAgent,
    message: `Broadcast from ${fromAgent}: ${text}`,
  });

  return msg;
}

// ─── Agent status operations ────────────────────────────────────────

export async function getAgentSnapshot(agentId) {
  const redis = getClient();
  const [status, task, lastPoll, blocked, schema, needs, offers] =
    await redis.mget(
      AGENT_KEYS.status(agentId),
      AGENT_KEYS.task(agentId),
      AGENT_KEYS.lastPoll(agentId),
      AGENT_KEYS.blocked(agentId),
      AGENT_KEYS.schema(agentId),
      AGENT_KEYS.needs(agentId),
      AGENT_KEYS.offers(agentId),
    );

  return { agentId, status, task, lastPoll, blocked, schema, needs, offers };
}

export async function getAllAgentSnapshots() {
  const redis = getClient();
  // Discover all agents by scanning for agent:*:status keys
  const keys = await redis.keys("agent:*:status");
  const agentIds = keys.map((k) => k.replace("agent:", "").replace(":status", ""));

  const snapshots = await Promise.all(agentIds.map(getAgentSnapshot));
  return snapshots;
}

export async function setAgentStatus(agentId, status, task) {
  const redis = getClient();
  const pipeline = redis.pipeline();
  pipeline.set(AGENT_KEYS.status(agentId), status);
  if (task !== undefined) {
    pipeline.set(AGENT_KEYS.task(agentId), task);
  }
  pipeline.set(AGENT_KEYS.lastPoll(agentId), new Date().toISOString());
  await pipeline.exec();

  await publishAgentEvent(agentId, "status-change", { status, task });

  // Auto-generate notifications for notable status changes
  if (status === "blocked" || status === "error" || status === "done") {
    await pushNotification(redis, {
      type: "status",
      agentId,
      message: `Agent ${agentId} is now ${status}${task ? `: ${task}` : ""}`,
    });
  }

  return { agentId, status, task };
}

// ─── Messaging (extends existing msg:<id> lists) ────────────────────

export async function sendMessage(fromAgent, toAgent, text) {
  const redis = getClient();
  const formatted = `${fromAgent}|${text}`;

  // Push to the recipient's inbox (compatible with existing protocol)
  await redis.lpush(AGENT_KEYS.inbox(toAgent), formatted);

  // Also publish real-time event
  await publishAgentEvent(fromAgent, "message-sent", {
    to: toAgent,
    text,
  });

  // Auto-generate a notification for the recipient
  await pushNotification(redis, {
    type: "message",
    agentId: toAgent,
    message: `New message from ${fromAgent}: ${text}`,
  });

  return { from: fromAgent, to: toAgent, text, timestamp: new Date().toISOString() };
}

export async function getMessages(agentId) {
  const redis = getClient();
  const raw = await redis.lrange(AGENT_KEYS.inbox(agentId), 0, -1);

  return raw.map((entry) => {
    const pipeIdx = entry.indexOf("|");
    if (pipeIdx === -1) return { from: "unknown", text: entry };
    return { from: entry.slice(0, pipeIdx), text: entry.slice(pipeIdx + 1) };
  });
}

export async function clearInbox(agentId) {
  const redis = getClient();
  const count = await redis.llen(AGENT_KEYS.inbox(agentId));
  await redis.del(AGENT_KEYS.inbox(agentId));
  return { agentId, cleared: count };
}

// ─── Schema operations ──────────────────────────────────────────────

export async function publishSchema(agentId, schemaJson) {
  const redis = getClient();
  const value = typeof schemaJson === "string" ? schemaJson : JSON.stringify(schemaJson);
  await redis.set(AGENT_KEYS.schema(agentId), value);
  await redis.set(AGENT_KEYS.task(agentId), "Schema published, continuing logic");

  await publishAgentEvent(agentId, "schema-published", { schema: schemaJson });
  return { agentId, schema: schemaJson };
}

export async function getSchema(agentId) {
  const redis = getClient();
  const raw = await redis.get(AGENT_KEYS.schema(agentId));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

// ─── Negotiation (needs/offers) ─────────────────────────────────────

export async function setNeeds(agentId, needs) {
  const redis = getClient();
  await redis.set(AGENT_KEYS.needs(agentId), needs);
  await publishAgentEvent(agentId, "needs-updated", { needs });
  return { agentId, needs };
}

export async function setOffers(agentId, offers) {
  const redis = getClient();
  await redis.set(AGENT_KEYS.offers(agentId), offers);
  await publishAgentEvent(agentId, "offers-updated", { offers });
  return { agentId, offers };
}

export async function getNegotiationState() {
  const redis = getClient();
  const keys = await redis.keys("request:*:needs");
  const agentIds = keys.map((k) => k.split(":")[1]);

  const state = {};
  for (const id of agentIds) {
    const [needs, offers] = await redis.mget(
      AGENT_KEYS.needs(id),
      AGENT_KEYS.offers(id),
    );
    state[id] = { needs, offers };
  }
  return state;
}

// ─── Broadcast log retrieval ────────────────────────────────────────

export async function getBroadcastLog(limit = 50) {
  const redis = getClient();
  const raw = await redis.lrange("swarm:broadcast-log", 0, limit - 1);
  return raw.map((entry) => {
    try {
      return JSON.parse(entry);
    } catch {
      return { raw: entry };
    }
  });
}

// ─── Blocking/unblocking ────────────────────────────────────────────

export async function blockAgent(agentId, waitingFor) {
  const redis = getClient();
  const pipeline = redis.pipeline();
  pipeline.set(AGENT_KEYS.status(agentId), "blocked");
  pipeline.set(AGENT_KEYS.blocked(agentId), waitingFor);
  pipeline.set(AGENT_KEYS.lastPoll(agentId), new Date().toISOString());
  await pipeline.exec();

  await publishAgentEvent(agentId, "blocked", { waitingFor });
  return { agentId, status: "blocked", waitingFor };
}

export async function unblockAgent(agentId) {
  const redis = getClient();
  const pipeline = redis.pipeline();
  pipeline.set(AGENT_KEYS.status(agentId), "running");
  pipeline.del(AGENT_KEYS.blocked(agentId));
  pipeline.set(AGENT_KEYS.lastPoll(agentId), new Date().toISOString());
  await pipeline.exec();

  await publishAgentEvent(agentId, "unblocked", {});
  return { agentId, status: "running" };
}
