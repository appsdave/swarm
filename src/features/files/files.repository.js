const { getDb } = require('../../db/connection');
const { v4: uuidv4 } = require('uuid');

function findByProject(projectId) {
  return getDb()
    .prepare('SELECT * FROM files WHERE project_id = ? ORDER BY created_at DESC')
    .all(projectId);
}

function findById(id) {
  return getDb().prepare('SELECT * FROM files WHERE id = ?').get(id);
}

function getProjectStorageUsed(projectId) {
  const row = getDb()
    .prepare('SELECT COALESCE(SUM(size), 0) AS total FROM files WHERE project_id = ?')
    .get(projectId);
  return row.total;
}

function create({ original_name, stored_name, mime_type, size, project_id, uploaded_by }) {
  const id = uuidv4();
  const now = new Date().toISOString();
  getDb()
    .prepare(
      'INSERT INTO files (id, original_name, stored_name, mime_type, size, project_id, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(id, original_name, stored_name, mime_type, size, project_id, uploaded_by, now);
  return findById(id);
}

function remove(id) {
  return getDb().prepare('DELETE FROM files WHERE id = ?').run(id);
}

module.exports = { findByProject, findById, getProjectStorageUsed, create, remove };
