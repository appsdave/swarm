const { getDb } = require('../../db/connection');
const { v4: uuidv4 } = require('uuid');

function findAll() {
  return getDb().prepare('SELECT * FROM users ORDER BY created_at DESC').all();
}

function findById(id) {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function findByEmail(email) {
  return getDb().prepare('SELECT * FROM users WHERE email = ?').get(email);
}

function create({ email, name, role }) {
  const id = uuidv4();
  const now = new Date().toISOString();
  getDb()
    .prepare(
      'INSERT INTO users (id, email, name, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(id, email, name, role || 'member', now, now);
  return findById(id);
}

function update(id, fields) {
  const allowed = ['email', 'name', 'role'];
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
    .prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`)
    .run(...values);
  return findById(id);
}

function remove(id) {
  return getDb().prepare('DELETE FROM users WHERE id = ?').run(id);
}

module.exports = { findAll, findById, findByEmail, create, update, remove };
