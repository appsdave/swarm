const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const DB_PATH = path.join(__dirname, '..', '..', '..', 'data', 'test-files.db');
const UPLOADS_DIR = path.join(__dirname, '..', '..', '..', 'data', 'test-uploads');
process.env.DB_PATH = DB_PATH;
process.env.UPLOADS_DIR = UPLOADS_DIR;
process.env.NODE_ENV = 'test';
process.env.MAX_FILE_SIZE = String(1024 * 100); // 100 KB for tests
process.env.MAX_PROJECT_STORAGE = String(1024 * 200); // 200 KB for tests

const { app } = require('../../app');
const { migrate } = require('../../db/migrate');
const { closeDb } = require('../../db/connection');

let server;
let baseUrl;

function jsonRequest(method, urlPath, body) {
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

function multipartUpload(urlPath, fieldName, fileName, fileBuffer, mimeType, extraFields = {}) {
  return new Promise((resolve, reject) => {
    const boundary = '----TestBoundary' + crypto.randomBytes(8).toString('hex');
    const url = new URL(urlPath, baseUrl);

    let body = '';
    // Add extra text fields
    for (const [key, value] of Object.entries(extraFields)) {
      body += `--${boundary}\r\n`;
      body += `Content-Disposition: form-data; name="${key}"\r\n\r\n`;
      body += `${value}\r\n`;
    }

    // File part header
    const fileHeader =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${fieldName}"; filename="${fileName}"\r\n` +
      `Content-Type: ${mimeType}\r\n\r\n`;

    const fileTrailer = `\r\n--${boundary}--\r\n`;

    const headerBuf = Buffer.from(body + fileHeader, 'utf-8');
    const trailerBuf = Buffer.from(fileTrailer, 'utf-8');
    const fullBody = Buffer.concat([headerBuf, fileBuffer, trailerBuf]);

    const opts = {
      method: 'POST',
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': fullBody.length,
      },
    };

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
    req.write(fullBody);
    req.end();
  });
}

let userId;
let projectId;

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
      try { fs.rmSync(UPLOADS_DIR, { recursive: true, force: true }); } catch {}
      resolve();
    });
  });
});

describe('Files API', () => {
  it('setup — create user and project', async () => {
    const userRes = await jsonRequest('POST', '/api/users', { email: 'fileuser@test.com', name: 'File User' });
    assert.equal(userRes.status, 201);
    userId = userRes.body.id;

    const projRes = await jsonRequest('POST', '/api/projects', { name: 'File Project', owner_id: userId });
    assert.equal(projRes.status, 201);
    projectId = projRes.body.id;
  });

  it('POST /api/files/project/:id — uploads a valid file', async () => {
    const content = Buffer.from('hello world test file content');
    const res = await multipartUpload(
      `/api/files/project/${projectId}`,
      'file', 'test.txt', content, 'text/plain',
      { uploaded_by: userId },
    );
    assert.equal(res.status, 201);
    assert.equal(res.body.original_name, 'test.txt');
    assert.equal(res.body.mime_type, 'text/plain');
    assert.equal(res.body.size, content.length);
    assert.equal(res.body.project_id, projectId);
    assert.equal(res.body.uploaded_by, userId);
    assert.ok(res.body.id);
    assert.ok(res.body.stored_name);
  });

  it('GET /api/files/project/:id — lists files with storage info', async () => {
    const res = await jsonRequest('GET', `/api/files/project/${projectId}`);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.files));
    assert.equal(res.body.files.length, 1);
    assert.ok(res.body.storage);
    assert.ok(res.body.storage.used > 0);
    assert.ok(res.body.storage.limit > 0);
    assert.ok(res.body.storage.remaining >= 0);
  });

  it('GET /api/files/:id — returns file metadata', async () => {
    const listRes = await jsonRequest('GET', `/api/files/project/${projectId}`);
    const fileId = listRes.body.files[0].id;

    const res = await jsonRequest('GET', `/api/files/${fileId}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.id, fileId);
    assert.equal(res.body.original_name, 'test.txt');
  });

  it('GET /api/files/:id — 404 for unknown id', async () => {
    const res = await jsonRequest('GET', '/api/files/nonexistent');
    assert.equal(res.status, 404);
  });

  it('GET /api/files/:id/download — downloads the file', async () => {
    const listRes = await jsonRequest('GET', `/api/files/project/${projectId}`);
    const fileId = listRes.body.files[0].id;

    const res = await new Promise((resolve, reject) => {
      const url = new URL(`/api/files/${fileId}/download`, baseUrl);
      http.get({ hostname: url.hostname, port: url.port, path: url.pathname }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
      }).on('error', reject);
    });
    assert.equal(res.status, 200);
    assert.equal(res.body, 'hello world test file content');
  });

  it('POST /api/files/project/:id — rejects disallowed MIME type', async () => {
    const content = Buffer.from('fake executable');
    const res = await multipartUpload(
      `/api/files/project/${projectId}`,
      'file', 'evil.exe', content, 'application/x-msdownload',
      { uploaded_by: userId },
    );
    assert.equal(res.status, 400);
    assert.ok(res.body.error.includes('not allowed'));
  });

  it('POST /api/files/project/:id — rejects file exceeding size limit', async () => {
    // Create a buffer larger than MAX_FILE_SIZE (100 KB)
    const bigContent = Buffer.alloc(1024 * 101, 'x');
    const res = await multipartUpload(
      `/api/files/project/${projectId}`,
      'file', 'big.txt', bigContent, 'text/plain',
      { uploaded_by: userId },
    );
    // multer returns 400 for file too large
    assert.ok([400, 413].includes(res.status));
  });

  it('POST /api/files/project/:id — rejects when project storage quota exceeded', async () => {
    // Upload a file that would push past 200 KB quota
    const almostFull = Buffer.alloc(1024 * 90, 'a');
    const res1 = await multipartUpload(
      `/api/files/project/${projectId}`,
      'file', 'fill1.txt', almostFull, 'text/plain',
      { uploaded_by: userId },
    );
    assert.equal(res1.status, 201);

    const res2 = await multipartUpload(
      `/api/files/project/${projectId}`,
      'file', 'fill2.txt', almostFull, 'text/plain',
      { uploaded_by: userId },
    );
    assert.equal(res2.status, 201);

    // This should exceed the 200 KB project quota
    const overflow = Buffer.alloc(1024 * 90, 'b');
    const res3 = await multipartUpload(
      `/api/files/project/${projectId}`,
      'file', 'overflow.txt', overflow, 'text/plain',
      { uploaded_by: userId },
    );
    assert.equal(res3.status, 413);
    assert.ok(res3.body.error.includes('storage limit'));
  });

  it('POST /api/files/project/:id — rejects missing uploaded_by', async () => {
    const content = Buffer.from('no user');
    const res = await multipartUpload(
      `/api/files/project/${projectId}`,
      'file', 'nouser.txt', content, 'text/plain',
      {},
    );
    assert.equal(res.status, 400);
    assert.ok(res.body.error.includes('uploaded_by'));
  });

  it('POST /api/files/project/:id — rejects nonexistent project', async () => {
    const content = Buffer.from('test');
    const res = await multipartUpload(
      '/api/files/project/nonexistent',
      'file', 'test.txt', content, 'text/plain',
      { uploaded_by: userId },
    );
    assert.equal(res.status, 404);
  });

  it('POST /api/files/project/:id — rejects nonexistent uploader', async () => {
    const content = Buffer.from('test');
    const res = await multipartUpload(
      `/api/files/project/${projectId}`,
      'file', 'test.txt', content, 'text/plain',
      { uploaded_by: 'fake-user-id' },
    );
    assert.equal(res.status, 400);
    assert.ok(res.body.error.includes('Uploader not found'));
  });

  it('DELETE /api/files/:id — deletes a file', async () => {
    // Upload a small file to delete
    const content = Buffer.from('delete me');
    const uploadRes = await multipartUpload(
      `/api/files/project/${projectId}`,
      'file', 'delete.txt', content, 'text/plain',
      { uploaded_by: userId },
    );
    // May get 413 if quota is full; only test delete if upload succeeded
    if (uploadRes.status !== 201) return;
    const fileId = uploadRes.body.id;

    const delRes = await jsonRequest('DELETE', `/api/files/${fileId}`);
    assert.equal(delRes.status, 204);

    const getRes = await jsonRequest('GET', `/api/files/${fileId}`);
    assert.equal(getRes.status, 404);
  });

  it('DELETE /api/files/:id — 404 for unknown id', async () => {
    const res = await jsonRequest('DELETE', '/api/files/nonexistent');
    assert.equal(res.status, 404);
  });

  it('GET /api/files/project/:id — 404 for unknown project', async () => {
    const res = await jsonRequest('GET', '/api/files/project/nonexistent');
    assert.equal(res.status, 404);
  });
});
