import { Router } from "express";
import { getClient } from "../services/redis.js";

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
    const notif = {
      id: `notif-${Date.now()}`,
      type: req.body.type || "info",
      agentId: req.body.agentId || null,
      message: req.body.message || "",
      timestamp: new Date().toISOString(),
      read: false,
    };
    await redis.lpush(NOTIF_KEY, JSON.stringify(notif));
    await redis.ltrim(NOTIF_KEY, 0, MAX_NOTIFICATIONS - 1);
    res.status(201).json(notif);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/notifications — Get recent notifications.
 * Query: ?limit=50&since=ISO_TIMESTAMP
 */
router.get("/", async (req, res, next) => {
  try {
    const redis = getClient();
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, MAX_NOTIFICATIONS);
    const since = req.query.since || null;
    const raw = await redis.lrange(NOTIF_KEY, 0, limit - 1);
    let notifications = raw.map((entry) => {
      try { return JSON.parse(entry); } catch { return { raw: entry }; }
    });
    if (since) {
      notifications = notifications.filter((n) => n.timestamp && n.timestamp > since);
    }
    res.json(notifications);
  } catch (err) {
    next(err);
  }
});

export default router;
