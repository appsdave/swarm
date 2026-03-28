const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

const DB_PATH = path.join(__dirname, '..', '..', '..', 'data', 'test-prompts.db');
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

describe('GET /api/prompts/config', () => {
  it('returns prompt configuration', async () => {
    const res = await request('GET', '/api/prompts/config');
    assert.equal(res.status, 200);
    assert.equal(typeof res.body.maxPromptLength, 'number');
    assert.ok(res.body.maxPromptLength > 0);
    assert.equal(res.body.autoScrollEnabled, true);
  });
});

describe('Prompts API', () => {
  let promptId;

  it('POST /api/prompts — creates a prompt and returns clearInput flag', async () => {
    const res = await request('POST', '/api/prompts', { body: 'Build a landing page' });
    assert.equal(res.status, 201);
    assert.equal(res.body.clearInput, true);
    assert.ok(res.body.prompt);
    assert.equal(res.body.prompt.body, 'Build a landing page');
    assert.equal(res.body.prompt.status, 'pending');
    assert.ok(res.body.prompt.id);
    promptId = res.body.prompt.id;
  });

  it('POST /api/prompts — rejects missing body field', async () => {
    const res = await request('POST', '/api/prompts', { project_id: 'some-id' });
    assert.equal(res.status, 400);
  });

  it('POST /api/prompts — rejects empty body', async () => {
    const res = await request('POST', '/api/prompts', { body: '' });
    assert.equal(res.status, 400);
  });

  it('GET /api/prompts — lists prompts', async () => {
    const res = await request('GET', '/api/prompts');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
    assert.ok(res.body.length >= 1);
  });

  it('GET /api/prompts/:id — returns a prompt', async () => {
    const res = await request('GET', `/api/prompts/${promptId}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.id, promptId);
  });

  it('GET /api/prompts/:id — 404 for unknown id', async () => {
    const res = await request('GET', '/api/prompts/nonexistent');
    assert.equal(res.status, 404);
  });

  it('PATCH /api/prompts/:id — updates status', async () => {
    const res = await request('PATCH', `/api/prompts/${promptId}`, { status: 'running' });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'running');
  });

  it('PATCH /api/prompts/:id — rejects invalid status', async () => {
    const res = await request('PATCH', `/api/prompts/${promptId}`, { status: 'invalid' });
    assert.equal(res.status, 400);
  });

  it('DELETE /api/prompts/:id — removes a prompt', async () => {
    const res = await request('DELETE', `/api/prompts/${promptId}`);
    assert.equal(res.status, 204);
  });

  it('DELETE /api/prompts/:id — 404 for already deleted', async () => {
    const res = await request('DELETE', `/api/prompts/${promptId}`);
    assert.equal(res.status, 404);
  });
});
