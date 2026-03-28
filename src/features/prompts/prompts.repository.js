const { getDb } = require('../../db/connection');
const { v4: uuidv4 } = require('uuid');

function findAll({ project_id, status } = {}) {
  let sql = 'SELECT * FROM prompts WHERE 1=1';
  const params = [];

  if (project_id) {
    sql += ' AND project_id = ?';
    params.push(project_id);
  }
  if (status) {
    sql += ' AND status = ?';
    params.push(status);
  }

  sql += ' ORDER BY created_at DESC';
  return getDb().prepare(sql).all(...params);
}

function findById(id) {
  return getDb().prepare('SELECT * FROM prompts WHERE id = ?').get(id);
}

function create({ body, project_id }) {
  const id = uuidv4();
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO prompts (id, body, project_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, body, project_id || null, 'pending', now, now);
  return findById(id);
}

function update(id, fields) {
  const allowed = ['status'];
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
    .prepare(`UPDATE prompts SET ${sets.join(', ')} WHERE id = ?`)
    .run(...values);
  return findById(id);
}

function remove(id) {
  return getDb().prepare('DELETE FROM prompts WHERE id = ?').run(id);
}

module.exports = { findAll, findById, create, update, remove };
