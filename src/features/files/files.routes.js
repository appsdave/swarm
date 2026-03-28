const { Router } = require('express');
const path = require('node:path');
const fs = require('node:fs');
const repo = require('./files.repository');
const projectsRepo = require('../projects/projects.repository');
const usersRepo = require('../users/users.repository');
const { upload } = require('./files.upload');
const { createError } = require('../../middleware/validate');
const config = require('../../config');

const router = Router();

// List files for a project
router.get('/project/:projectId', (req, res, next) => {
  const project = projectsRepo.findById(req.params.projectId);
  if (!project) return next(createError(404, 'Project not found'));

  const files = repo.findByProject(req.params.projectId);
  const storageUsed = repo.getProjectStorageUsed(req.params.projectId);
  res.json({
    files,
    storage: {
      used: storageUsed,
      limit: config.uploads.maxProjectStorage,
      remaining: Math.max(0, config.uploads.maxProjectStorage - storageUsed),
    },
  });
});

// Get single file metadata
router.get('/:id', (req, res, next) => {
  const file = repo.findById(req.params.id);
  if (!file) return next(createError(404, 'File not found'));
  res.json(file);
});

// Download a file
router.get('/:id/download', (req, res, next) => {
  const file = repo.findById(req.params.id);
  if (!file) return next(createError(404, 'File not found'));

  const filePath = path.join(config.uploads.dir, file.stored_name);
  if (!fs.existsSync(filePath)) {
    return next(createError(404, 'File data not found on disk'));
  }

  res.download(filePath, file.original_name);
});

// Upload a file to a project
router.post(
  '/project/:projectId',
  (req, res, next) => {
    // Validate project and uploader before accepting the file
    const project = projectsRepo.findById(req.params.projectId);
    if (!project) return next(createError(404, 'Project not found'));
    next();
  },
  upload.single('file'),
  (req, res, next) => {
    if (!req.file) {
      return next(createError(400, 'No file provided'));
    }

    const uploadedBy = req.body.uploaded_by || req.headers['x-user-id'];
    if (!uploadedBy) {
      // Clean up the already-saved file
      fs.unlinkSync(req.file.path);
      return next(createError(400, 'Missing required field: uploaded_by'));
    }

    const user = usersRepo.findById(uploadedBy);
    if (!user) {
      fs.unlinkSync(req.file.path);
      return next(createError(400, 'Uploader not found'));
    }

    // Check project storage quota
    const storageUsed = repo.getProjectStorageUsed(req.params.projectId);
    if (storageUsed + req.file.size > config.uploads.maxProjectStorage) {
      fs.unlinkSync(req.file.path);
      return next(
        createError(
          413,
          `Project storage limit exceeded. Used: ${storageUsed} bytes, limit: ${config.uploads.maxProjectStorage} bytes`,
        ),
      );
    }

    const file = repo.create({
      original_name: req.file.originalname,
      stored_name: req.file.filename,
      mime_type: req.file.mimetype,
      size: req.file.size,
      project_id: req.params.projectId,
      uploaded_by: uploadedBy,
    });

    res.status(201).json(file);
  },
);

// Delete a file
router.delete('/:id', (req, res, next) => {
  const file = repo.findById(req.params.id);
  if (!file) return next(createError(404, 'File not found'));

  // Remove from disk
  const filePath = path.join(config.uploads.dir, file.stored_name);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  repo.remove(req.params.id);
  res.status(204).end();
});

module.exports = router;
