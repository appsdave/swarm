const { Router } = require('express');

const router = Router();

/**
 * Layout configuration for the agent split-view.
 * The frontend reads this to size each agent's panel.
 */
const LAYOUT_CONFIG = {
  splitDirection: 'horizontal',
  panels: [
    {
      id: 'agent-a1',
      label: 'Agent A1 — UI',
      role: 'frontend',
      widthPercent: 80,
      minWidthPercent: 60,
      maxWidthPercent: 95,
    },
    {
      id: 'agent-b1',
      label: 'Agent B1 — Backend',
      role: 'backend',
      widthPercent: 20,
      minWidthPercent: 5,
      maxWidthPercent: 40,
    },
  ],
  taskInput: {
    position: 'bottom',
    autoScroll: true,
    scrollBehavior: 'smooth',
    scrollToCursor: true,
    maxVisibleLines: 6,
    tips: {
      enabled: true,
      position: 'below-input',
      rotateIntervalMs: 8000,
    },
  },
};

/**
 * GET /api/layout
 * Returns the full layout configuration consumed by the frontend.
 */
router.get('/', (_req, res) => {
  res.json(LAYOUT_CONFIG);
});

/**
 * GET /api/layout/panels
 * Returns only the panel split configuration.
 */
router.get('/panels', (_req, res) => {
  res.json({
    splitDirection: LAYOUT_CONFIG.splitDirection,
    panels: LAYOUT_CONFIG.panels,
  });
});

/**
 * GET /api/layout/task-input
 * Returns task-input-specific layout and behavior settings.
 */
router.get('/task-input', (_req, res) => {
  res.json(LAYOUT_CONFIG.taskInput);
});

module.exports = router;
