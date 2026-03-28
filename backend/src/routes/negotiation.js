import { Router } from "express";
import {
  setNeeds,
  setOffers,
  getNegotiationState,
} from "../services/agentComm.js";

const router = Router();

/** GET /api/negotiation — full negotiation state for all known agents. */
router.get("/", async (_req, res, next) => {
  try {
    const state = await getNegotiationState();
    res.json({ negotiation: state });
  } catch (err) {
    next(err);
  }
});

/** PUT /api/negotiation/:agentId/needs — update what an agent needs. */
router.put("/:agentId/needs", async (req, res, next) => {
  try {
    const { needs } = req.body;
    if (!needs) {
      return res.status(400).json({ error: "Missing required field: needs" });
    }
    const result = await setNeeds(req.params.agentId, needs);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** PUT /api/negotiation/:agentId/offers — update what an agent offers. */
router.put("/:agentId/offers", async (req, res, next) => {
  try {
    const { offers } = req.body;
    if (!offers) {
      return res.status(400).json({ error: "Missing required field: offers" });
    }
    const result = await setOffers(req.params.agentId, offers);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
