const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

const DB_PATH = path.join(__dirname, '..', '..', '..', 'data', 'test-tips.db');
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

describe('GET /api/tips', () => {
  it('returns an array of tips', async () => {
    const res = await request('GET', '/api/tips');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
    assert.ok(res.body.length > 0);
    const tip = res.body[0];
    assert.ok(tip.id);
    assert.ok(tip.text);
    assert.ok(tip.category);
    assert.ok(tip.icon);
  });

  it('filters by category', async () => {
    const res = await request('GET', '/api/tips?category=writing');
    assert.equal(res.status, 200);
    assert.ok(res.body.length > 0);
    for (const tip of res.body) {
      assert.equal(tip.category, 'writing');
    }
  });

  it('returns empty array for unknown category', async () => {
    const res = await request('GET', '/api/tips?category=nonexistent');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
    assert.equal(res.body.length, 0);
  });

  it('respects limit parameter', async () => {
    const res = await request('GET', '/api/tips?limit=2');
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 2);
  });
});

describe('GET /api/tips/random', () => {
  it('returns a single tip', async () => {
    const res = await request('GET', '/api/tips/random');
    assert.equal(res.status, 200);
    assert.ok(res.body.id);
    assert.ok(res.body.text);
    assert.ok(res.body.category);
  });

  it('returns null for unknown category', async () => {
    const res = await request('GET', '/api/tips/random?category=nonexistent');
    assert.equal(res.status, 200);
    assert.equal(res.body, null);
  });

  it('filters random tip by category', async () => {
    const res = await request('GET', '/api/tips/random?category=ui');
    assert.equal(res.status, 200);
    assert.equal(res.body.category, 'ui');
  });
});
