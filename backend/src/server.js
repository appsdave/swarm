import { createApp } from "./app.js";
import { connectAll, disconnectAll } from "./services/redis.js";
import { startPubSubBridge } from "./services/agentComm.js";

const PORT = parseInt(process.env.PORT, 10) || 3001;

async function main() {
  console.log("[server] Connecting to Redis...");
  await connectAll();
  console.log("[server] Redis connected.");

  await startPubSubBridge();
  console.log("[server] Pub/sub bridge started.");

  const app = createApp();

  const server = app.listen(PORT, () => {
    console.log(`[server] Ambition backend listening on http://localhost:${PORT}`);
    console.log("[server] Endpoints:");
    console.log("  GET  /api/health");
    console.log("  GET  /api/agents");
    console.log("  GET  /api/agents/:id");
    console.log("  PUT  /api/agents/:id/status");
    console.log("  POST /api/agents/:id/block");
    console.log("  POST /api/agents/:id/unblock");
    console.log("  POST /api/messages");
    console.log("  GET  /api/messages/:agentId");
    console.log("  DEL  /api/messages/:agentId");
    console.log("  POST /api/messages/broadcast");
    console.log("  GET  /api/messages/broadcast/log");
    console.log("  GET  /api/schemas/:agentId");
    console.log("  PUT  /api/schemas/:agentId");
    console.log("  GET  /api/negotiation");
    console.log("  PUT  /api/negotiation/:agentId/needs");
    console.log("  PUT  /api/negotiation/:agentId/offers");
    console.log("  GET  /api/events  (SSE stream)");
  });

  // Graceful shutdown
  const shutdown = async (signal) => {
    console.log(`\n[server] Received ${signal}, shutting down...`);
    server.close();
    await disconnectAll();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[server] Fatal:", err);
  process.exit(1);
});
