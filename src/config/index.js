const path = require('node:path');

const config = {
  port: parseInt(process.env.PORT, 10) || 3000,
  env: process.env.NODE_ENV || 'development',
  db: {
    path: process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'ambition.db'),
  },
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
  },
  uploads: {
    dir: process.env.UPLOADS_DIR || path.join(__dirname, '..', '..', 'data', 'uploads'),
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE, 10) || 5 * 1024 * 1024, // 5 MB
    maxProjectStorage: parseInt(process.env.MAX_PROJECT_STORAGE, 10) || 50 * 1024 * 1024, // 50 MB per project
    allowedMimeTypes: [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'application/pdf',
      'text/plain',
      'text/csv',
      'application/json',
      'application/zip',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ],
  },
};

module.exports = config;
