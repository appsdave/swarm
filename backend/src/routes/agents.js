import { Router } from "express";
import {
  getAllAgentSnapshots,
  getAgentSnapshot,
  setAgentStatus,
  blockAgent,
  unblockAgent,
} from "../services/agentComm.js";

const router = Router();

/** GET /api/agents — list all known agents with full snapshot. */
router.get("/", async (_req, res, next) => {
  try {
    const agents = await getAllAgentSnapshots();
    res.json({ agents });
  } catch (err) {
    next(err);
  }
});

/** GET /api/agents/:id — single agent snapshot. */
router.get("/:id", async (req, res, next) => {
  try {
    const snap = await getAgentSnapshot(req.params.id);
    if (!snap.status) {
      return res.status(404).json({ error: `Agent '${req.params.id}' not found` });
    }
    res.json(snap);
  } catch (err) {
    next(err);
  }
});

/** PUT /api/agents/:id/status — update agent status and optional task. */
router.put("/:id/status", async (req, res, next) => {
  try {
    const { status, task } = req.body;
    if (!status) {
      return res.status(400).json({ error: "Missing required field: status" });
    }
    const result = await setAgentStatus(req.params.id, status, task);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/agents/:id/block — mark agent as blocked. */
router.post("/:id/block", async (req, res, next) => {
  try {
    const { waitingFor } = req.body;
    if (!waitingFor) {
      return res.status(400).json({ error: "Missing required field: waitingFor" });
    }
    const result = await blockAgent(req.params.id, waitingFor);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/agents/:id/unblock — mark agent as running again. */
router.post("/:id/unblock", async (req, res, next) => {
  try {
    const result = await unblockAgent(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
