const Database = require('better-sqlite3');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');

let db;

function getDb() {
  if (db) return db;

  const dir = path.dirname(config.db.path);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(config.db.path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

function closeDb() {
  if (db) {
    db.close();
    db = undefined;
  }
}

module.exports = { getDb, closeDb };
