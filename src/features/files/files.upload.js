const multer = require('multer');
const path = require('node:path');
const fs = require('node:fs');
const { v4: uuidv4 } = require('uuid');
const config = require('../../config');
const { createError } = require('../../middleware/validate');

function ensureUploadDir() {
  if (!fs.existsSync(config.uploads.dir)) {
    fs.mkdirSync(config.uploads.dir, { recursive: true });
  }
}

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    ensureUploadDir();
    cb(null, config.uploads.dir);
  },
  filename(_req, file, cb) {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});

function fileFilter(_req, file, cb) {
  if (!config.uploads.allowedMimeTypes.includes(file.mimetype)) {
    return cb(
      createError(400, `File type '${file.mimetype}' is not allowed`),
      false,
    );
  }
  cb(null, true);
}

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: config.uploads.maxFileSize,
  },
});

module.exports = { upload, ensureUploadDir };
