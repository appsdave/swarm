const { Router } = require('express');
const repo = require('./prompts.repository');
const { requireFields, createError } = require('../../middleware/validate');

const router = Router();

/**
 * Maximum allowed prompt length (characters).
 * The frontend can read this from GET /api/prompts/config to configure
 * auto-scroll thresholds and textarea constraints.
 */
const MAX_PROMPT_LENGTH = 50000;

router.get('/config', (_req, res) => {
  res.json({
    maxPromptLength: MAX_PROMPT_LENGTH,
    autoScrollEnabled: true,
  });
});

router.get('/', (req, res) => {
  res.json(repo.findAll({
    project_id: req.query.project_id,
    status: req.query.status,
  }));
});

router.get('/:id', (req, res, next) => {
  const prompt = repo.findById(req.params.id);
  if (!prompt) return next(createError(404, 'Prompt not found'));
  res.json(prompt);
});

router.post('/', requireFields(['body']), (req, res, next) => {
  if (req.body.body.length > MAX_PROMPT_LENGTH) {
    return next(
      createError(400, `Prompt exceeds maximum length of ${MAX_PROMPT_LENGTH} characters`),
    );
  }

  const prompt = repo.create({
    body: req.body.body,
    project_id: req.body.project_id || null,
  });

  res.status(201).json({
    prompt,
    clearInput: true,
  });
});

router.patch('/:id', (req, res, next) => {
  const prompt = repo.findById(req.params.id);
  if (!prompt) return next(createError(404, 'Prompt not found'));

  const validStatuses = ['pending', 'running', 'done', 'failed'];
  if (req.body.status && !validStatuses.includes(req.body.status)) {
    return next(createError(400, `Invalid status. Must be one of: ${validStatuses.join(', ')}`));
  }

  res.json(repo.update(req.params.id, req.body));
});

router.delete('/:id', (req, res, next) => {
  const prompt = repo.findById(req.params.id);
  if (!prompt) return next(createError(404, 'Prompt not found'));
  repo.remove(req.params.id);
  res.status(204).end();
});

module.exports = router;
