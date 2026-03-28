import express from "express";
import cors from "cors";

import agentsRouter from "./routes/agents.js";
import messagesRouter from "./routes/messages.js";
import schemasRouter from "./routes/schemas.js";
import negotiationRouter from "./routes/negotiation.js";
import eventsRouter from "./routes/events.js";
import runsRouter from "./routes/runs.js";
import notificationsRouter from "./routes/notifications.js";

/**
 * Create and configure the Express application.
 * Exported separately from the server so tests can import the app without
 * starting the HTTP listener or connecting to Redis.
 */
export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // Health check
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Route mounts
  app.use("/api/agents", agentsRouter);
  app.use("/api/messages", messagesRouter);
  app.use("/api/schemas", schemasRouter);
  app.use("/api/negotiation", negotiationRouter);
  app.use("/api/events", eventsRouter);
  app.use("/api/runs", runsRouter);
  app.use("/api/notifications", notificationsRouter);

  // Global error handler
  app.use((err, _req, res, _next) => {
    console.error("[api]", err);
    res.status(500).json({ error: err.message || "Internal server error" });
  });

  return app;
}
