import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createApp } from "../src/app.js";
import { connectAll, disconnectAll, getClient } from "../src/services/redis.js";
import { startPubSubBridge } from "../src/services/agentComm.js";

/** Tiny helper — makes an HTTP request against the test server. */
function request(server, method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, `http://localhost:${server.address().port}`);
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { "Content-Type": "application/json" },
    };
    const req = http.request(opts, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/** Keys we create during tests — cleaned up in beforeEach. */
const TEST_KEYS = [
  "agent:test-agent-1:status",
  "agent:test-agent-1:task",
  "agent:test-agent-1:last_poll",
  "blocked:test-agent-1",
  "schema:test-agent-1",
  "request:test-agent-1:needs",
  "request:test-agent-1:offers",
  "msg:test-agent-2",
  "msg:test-agent-1",
  "swarm:broadcast-log",
  "agent:test-agent-2:status",
  "agent:test-agent-2:task",
  "agent:test-agent-2:last_poll",
  "request:test-agent-2:needs",
  "request:test-agent-2:offers",
  "swarm:notifications",
];

let server;

before(async () => {
  await connectAll();
  await startPubSubBridge();
  const app = createApp();
  server = app.listen(0); // random port
  await new Promise((r) => server.on("listening", r));
});

after(async () => {
  // Clean up test keys
  const redis = getClient();
  await redis.del(...TEST_KEYS);
  server.close();
  await disconnectAll();
});

beforeEach(async () => {
  const redis = getClient();
  await redis.del(...TEST_KEYS);
});

// ─── Health ─────────────────────────────────────────────────────────

describe("GET /api/health", () => {
  it("returns ok", async () => {
    const res = await request(server, "GET", "/api/health");
    assert.equal(res.status, 200);
    assert.equal(res.body.status, "ok");
    assert.ok(res.body.timestamp);
  });
});

// ─── Agents ─────────────────────────────────────────────────────────

describe("Agents API", () => {
  it("PUT /api/agents/:id/status sets status and task", async () => {
    const res = await request(server, "PUT", "/api/agents/test-agent-1/status", {
      status: "running",
      task: "Testing",
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.agentId, "test-agent-1");
    assert.equal(res.body.status, "running");
  });

  it("GET /api/agents/:id returns snapshot", async () => {
    await request(server, "PUT", "/api/agents/test-agent-1/status", {
      status: "running",
      task: "Testing",
    });
    const res = await request(server, "GET", "/api/agents/test-agent-1");
    assert.equal(res.status, 200);
    assert.equal(res.body.status, "running");
    assert.equal(res.body.task, "Testing");
  });

  it("GET /api/agents/:id returns 404 for unknown agent", async () => {
    const res = await request(server, "GET", "/api/agents/nonexistent-agent-xyz");
    assert.equal(res.status, 404);
  });

  it("GET /api/agents lists all agents", async () => {
    await request(server, "PUT", "/api/agents/test-agent-1/status", {
      status: "running",
      task: "Testing",
    });
    const res = await request(server, "GET", "/api/agents");
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.agents));
    const found = res.body.agents.find((a) => a.agentId === "test-agent-1");
    assert.ok(found);
  });

  it("PUT /api/agents/:id/status rejects missing status", async () => {
    const res = await request(server, "PUT", "/api/agents/test-agent-1/status", {
      task: "No status field",
    });
    assert.equal(res.status, 400);
  });

  it("POST /api/agents/:id/block and /unblock work", async () => {
    const blockRes = await request(server, "POST", "/api/agents/test-agent-1/block", {
      waitingFor: "schema:frontend",
    });
    assert.equal(blockRes.status, 200);
    assert.equal(blockRes.body.status, "blocked");

    const snapRes = await request(server, "GET", "/api/agents/test-agent-1");
    assert.equal(snapRes.body.status, "blocked");
    assert.equal(snapRes.body.blocked, "schema:frontend");

    const unblockRes = await request(server, "POST", "/api/agents/test-agent-1/unblock");
    assert.equal(unblockRes.status, 200);
    assert.equal(unblockRes.body.status, "running");
  });

  it("POST /api/agents/:id/block rejects missing waitingFor", async () => {
    const res = await request(server, "POST", "/api/agents/test-agent-1/block", {});
    assert.equal(res.status, 400);
  });
});

// ─── Messages ───────────────────────────────────────────────────────

describe("Messages API", () => {
  it("POST /api/messages sends and GET reads a message", async () => {
    const sendRes = await request(server, "POST", "/api/messages", {
      from: "test-agent-1",
      to: "test-agent-2",
      text: "Hello from test",
    });
    assert.equal(sendRes.status, 201);
    assert.equal(sendRes.body.from, "test-agent-1");

    const readRes = await request(server, "GET", "/api/messages/test-agent-2");
    assert.equal(readRes.status, 200);
    assert.equal(readRes.body.messages.length, 1);
    assert.equal(readRes.body.messages[0].from, "test-agent-1");
    assert.equal(readRes.body.messages[0].text, "Hello from test");
  });

  it("DELETE /api/messages/:agentId clears inbox", async () => {
    await request(server, "POST", "/api/messages", {
      from: "test-agent-1",
      to: "test-agent-2",
      text: "To be deleted",
    });

    const delRes = await request(server, "DELETE", "/api/messages/test-agent-2");
    assert.equal(delRes.status, 200);
    assert.equal(delRes.body.cleared, 1);

    const readRes = await request(server, "GET", "/api/messages/test-agent-2");
    assert.equal(readRes.body.messages.length, 0);
  });

  it("POST /api/messages rejects incomplete payload", async () => {
    const res = await request(server, "POST", "/api/messages", { from: "a" });
    assert.equal(res.status, 400);
  });

  it("POST /api/messages/broadcast stores and GET /broadcast/log retrieves", async () => {
    const sendRes = await request(server, "POST", "/api/messages/broadcast", {
      from: "test-agent-1",
      text: "Broadcast test",
    });
    assert.equal(sendRes.status, 201);

    const logRes = await request(server, "GET", "/api/messages/broadcast/log");
    assert.equal(logRes.status, 200);
    assert.ok(logRes.body.messages.length >= 1);
    assert.equal(logRes.body.messages[0].text, "Broadcast test");
  });
});

// ─── Schemas ────────────────────────────────────────────────────────

describe("Schemas API", () => {
  it("PUT publishes and GET retrieves schema", async () => {
    const schema = { tables: { users: { id: "int", name: "text" } } };
    const putRes = await request(server, "PUT", "/api/schemas/test-agent-1", { schema });
    assert.equal(putRes.status, 200);

    const getRes = await request(server, "GET", "/api/schemas/test-agent-1");
    assert.equal(getRes.status, 200);
    assert.deepEqual(getRes.body.schema, schema);
  });

  it("GET returns 404 for missing schema", async () => {
    const res = await request(server, "GET", "/api/schemas/nonexistent-xyz");
    assert.equal(res.status, 404);
  });

  it("PUT rejects missing schema field", async () => {
    const res = await request(server, "PUT", "/api/schemas/test-agent-1", {});
    assert.equal(res.status, 400);
  });
});

// ─── Notifications ──────────────────────────────────────────────────

describe("Notifications API", () => {
  it("POST /api/notifications creates and GET retrieves", async () => {
    const postRes = await request(server, "POST", "/api/notifications", {
      type: "info",
      agentId: "test-agent-1",
      message: "Test notification",
    });
    assert.equal(postRes.status, 201);
    assert.ok(postRes.body.id);
    assert.equal(postRes.body.type, "info");
    assert.equal(postRes.body.message, "Test notification");
    assert.equal(postRes.body.read, false);

    const getRes = await request(server, "GET", "/api/notifications");
    assert.equal(getRes.status, 200);
    assert.ok(Array.isArray(getRes.body));
    const found = getRes.body.find((n) => n.message === "Test notification");
    assert.ok(found);
  });

  it("POST /api/notifications rejects missing message", async () => {
    const res = await request(server, "POST", "/api/notifications", {
      type: "info",
    });
    assert.equal(res.status, 400);
  });

  it("PATCH /api/notifications/:id/read marks as read", async () => {
    const postRes = await request(server, "POST", "/api/notifications", {
      message: "To be read",
    });
    const id = postRes.body.id;

    const patchRes = await request(server, "PATCH", `/api/notifications/${id}/read`);
    assert.equal(patchRes.status, 200);
    assert.equal(patchRes.body.read, true);

    // Verify it's actually marked as read
    const getRes = await request(server, "GET", "/api/notifications?unread=true");
    const found = getRes.body.find((n) => n.id === id);
    assert.equal(found, undefined);
  });

  it("PATCH /api/notifications/:id/read returns 404 for unknown id", async () => {
    const res = await request(server, "PATCH", "/api/notifications/nonexistent/read");
    assert.equal(res.status, 404);
  });

  it("POST /api/notifications/read-all marks all as read", async () => {
    await request(server, "POST", "/api/notifications", { message: "n1" });
    await request(server, "POST", "/api/notifications", { message: "n2" });

    const res = await request(server, "POST", "/api/notifications/read-all");
    assert.equal(res.status, 200);
    assert.ok(res.body.marked >= 2);

    const getRes = await request(server, "GET", "/api/notifications?unread=true");
    assert.equal(getRes.body.length, 0);
  });

  it("sending a message auto-generates a notification", async () => {
    // Clear notifications first
    const redis = getClient();
    await redis.del("swarm:notifications");

    await request(server, "POST", "/api/messages", {
      from: "test-agent-1",
      to: "test-agent-2",
      text: "Trigger notif",
    });

    const getRes = await request(server, "GET", "/api/notifications");
    const found = getRes.body.find((n) => n.type === "message" && n.message.includes("Trigger notif"));
    assert.ok(found, "Expected a message notification to be auto-generated");
  });

  it("broadcasting auto-generates a notification", async () => {
    const redis = getClient();
    await redis.del("swarm:notifications");

    await request(server, "POST", "/api/messages/broadcast", {
      from: "test-agent-1",
      text: "Broadcast notif test",
    });

    const getRes = await request(server, "GET", "/api/notifications");
    const found = getRes.body.find((n) => n.type === "broadcast" && n.message.includes("Broadcast notif test"));
    assert.ok(found, "Expected a broadcast notification to be auto-generated");
  });
});

// ─── Negotiation ────────────────────────────────────────────────────

describe("Negotiation API", () => {
  it("PUT needs/offers and GET negotiation state", async () => {
    await request(server, "PUT", "/api/negotiation/test-agent-1/needs", {
      needs: "schema:frontend",
    });
    await request(server, "PUT", "/api/negotiation/test-agent-1/offers", {
      offers: "API endpoints, DB schema",
    });

    const res = await request(server, "GET", "/api/negotiation");
    assert.equal(res.status, 200);
    assert.ok(res.body.negotiation["test-agent-1"]);
    assert.equal(res.body.negotiation["test-agent-1"].needs, "schema:frontend");
    assert.equal(res.body.negotiation["test-agent-1"].offers, "API endpoints, DB schema");
  });

  it("PUT needs rejects missing field", async () => {
    const res = await request(server, "PUT", "/api/negotiation/test-agent-1/needs", {});
    assert.equal(res.status, 400);
  });

  it("PUT offers rejects missing field", async () => {
    const res = await request(server, "PUT", "/api/negotiation/test-agent-1/offers", {});
    assert.equal(res.status, 400);
  });
});
