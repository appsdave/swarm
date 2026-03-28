import { Router } from "express";
import { publishSchema, getSchema } from "../services/agentComm.js";

const router = Router();

/** GET /api/schemas/:agentId — retrieve a published schema. */
router.get("/:agentId", async (req, res, next) => {
  try {
    const schema = await getSchema(req.params.agentId);
    if (schema === null) {
      return res.status(404).json({ error: `No schema published by '${req.params.agentId}'` });
    }
    res.json({ agentId: req.params.agentId, schema });
  } catch (err) {
    next(err);
  }
});

/** PUT /api/schemas/:agentId — publish or update a schema. */
router.put("/:agentId", async (req, res, next) => {
  try {
    const { schema } = req.body;
    if (!schema) {
      return res.status(400).json({ error: "Missing required field: schema" });
    }
    const result = await publishSchema(req.params.agentId, schema);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
