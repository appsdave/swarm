const { getDb, closeDb } = require('./connection');

const migrations = [
  {
    id: 1,
    name: 'create_users',
    up: `
      CREATE TABLE IF NOT EXISTS users (
        id          TEXT PRIMARY KEY,
        email       TEXT NOT NULL UNIQUE,
        name        TEXT NOT NULL,
        role        TEXT NOT NULL DEFAULT 'member',
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    `,
  },
  {
    id: 2,
    name: 'create_projects',
    up: `
      CREATE TABLE IF NOT EXISTS projects (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        description TEXT,
        status      TEXT NOT NULL DEFAULT 'active',
        owner_id    TEXT NOT NULL,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id);
      CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
    `,
  },
  {
    id: 3,
    name: 'create_tasks',
    up: `
      CREATE TABLE IF NOT EXISTS tasks (
        id          TEXT PRIMARY KEY,
        title       TEXT NOT NULL,
        description TEXT,
        status      TEXT NOT NULL DEFAULT 'todo',
        priority    INTEGER NOT NULL DEFAULT 0,
        project_id  TEXT NOT NULL,
        assignee_id TEXT,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (assignee_id) REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    `,
  },
  {
    id: 4,
    name: 'create_files',
    up: `
      CREATE TABLE IF NOT EXISTS files (
        id            TEXT PRIMARY KEY,
        original_name TEXT NOT NULL,
        stored_name   TEXT NOT NULL UNIQUE,
        mime_type     TEXT NOT NULL,
        size          INTEGER NOT NULL,
        project_id    TEXT NOT NULL,
        uploaded_by   TEXT NOT NULL,
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_files_project ON files(project_id);
      CREATE INDEX IF NOT EXISTS idx_files_uploaded_by ON files(uploaded_by);
    `,
  },
  {
    id: 5,
    name: 'create_prompts',
    up: `
      CREATE TABLE IF NOT EXISTS prompts (
        id          TEXT PRIMARY KEY,
        body        TEXT NOT NULL,
        project_id  TEXT,
        status      TEXT NOT NULL DEFAULT 'pending',
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_prompts_project ON prompts(project_id);
      CREATE INDEX IF NOT EXISTS idx_prompts_status ON prompts(status);
    `,
  },
];

function migrate() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id   INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      run_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const applied = new Set(
    db.prepare('SELECT id FROM _migrations').all().map((r) => r.id),
  );

  const runMigration = db.transaction((migration) => {
    for (const stmt of migration.up.split(';').filter((s) => s.trim())) {
      db.exec(stmt);
    }
    db.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)').run(
      migration.id,
      migration.name,
    );
  });

  for (const migration of migrations) {
    if (!applied.has(migration.id)) {
      runMigration(migration);
      console.log(`  ✓ migration ${migration.id}: ${migration.name}`);
    }
  }
}

function getSchema() {
  return {
    tables: {
      users: {
        columns: {
          id: { type: 'TEXT', primaryKey: true },
          email: { type: 'TEXT', nullable: false, unique: true },
          name: { type: 'TEXT', nullable: false },
          role: { type: 'TEXT', nullable: false, default: 'member' },
          created_at: { type: 'TEXT', nullable: false },
          updated_at: { type: 'TEXT', nullable: false },
        },
        indexes: ['idx_users_email'],
      },
      projects: {
        columns: {
          id: { type: 'TEXT', primaryKey: true },
          name: { type: 'TEXT', nullable: false },
          description: { type: 'TEXT', nullable: true },
          status: { type: 'TEXT', nullable: false, default: 'active' },
          owner_id: { type: 'TEXT', nullable: false, foreignKey: 'users.id' },
          created_at: { type: 'TEXT', nullable: false },
          updated_at: { type: 'TEXT', nullable: false },
        },
        indexes: ['idx_projects_owner', 'idx_projects_status'],
      },
      tasks: {
        columns: {
          id: { type: 'TEXT', primaryKey: true },
          title: { type: 'TEXT', nullable: false },
          description: { type: 'TEXT', nullable: true },
          status: { type: 'TEXT', nullable: false, default: 'todo' },
          priority: { type: 'INTEGER', nullable: false, default: 0 },
          project_id: { type: 'TEXT', nullable: false, foreignKey: 'projects.id' },
          assignee_id: { type: 'TEXT', nullable: true, foreignKey: 'users.id' },
          created_at: { type: 'TEXT', nullable: false },
          updated_at: { type: 'TEXT', nullable: false },
        },
        indexes: ['idx_tasks_project', 'idx_tasks_assignee', 'idx_tasks_status'],
      },
      files: {
        columns: {
          id: { type: 'TEXT', primaryKey: true },
          original_name: { type: 'TEXT', nullable: false },
          stored_name: { type: 'TEXT', nullable: false, unique: true },
          mime_type: { type: 'TEXT', nullable: false },
          size: { type: 'INTEGER', nullable: false },
          project_id: { type: 'TEXT', nullable: false, foreignKey: 'projects.id' },
          uploaded_by: { type: 'TEXT', nullable: false, foreignKey: 'users.id' },
          created_at: { type: 'TEXT', nullable: false },
        },
        indexes: ['idx_files_project', 'idx_files_uploaded_by'],
      },
      prompts: {
        columns: {
          id: { type: 'TEXT', primaryKey: true },
          body: { type: 'TEXT', nullable: false },
          project_id: { type: 'TEXT', nullable: true, foreignKey: 'projects.id' },
          status: { type: 'TEXT', nullable: false, default: 'pending' },
          created_at: { type: 'TEXT', nullable: false },
          updated_at: { type: 'TEXT', nullable: false },
        },
        indexes: ['idx_prompts_project', 'idx_prompts_status'],
      },
    },
  };
}

if (require.main === module) {
  console.log('Running migrations…');
  migrate();
  closeDb();
  console.log('Done.');
}

module.exports = { migrate, getSchema };
