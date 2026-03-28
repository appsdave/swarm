const { getDb } = require('../../db/connection');
const { v4: uuidv4 } = require('uuid');

function findAll({ project_id, status, assignee_id } = {}) {
  let sql = 'SELECT * FROM tasks WHERE 1=1';
  const params = [];

  if (project_id) {
    sql += ' AND project_id = ?';
    params.push(project_id);
  }
  if (status) {
    sql += ' AND status = ?';
    params.push(status);
  }
  if (assignee_id) {
    sql += ' AND assignee_id = ?';
    params.push(assignee_id);
  }

  sql += ' ORDER BY priority DESC, created_at DESC';
  return getDb().prepare(sql).all(...params);
}

function findById(id) {
  return getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(id);
}

function findByProject(projectId) {
  return getDb()
    .prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY priority DESC, created_at DESC')
    .all(projectId);
}

function create({ title, description, status, priority, project_id, assignee_id }) {
  const id = uuidv4();
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO tasks (id, title, description, status, priority, project_id, assignee_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      title,
      description || null,
      status || 'todo',
      priority ?? 0,
      project_id,
      assignee_id || null,
      now,
      now,
    );
  return findById(id);
}

function update(id, fields) {
  const allowed = ['title', 'description', 'status', 'priority', 'assignee_id'];
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
    .prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`)
    .run(...values);
  return findById(id);
}

function remove(id) {
  return getDb().prepare('DELETE FROM tasks WHERE id = ?').run(id);
}

module.exports = { findAll, findById, findByProject, create, update, remove };
