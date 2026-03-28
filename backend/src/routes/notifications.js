import { Router } from "express";
import { getClient } from "../services/redis.js";
import { publishAgentEvent } from "../services/agentComm.js";

const router = Router();

const NOTIF_KEY = "swarm:notifications";
const MAX_NOTIFICATIONS = 200;

/**
 * POST /api/notifications — Push a notification event.
 * Body: { type, agentId?, message }
 */
router.post("/", async (req, res, next) => {
  try {
    const redis = getClient();
    const { type, agentId, message } = req.body;
    if (!message) {
      return res.status(400).json({ error: "Missing required field: message" });
    }
    const notif = {
      id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: type || "info",
      agentId: agentId || null,
      message,
      timestamp: new Date().toISOString(),
      read: false,
    };
    await redis.lpush(NOTIF_KEY, JSON.stringify(notif));
    await redis.ltrim(NOTIF_KEY, 0, MAX_NOTIFICATIONS - 1);

    // Publish real-time SSE event so dashboards/frontends see it immediately
    await publishAgentEvent(notif.agentId || "system", "notification", {
      id: notif.id,
      type: notif.type,
      message: notif.message,
    });

    res.status(201).json(notif);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/notifications — Get recent notifications.
 * Query: ?limit=50&since=ISO_TIMESTAMP&unread=true
 */
router.get("/", async (req, res, next) => {
  try {
    const redis = getClient();
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, MAX_NOTIFICATIONS);
    const since = req.query.since || null;
    const unreadOnly = req.query.unread === "true";
    const raw = await redis.lrange(NOTIF_KEY, 0, limit - 1);
    let notifications = raw.map((entry) => {
      try { return JSON.parse(entry); } catch { return { raw: entry }; }
    });
    if (since) {
      notifications = notifications.filter((n) => n.timestamp && n.timestamp > since);
    }
    if (unreadOnly) {
      notifications = notifications.filter((n) => !n.read);
    }
    res.json(notifications);
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/notifications/:id/read — Mark a single notification as read.
 */
router.patch("/:id/read", async (req, res, next) => {
  try {
    const redis = getClient();
    const raw = await redis.lrange(NOTIF_KEY, 0, MAX_NOTIFICATIONS - 1);
    let found = false;
    const updated = raw.map((entry) => {
      try {
        const notif = JSON.parse(entry);
        if (notif.id === req.params.id) {
          found = true;
          notif.read = true;
          return JSON.stringify(notif);
        }
        return entry;
      } catch {
        return entry;
      }
    });
    if (!found) {
      return res.status(404).json({ error: "Notification not found" });
    }
    // Replace the entire list atomically
    const pipeline = redis.pipeline();
    pipeline.del(NOTIF_KEY);
    for (const entry of updated) {
      pipeline.rpush(NOTIF_KEY, entry);
    }
    await pipeline.exec();
    res.json({ id: req.params.id, read: true });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/notifications/read-all — Mark all notifications as read.
 */
router.post("/read-all", async (req, res, next) => {
  try {
    const redis = getClient();
    const raw = await redis.lrange(NOTIF_KEY, 0, MAX_NOTIFICATIONS - 1);
    let count = 0;
    const updated = raw.map((entry) => {
      try {
        const notif = JSON.parse(entry);
        if (!notif.read) {
          notif.read = true;
          count++;
        }
        return JSON.stringify(notif);
      } catch {
        return entry;
      }
    });
    const pipeline = redis.pipeline();
    pipeline.del(NOTIF_KEY);
    for (const entry of updated) {
      pipeline.rpush(NOTIF_KEY, entry);
    }
    await pipeline.exec();
    res.json({ marked: count });
  } catch (err) {
    next(err);
  }
});

export default router;
