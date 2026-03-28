const { getDb } = require('../../db/connection');
const { v4: uuidv4 } = require('uuid');

function findAll({ status } = {}) {
  if (status) {
    return getDb()
      .prepare('SELECT * FROM projects WHERE status = ? ORDER BY created_at DESC')
      .all(status);
  }
  return getDb().prepare('SELECT * FROM projects ORDER BY created_at DESC').all();
}

function findById(id) {
  return getDb().prepare('SELECT * FROM projects WHERE id = ?').get(id);
}

function findByOwner(ownerId) {
  return getDb()
    .prepare('SELECT * FROM projects WHERE owner_id = ? ORDER BY created_at DESC')
    .all(ownerId);
}

function create({ name, description, status, owner_id }) {
  const id = uuidv4();
  const now = new Date().toISOString();
  getDb()
    .prepare(
      'INSERT INTO projects (id, name, description, status, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(id, name, description || null, status || 'active', owner_id, now, now);
  return findById(id);
}

function update(id, fields) {
  const allowed = ['name', 'description', 'status'];
  const sets = [];
  const values = [];
  for (const key of allowed) {
    if (fields[key] !== undefined) {
      sets.push(`${key} = ?`);
      values.push(fields[key]);
    }
  }
  if (sets.length === 0) return findById(id);

  sets.push("updated_at = datetime('now')");
  values.push(id);
  getDb()
    .prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`)
    .run(...values);
  return findById(id);
}

function remove(id) {
  return getDb().prepare('DELETE FROM projects WHERE id = ?').run(id);
}

module.exports = { findAll, findById, findByOwner, create, update, remove };
