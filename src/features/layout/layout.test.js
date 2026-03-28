const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

const DB_PATH = path.join(__dirname, '..', '..', '..', 'data', 'test-layout.db');
process.env.DB_PATH = DB_PATH;
process.env.NODE_ENV = 'test';

const { app } = require('../../app');
const { migrate } = require('../../db/migrate');
const { closeDb } = require('../../db/connection');

let server;
let baseUrl;

function request(method, urlPath) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, baseUrl);
    const opts = { method, hostname: url.hostname, port: url.port, path: url.pathname + url.search };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

before(() => {
  migrate();
  return new Promise((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address();
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

after(() => {
  return new Promise((resolve) => {
    server.close(() => {
      closeDb();
      try { fs.unlinkSync(DB_PATH); } catch {}
      try { fs.unlinkSync(DB_PATH + '-wal'); } catch {}
      try { fs.unlinkSync(DB_PATH + '-shm'); } catch {}
      resolve();
    });
  });
});

describe('GET /api/layout', () => {
  it('returns full layout config', async () => {
    const res = await request('GET', '/api/layout');
    assert.equal(res.status, 200);
    assert.equal(res.body.splitDirection, 'horizontal');
    assert.ok(Array.isArray(res.body.panels));
    assert.equal(res.body.panels.length, 2);
    assert.ok(res.body.taskInput);
  });

  it('has correct 80/20 split', async () => {
    const res = await request('GET', '/api/layout');
    const a1 = res.body.panels.find((p) => p.id === 'agent-a1');
    const b1 = res.body.panels.find((p) => p.id === 'agent-b1');
    assert.equal(a1.widthPercent, 80);
    assert.equal(b1.widthPercent, 20);
    assert.equal(a1.role, 'frontend');
    assert.equal(b1.role, 'backend');
  });

  it('includes task input scroll config', async () => {
    const res = await request('GET', '/api/layout');
    const ti = res.body.taskInput;
    assert.equal(ti.autoScroll, true);
    assert.equal(ti.scrollToCursor, true);
    assert.equal(ti.scrollBehavior, 'smooth');
    assert.ok(ti.maxVisibleLines > 0);
  });

  it('includes tips config in task input', async () => {
    const res = await request('GET', '/api/layout');
    const tips = res.body.taskInput.tips;
    assert.equal(tips.enabled, true);
    assert.equal(tips.position, 'below-input');
    assert.ok(tips.rotateIntervalMs > 0);
  });
});

describe('GET /api/layout/panels', () => {
  it('returns only panel split info', async () => {
    const res = await request('GET', '/api/layout/panels');
    assert.equal(res.status, 200);
    assert.equal(res.body.splitDirection, 'horizontal');
    assert.ok(Array.isArray(res.body.panels));
    assert.equal(res.body.panels.length, 2);
    assert.equal(res.body.panels[0].widthPercent + res.body.panels[1].widthPercent, 100);
  });
});

describe('GET /api/layout/task-input', () => {
  it('returns task input config', async () => {
    const res = await request('GET', '/api/layout/task-input');
    assert.equal(res.status, 200);
    assert.equal(res.body.position, 'bottom');
    assert.equal(res.body.autoScroll, true);
    assert.equal(res.body.scrollToCursor, true);
  });
});
