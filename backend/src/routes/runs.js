import { Router } from "express";
import { getClient } from "../services/redis.js";

const router = Router();

const RUNS_KEY = "swarm:runs";
const MAX_RUNS = 100;

/**
 * POST /api/runs — Save a new run snapshot.
 * Body: { task, agents: [...], duration, outcome }
 */
router.post("/", async (req, res, next) => {
  try {
    const redis = getClient();
    const run = {
      id: `run-${Date.now()}`,
      task: req.body.task || "unknown",
      agents: req.body.agents || [],
      duration: req.body.duration || null,
      outcome: req.body.outcome || "unknown",
      timestamp: new Date().toISOString(),
    };
    await redis.lpush(RUNS_KEY, JSON.stringify(run));
    await redis.ltrim(RUNS_KEY, 0, MAX_RUNS - 1);
    res.status(201).json(run);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/runs — List past runs (most recent first).
 * Query: ?limit=20
 */
router.get("/", async (req, res, next) => {
  try {
    const redis = getClient();
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, MAX_RUNS);
    const raw = await redis.lrange(RUNS_KEY, 0, limit - 1);
    const runs = raw.map((entry) => {
      try { return JSON.parse(entry); } catch { return { raw: entry }; }
    });
    res.json(runs);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/runs/:id — Get a specific run by ID.
 */
router.get("/:id", async (req, res, next) => {
  try {
    const redis = getClient();
    const raw = await redis.lrange(RUNS_KEY, 0, MAX_RUNS - 1);
    const run = raw
      .map((entry) => { try { return JSON.parse(entry); } catch { return null; } })
      .find((r) => r && r.id === req.params.id);
    if (!run) return res.status(404).json({ error: "Run not found" });
    res.json(run);
  } catch (err) {
    next(err);
  }
});

export default router;
