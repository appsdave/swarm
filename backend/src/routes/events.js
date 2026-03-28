import { Router } from "express";
import { addSSEClient } from "../services/agentComm.js";

const router = Router();

/** GET /api/events — SSE stream of real-time swarm events. */
router.get("/", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  res.write(`event: connected\ndata: ${JSON.stringify({ message: "SSE stream open" })}\n\n`);

  addSSEClient(res);

  req.on("close", () => {
    res.end();
  });
});

export default router;
