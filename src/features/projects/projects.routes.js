const { Router } = require('express');
const repo = require('./projects.repository');
const usersRepo = require('../users/users.repository');
const { requireFields, createError } = require('../../middleware/validate');

const router = Router();

router.get('/', (req, res) => {
  res.json(repo.findAll({ status: req.query.status }));
});

router.get('/:id', (req, res, next) => {
  const project = repo.findById(req.params.id);
  if (!project) return next(createError(404, 'Project not found'));
  res.json(project);
});

router.post('/', requireFields(['name', 'owner_id']), (req, res, next) => {
  const owner = usersRepo.findById(req.body.owner_id);
  if (!owner) return next(createError(400, 'Owner not found'));
  const project = repo.create(req.body);
  res.status(201).json(project);
});

router.patch('/:id', (req, res, next) => {
  const project = repo.findById(req.params.id);
  if (!project) return next(createError(404, 'Project not found'));
  res.json(repo.update(req.params.id, req.body));
});

router.delete('/:id', (req, res, next) => {
  const project = repo.findById(req.params.id);
  if (!project) return next(createError(404, 'Project not found'));
  repo.remove(req.params.id);
  res.status(204).end();
});

module.exports = router;
