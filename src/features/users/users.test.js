const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

const DB_PATH = path.join(__dirname, '..', '..', '..', 'data', 'test-users.db');
process.env.DB_PATH = DB_PATH;
process.env.NODE_ENV = 'test';

const { app } = require('../../app');
const { migrate } = require('../../db/migrate');
const { closeDb } = require('../../db/connection');

let server;
let baseUrl;

function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, baseUrl);
    const opts = { method, hostname: url.hostname, port: url.port, path: url.pathname + url.search };
    const headers = {};
    let payload;
    if (body) {
      payload = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    opts.headers = headers;
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
    if (payload) req.write(payload);
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

describe('GET /api/health', () => {
  it('returns healthy status', async () => {
    const res = await request('GET', '/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'healthy');
    assert.equal(res.body.db, 'connected');
  });
});

describe('Users API', () => {
  let userId;

  it('POST /api/users — creates a user', async () => {
    const res = await request('POST', '/api/users', { email: 'alice@test.com', name: 'Alice' });
    assert.equal(res.status, 201);
    assert.equal(res.body.email, 'alice@test.com');
    assert.equal(res.body.name, 'Alice');
    assert.equal(res.body.role, 'member');
    assert.ok(res.body.id);
    userId = res.body.id;
  });

  it('POST /api/users — rejects duplicate email', async () => {
    const res = await request('POST', '/api/users', { email: 'alice@test.com', name: 'Alice2' });
    assert.equal(res.status, 409);
  });

  it('POST /api/users — rejects missing fields', async () => {
    const res = await request('POST', '/api/users', { email: 'bob@test.com' });
    assert.equal(res.status, 400);
  });

  it('GET /api/users — lists users', async () => {
    const res = await request('GET', '/api/users');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
    assert.ok(res.body.length >= 1);
  });

  it('GET /api/users/:id — returns a user', async () => {
    const res = await request('GET', `/api/users/${userId}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.id, userId);
  });

  it('GET /api/users/:id — 404 for unknown id', async () => {
    const res = await request('GET', '/api/users/nonexistent');
    assert.equal(res.status, 404);
  });

  it('PATCH /api/users/:id — updates a user', async () => {
    const res = await request('PATCH', `/api/users/${userId}`, { name: 'Alice Updated' });
    assert.equal(res.status, 200);
    assert.equal(res.body.name, 'Alice Updated');
  });

  it('DELETE /api/users/:id — removes a user', async () => {
    const res = await request('DELETE', `/api/users/${userId}`);
    assert.equal(res.status, 204);
  });
});

describe('404 handler', () => {
  it('returns 404 for unknown routes', async () => {
    const res = await request('GET', '/api/nonexistent');
    assert.equal(res.status, 404);
  });
});
