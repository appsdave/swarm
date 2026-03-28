const { Router } = require('express');
const repo = require('./users.repository');
const { requireFields } = require('../../middleware/validate');
const { createError } = require('../../middleware/validate');

const router = Router();

router.get('/', (_req, res) => {
  res.json(repo.findAll());
});

router.get('/:id', (req, res, next) => {
  const user = repo.findById(req.params.id);
  if (!user) return next(createError(404, 'User not found'));
  res.json(user);
});

router.post('/', requireFields(['email', 'name']), (req, res, next) => {
  const existing = repo.findByEmail(req.body.email);
  if (existing) return next(createError(409, 'Email already in use'));
  const user = repo.create(req.body);
  res.status(201).json(user);
});

router.patch('/:id', (req, res, next) => {
  const user = repo.findById(req.params.id);
  if (!user) return next(createError(404, 'User not found'));
  if (req.body.email) {
    const existing = repo.findByEmail(req.body.email);
    if (existing && existing.id !== req.params.id) {
      return next(createError(409, 'Email already in use'));
    }
  }
  res.json(repo.update(req.params.id, req.body));
});

router.delete('/:id', (req, res, next) => {
  const user = repo.findById(req.params.id);
  if (!user) return next(createError(404, 'User not found'));
  repo.remove(req.params.id);
  res.status(204).end();
});

module.exports = router;
