const { Router } = require('express');
const repo = require('./tasks.repository');
const projectsRepo = require('../projects/projects.repository');
const usersRepo = require('../users/users.repository');
const { requireFields, createError } = require('../../middleware/validate');

const router = Router();

router.get('/', (req, res) => {
  res.json(repo.findAll({
    project_id: req.query.project_id,
    status: req.query.status,
    assignee_id: req.query.assignee_id,
  }));
});

router.get('/:id', (req, res, next) => {
  const task = repo.findById(req.params.id);
  if (!task) return next(createError(404, 'Task not found'));
  res.json(task);
});

router.post('/', requireFields(['title', 'project_id']), (req, res, next) => {
  const project = projectsRepo.findById(req.body.project_id);
  if (!project) return next(createError(400, 'Project not found'));

  if (req.body.assignee_id) {
    const assignee = usersRepo.findById(req.body.assignee_id);
    if (!assignee) return next(createError(400, 'Assignee not found'));
  }

  const task = repo.create(req.body);
  res.status(201).json(task);
});

router.patch('/:id', (req, res, next) => {
  const task = repo.findById(req.params.id);
  if (!task) return next(createError(404, 'Task not found'));

  if (req.body.assignee_id) {
    const assignee = usersRepo.findById(req.body.assignee_id);
    if (!assignee) return next(createError(400, 'Assignee not found'));
  }

  res.json(repo.update(req.params.id, req.body));
});

router.delete('/:id', (req, res, next) => {
  const task = repo.findById(req.params.id);
  if (!task) return next(createError(404, 'Task not found'));
  repo.remove(req.params.id);
  res.status(204).end();
});

module.exports = router;
