const { Router } = require('express');

const router = Router();

/**
 * Static tips shown below the task input to guide users.
 * Ordered by relevance — the frontend can rotate or display a subset.
 */
const TIPS = [
  {
    id: 'tip-be-specific',
    category: 'writing',
    text: 'Be specific — describe the exact outcome you want, not just the topic.',
    icon: '🎯',
  },
  {
    id: 'tip-break-down',
    category: 'writing',
    text: 'Break large tasks into smaller steps for better results.',
    icon: '🧩',
  },
  {
    id: 'tip-context',
    category: 'writing',
    text: 'Add context — mention the tech stack, constraints, or target audience.',
    icon: '📎',
  },
  {
    id: 'tip-examples',
    category: 'writing',
    text: 'Include examples of the input/output you expect.',
    icon: '💡',
  },
  {
    id: 'tip-scroll',
    category: 'ui',
    text: 'Long prompts auto-scroll — keep typing and the view follows your cursor.',
    icon: '📜',
  },
  {
    id: 'tip-shortcuts',
    category: 'ui',
    text: 'Press Enter to submit, Shift+Enter for a new line.',
    icon: '⌨️',
  },
  {
    id: 'tip-agents',
    category: 'agents',
    text: 'Tasks are split between agents automatically — A1 handles UI, B1 handles backend.',
    icon: '🤖',
  },
  {
    id: 'tip-iterate',
    category: 'writing',
    text: 'Iterate — refine your prompt if the first result isn\'t perfect.',
    icon: '🔄',
  },
];

/**
 * GET /api/tips
 * Returns all tips, optionally filtered by category.
 * Query params:
 *   - category (string, optional): filter by tip category
 *   - limit    (number, optional): max tips to return
 */
router.get('/', (req, res) => {
  let result = [...TIPS];

  if (req.query.category) {
    result = result.filter((t) => t.category === req.query.category);
  }

  const limit = parseInt(req.query.limit, 10);
  if (limit > 0 && limit < result.length) {
    result = result.slice(0, limit);
  }

  res.json(result);
});

/**
 * GET /api/tips/random
 * Returns a single random tip, optionally filtered by category.
 */
router.get('/random', (req, res) => {
  let pool = TIPS;

  if (req.query.category) {
    pool = pool.filter((t) => t.category === req.query.category);
  }

  if (pool.length === 0) {
    return res.json(null);
  }

  const tip = pool[Math.floor(Math.random() * pool.length)];
  res.json(tip);
});

module.exports = router;
