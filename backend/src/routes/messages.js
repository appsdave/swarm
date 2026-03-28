import { Router } from "express";
import {
  sendMessage,
  getMessages,
  clearInbox,
  broadcastMessage,
  getBroadcastLog,
} from "../services/agentComm.js";

const router = Router();

/** POST /api/messages/broadcast — send a message to all agents. */
router.post("/broadcast", async (req, res, next) => {
  try {
    const { from, text } = req.body;
    if (!from || !text) {
      return res.status(400).json({ error: "Missing required fields: from, text" });
    }
    const result = await broadcastMessage(from, text);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

/** GET /api/messages/broadcast/log — get the broadcast message history. */
router.get("/broadcast/log", async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const log = await getBroadcastLog(limit);
    res.json({ messages: log });
  } catch (err) {
    next(err);
  }
});

/** POST /api/messages — send a direct message to another agent. */
router.post("/", async (req, res, next) => {
  try {
    const { from, to, text } = req.body;
    if (!from || !to || !text) {
      return res.status(400).json({ error: "Missing required fields: from, to, text" });
    }
    const result = await sendMessage(from, to, text);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

/** GET /api/messages/:agentId — read an agent's inbox. */
router.get("/:agentId", async (req, res, next) => {
  try {
    const messages = await getMessages(req.params.agentId);
    res.json({ agentId: req.params.agentId, messages });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/messages/:agentId — clear an agent's inbox. */
router.delete("/:agentId", async (req, res, next) => {
  try {
    const result = await clearInbox(req.params.agentId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
